// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { apply } from "../src/plugins/app-chat/index";
import type { PartialAssistant, StreamChunk } from "../src/host/llm-stream";

let aborted: boolean;
let lastReq: unknown;

function stagedSnapshots(script: StreamChunk[]): PartialAssistant[] {
  let state: PartialAssistant = { reasoning: "", text: "", toolCalls: [] };
  return script.map((chunk): PartialAssistant => {
    state = { ...state };
    if (chunk.type === "reasoning-delta") state.reasoning += chunk.text;
    else if (chunk.type === "text-delta") state.text += chunk.text;
    else if (chunk.type === "usage") state.usage = chunk.usage;
    else if (chunk.type === "finish") state.finishReason = chunk.reason;
    else if (chunk.type === "error") state.error = { code: chunk.code, message: chunk.message };
    return { ...state };
  });
}

function fakeCtx(script: StreamChunk[], settled: Promise<unknown> = Promise.resolve()) {
  let host: HTMLElement | null = null;
  const snapshots = stagedSnapshots(script);
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
        let stage = 0;
        return {
          events,
          snapshot: () => snapshots[Math.min(stage++, snapshots.length - 1)] ?? { reasoning: "", text: "", toolCalls: [] },
          settled,
          abort: async () => { aborted = true; },
        };
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
    const { ctx } = fakeCtx(
      [{ type: "text-delta", index: 0, text: "半截" }],
      new Promise(() => {}),
    );
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

  it("handle 建立前的停止请求不丢失", async () => {
    const { ctx } = fakeCtx([{ type: "text-delta", index: 0, text: "半截" }]);
    let abortCount = 0;
    ctx.llm.chatStream = () => new Promise((resolve) => {
      setTimeout(() => resolve({
        events: (async function* () {})(),
        snapshot: () => ({ reasoning: "", text: "半截", toolCalls: [] }),
        settled: new Promise(() => {}),
        abort: async () => { abortCount += 1; aborted = true; },
      }), 1);
    });
    const dispose = apply(ctx as never, {}, syncDeps);
    document.querySelector("textarea")!.value = "q";
    document.querySelector<HTMLButtonElement>(".chat-send")!.click();
    expect(document.querySelector<HTMLButtonElement>(".chat-send")!.textContent).toContain("停止");
    expect(() => document.querySelector<HTMLButtonElement>(".chat-send")!.click()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(abortCount).toBe(1);
    expect(document.body.textContent).toContain("已中断");
    dispose();
  });

  it("EOF 无 finish 时也复位发送键并标注已结束", async () => {
    const { ctx } = fakeCtx([{ type: "text-delta", index: 0, text: "半截" }]);
    const dispose = apply(ctx as never, {}, syncDeps);
    document.querySelector("textarea")!.value = "q";
    document.querySelector<HTMLButtonElement>(".chat-send")!.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(document.querySelector<HTMLButtonElement>(".chat-send")!.textContent).toBe("发送");
    expect(document.body.textContent).toContain("已结束");
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
      const snapshots = stagedSnapshots(current);
      let stage = 0;
      return {
        events,
        snapshot: () => snapshots[Math.min(stage++, snapshots.length - 1)] ?? { reasoning: "", text: "", toolCalls: [] },
        settled: Promise.reject({ code: "RATE_LIMITED", message: "慢点" }),
        abort: async () => { aborted = true; },
      };
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

  it("代码围栏渲染为带语言头的代码容器", async () => {
    const { ctx } = fakeCtx([
      { type: "text-delta", index: 0, text: "```python\nprint(1)\n```" },
      { type: "finish", reason: "stop" },
    ]);
    const dispose = apply(ctx as never, {}, syncDeps);
    document.querySelector("textarea")!.value = "q";
    document.querySelector<HTMLButtonElement>(".chat-send")!.click();
    await new Promise((r) => setTimeout(r, 10));
    const box = document.querySelector(".chat-code");
    expect(box).toBeTruthy();
    expect(box!.querySelector(".chat-code-bar")!.textContent).toContain("python");
    expect(box!.querySelector("pre")!.textContent).toContain("print(1)");
    dispose();
  });

  it("卸载中止在途流", async () => {
    const { ctx } = fakeCtx(
      [{ type: "text-delta", index: 0, text: "x" }],
      new Promise(() => {}),
    );
    const dispose = apply(ctx as never, {}, syncDeps);
    document.querySelector("textarea")!.value = "q";
    document.querySelector<HTMLButtonElement>(".chat-send")!.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
    dispose();
    expect(aborted).toBe(true);
  });

  it("卸载后 late listEndpoints 不更新已拆离 DOM", async () => {
    const { ctx, host } = fakeCtx([{ type: "finish", reason: "stop" }]);
    ctx.llm.listEndpoints = async () => await new Promise((resolve) => {
      setTimeout(() => resolve({
        endpoints: [{ id: "late", kind: "chat", models: [{ id: "late-model", capabilities: ["text"] }] }],
        defaultModel: "late-model",
      }), 5);
    });
    const dispose = apply(ctx as never, {}, syncDeps);
    dispose();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(host().textContent).not.toContain("late-model");
  });

  it("卸载后 late listEndpoints rejection 不更新 DOM 且不抛出", async () => {
    const { ctx, host } = fakeCtx([{ type: "finish", reason: "stop" }]);
    let rejectEndpoints: (error: unknown) => void = () => {};
    ctx.llm.listEndpoints = async () => new Promise((_resolve, reject) => {
      rejectEndpoints = reject;
    });
    const dispose = apply(ctx as never, {}, syncDeps);
    const htmlBefore = host().innerHTML;
    dispose();
    rejectEndpoints({ code: "MODEL_CONFIG_UNAVAILABLE", message: "late" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host().innerHTML).toBe(htmlBefore);
    expect(host().textContent).not.toContain("MODEL_CONFIG_UNAVAILABLE");
  });

  it("fileToAttachment：图片 File → inline base64，文本 File → null", async () => {
    const { fileToAttachment } = await import("../src/plugins/app-chat/attachments");
    const img = new File([new Uint8Array([137, 80, 78, 71])], "截图.png", { type: "image/png" });
    const att = await fileToAttachment(img);
    expect(att?.part.type).toBe("image");
    expect(att?.part.source).toMatchObject({ kind: "inline", mimeType: "image/png" });
    const txt = new File(["hi"], "a.txt", { type: "text/plain" });
    const ogg = new File([new Uint8Array([1])], "voice.ogg", { type: "audio/ogg" });
    expect(await fileToAttachment(ogg)).toBeNull();
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
