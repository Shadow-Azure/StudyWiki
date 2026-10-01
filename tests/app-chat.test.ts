// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { apply } from "../src/plugins/app-chat/index";
import type { StreamChunk } from "../src/host/llm-stream";

let aborted: boolean;
let lastReq: unknown;

function fakeCtx(script: StreamChunk[]) {
  let host: HTMLElement | null = null;
  const ctx = {
    slots: {
      register: (_slot: string, render: (el: HTMLElement) => void) => {
        host = document.createElement("div");
        document.body.append(host);
        render(host);
        return () => host.remove();
      },
    },
    llm: {
      listEndpoints: async () => ({
        endpoints: [{ id: "e1", kind: "chat", models: [{ id: "m1", capabilities: ["text", "vision", "audio"] }] }],
        defaultModel: "m1",
      }),
      chatStream: async (req: unknown) => {
        lastReq = req;
        const events = (async function* () { for (const chunk of script) yield chunk; })();
        return { events, settled: Promise.resolve(), abort: async () => { aborted = true; } };
      },
    },
    workspace: {
      root: "/w",
      activeFile: { name: "第3章.md", path: "/w/第3章.md", kind: "markdown" },
      events: { on: () => () => {} },
    },
  };
  return { ctx, host: () => host! };
}

beforeEach(() => {
  document.body.innerHTML = "";
  aborted = false;
  lastReq = null;
});

const syncDeps = { raf: (cb: () => void) => { cb(); return 0; }, pickFile: async () => null };

describe("app-chat", () => {
  it("发送后流式渲染：reasoning 折叠、正文增量、usage 落行", async () => {
    const { ctx } = fakeCtx([
      { type: "reasoning-delta", index: 0, text: "想一下" },
      { type: "text-delta", index: 0, text: "### 答案\n\n内容" },
      { type: "usage", usage: { promptTokens: 3, completionTokens: 5 } },
      { type: "finish", reason: "stop" },
    ]);
    const dispose = apply(ctx as never, {}, syncDeps);
    const input = document.querySelector("textarea")!;
    input.value = "提问";
    document.querySelector<HTMLButtonElement>(".chat-send")!.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.querySelector(".chat-reason")).toBeTruthy();
    expect(document.querySelector(".chat-md")!.innerHTML).toContain("<h3>");
    expect(document.body.textContent).toContain("3");
    dispose();
  });

  it("流式中发送键变停止，点击调 abort 并标已中断", async () => {
    const { ctx } = fakeCtx([{ type: "text-delta", index: 0, text: "半截" }]);
    const dispose = apply(ctx as never, {}, syncDeps);
    document.querySelector("textarea")!.value = "q";
    document.querySelector<HTMLButtonElement>(".chat-send")!.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const stop = document.querySelector<HTMLButtonElement>(".chat-send")!;
    expect(stop.textContent).toContain("停止");
    stop.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(aborted).toBe(true);
    expect(document.body.textContent).toContain("已中断");
    dispose();
  });

  it("error chunk 渲染错误横幅含错误码", async () => {
    const { ctx } = fakeCtx([{ type: "error", code: "RATE_LIMITED", message: "慢点" }]);
    const dispose = apply(ctx as never, {}, syncDeps);
    document.querySelector("textarea")!.value = "q";
    document.querySelector<HTMLButtonElement>(".chat-send")!.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.body.textContent).toContain("RATE_LIMITED");
    dispose();
  });

  it("chatStream 发送前拒绝时渲染能力错误", async () => {
    const { ctx } = fakeCtx([]);
    ctx.llm.chatStream = async () => {
      throw { code: "UNSUPPORTED_CONTENT", message: "当前模型不支持请求中的媒体内容" };
    };
    const dispose = apply(ctx as never, {}, syncDeps);
    document.querySelector("textarea")!.value = "描述图片";
    document.querySelector<HTMLButtonElement>(".chat-send")!.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.body.textContent).toContain("UNSUPPORTED_CONTENT");
    dispose();
  });

  it("错误横幅重试会重发最近一条用户消息", async () => {
    const { ctx } = fakeCtx([{ type: "error", code: "RATE_LIMITED", message: "慢点" }]);
    const requests: unknown[] = [];
    let script: StreamChunk[] = [{ type: "error", code: "RATE_LIMITED", message: "慢点" }];
    ctx.llm.chatStream = async (req: unknown) => {
      requests.push(req);
      const current = script;
      const events = (async function* () { for (const chunk of current) yield chunk; })();
      return { events, settled: Promise.reject({ code: "RATE_LIMITED", message: "慢点" }), abort: async () => { aborted = true; } };
    };
    const dispose = apply(ctx as never, {}, syncDeps);
    document.querySelector("textarea")!.value = "重试我";
    document.querySelector<HTMLButtonElement>(".chat-send")!.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    document.querySelector<HTMLButtonElement>(".chat-retry")!.click();
    script = [{ type: "finish", reason: "stop" }];
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(requests).toHaveLength(2);
    dispose();
  });

  it("卸载中止在途流", async () => {
    const { ctx } = fakeCtx([{ type: "text-delta", index: 0, text: "x" }]);
    const dispose = apply(ctx as never, {}, syncDeps);
    document.querySelector("textarea")!.value = "q";
    document.querySelector<HTMLButtonElement>(".chat-send")!.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    dispose();
    expect(aborted).toBe(true);
  });

  it("fileToAttachment：图片 File → inline base64，文本 File → null", async () => {
    const { fileToAttachment } = await import("../src/plugins/app-chat/attachments");
    const img = new File([new Uint8Array([137, 80, 78, 71])], "截图.png", { type: "image/png" });
    const att = await fileToAttachment(img);
    expect(att?.part.type).toBe("image");
    expect(att?.part.source).toMatchObject({ kind: "inline", mimeType: "image/png" });
    const txt = new File(["hi"], "a.txt", { type: "text/plain" });
    expect(await fileToAttachment(txt)).toBeNull();
  });

  it("paste 事件把图片挂进 composer chips", async () => {
    const { ctx } = fakeCtx([{ type: "finish", reason: "stop" }]);
    const dispose = apply(ctx as never, {}, syncDeps);
    const file = new File([new Uint8Array([1, 2])], "贴图.png", { type: "image/png" });
    const area = document.querySelector("textarea")!;
    const ev = new Event("paste", { bubbles: true }) as Event & { clipboardData: unknown };
    ev.clipboardData = { files: [file] };
    area.dispatchEvent(ev);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.querySelector(".chat-chip")?.textContent).toContain("贴图.png");
    dispose();
  });
});
