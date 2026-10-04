// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { apply, name, inject } from "../src/plugins/app-agent";
import { createEmitter } from "../src/host/emitter";

function fakeCtx(
  sessions: { id: string; title: string }[],
  opts: {
    lines?: unknown[];
    models?: Array<{ id: string; capabilities: string[] }>;
    defaultModel?: string | null;
  } = {},
) {
  const sessionEvents = createEmitter<Record<string, unknown>>();
  const approvalEvents = createEmitter<Record<string, unknown>>();
  const calls: [string, unknown?][] = [];
  const session = {
    id: "s1", title: "新会话", mode: "ask" as const, model: null as string | null, running: false,
    messages: () => [],
    lines: () => [...opts.lines ?? []],
    on: (l: (e: never) => void) => sessionEvents.on("e", l),
    onApproval: (l: (r: never) => void) => approvalEvents.on("r", l),
    send: async (text: string, content?: unknown) => {
      calls.push(["send", text, content]);
      if (text === "" && Array.isArray(content)) session.title = "新会话";
    },
    abort: async () => { calls.push(["abort"]); },
    setMode: (m: string) => { calls.push(["setMode", m]); },
    setModel: (m: string | null) => { session.model = m; calls.push(["setModel", m]); },
    respond: (id: string, o: unknown) => { calls.push(["respond", id, o]); },
  };
  const ctx = {
    agent: {
      listSessions: async () => sessions,
      openSession: async () => session,
      deleteSession: async () => {},
    },
    slots: { register: (_slot: string, render: (el: HTMLElement) => void) => { render(el); return () => {}; } },
    workspace: { activeFile: null, events: { on: () => () => {} } },
    ...(opts.models ? {
      llm: {
        listEndpoints: async () => ({
          endpoints: [{ id: "e1", kind: "chat", models: opts.models }],
          defaultModel: opts.defaultModel ?? opts.models[0]?.id ?? null,
        }),
      },
    } : {}),
  };
  const el = globalThis.document.createElement("div");
  return { ctx, el, calls, sessionEvents, approvalEvents };
}

describe("app-agent 面板", () => {
  it("插件三件套", () => {
    expect(name).toBe("app-agent");
    expect(inject).toEqual(["agent", "slots", "workspace"]);
  });

  it("发送按钮调 session.send；停止调 abort", async () => {
    const { ctx, el, calls } = fakeCtx([]);
    apply(ctx as never);
    el.querySelector<HTMLTextAreaElement>("textarea")!.value = "总结一下";
    el.querySelector<HTMLButtonElement>("[data-send]")!.click();
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toContainEqual(["send", "总结一下", undefined]);
    el.querySelector<HTMLButtonElement>("[data-stop]")!.click();
    expect(calls).toContainEqual(["abort"]);
  });

  it("审批事件渲染卡片，点击回传 respond", async () => {
    const { ctx, el, calls, approvalEvents } = fakeCtx([]);
    apply(ctx as never);
    await Promise.resolve(); await Promise.resolve();
    approvalEvents.emit("r", {
      id: "a1", kind: "write", tool: "write", path: "/lib/n.md", summary: "写", newText: "机密内容",
    } as never);
    el.querySelector<HTMLButtonElement>("[data-approve]")!.click();
    expect(el.querySelector<HTMLElement>("[data-approval-id='a1']")?.textContent).toContain("机密内容");
    expect(calls[0]?.[0]).toBe("respond");
    expect(calls[0]?.[1]).toBe("a1");
  });

  it("模式胶囊切换调 setMode", async () => {
    const { ctx, el, calls } = fakeCtx([]);
    apply(ctx as never);
    await Promise.resolve(); await Promise.resolve();
    el.querySelector<HTMLButtonElement>("[data-mode-auto]")!.click();
    expect(calls).toContainEqual(["setMode", "auto"]);
  });

  it("模型选择回写 session.setModel", async () => {
    const { ctx, el, calls } = fakeCtx([], {
      models: [{ id: "m1", capabilities: [] }, { id: "m2", capabilities: ["vision"] }],
      defaultModel: "m1",
    });
    apply(ctx as never);
    await Promise.resolve(); await Promise.resolve();
    const select = el.querySelector<HTMLSelectElement>(".agent-model-select")!;
    select.value = "m2";
    select.dispatchEvent(new Event("change"));
    expect(calls).toContainEqual(["setModel", "m2"]);
  });

  it("历史审批行渲染为只读决定卡", async () => {
    const { ctx, el } = fakeCtx([], {
      lines: [{ type: "approval", id: "a9", kind: "edit", tool: "edit", path: "/lib/a.md", decider: "human", decision: "allow" }],
    });
    apply(ctx as never);
    await Promise.resolve(); await Promise.resolve();
    const card = el.querySelector<HTMLElement>("[data-approval-id='a9']");
    expect(card?.dataset.state).toBe("decided");
    expect(card?.textContent).toContain("/lib/a.md");
    expect(card?.querySelector("button")).toBeNull();
  });

  it("历史会话下拉列出并打开", async () => {
    const { ctx, el } = fakeCtx([{ id: "s9", title: "旧会话" }]);
    apply(ctx as never);
    await Promise.resolve(); await Promise.resolve();
    const item = el.querySelector<HTMLElement>("[data-session-id='s9']");
    expect(item?.textContent).toContain("旧会话");
  });

  it("附件-only 发送把 ContentPart 传给 session 且标题保持非空", async () => {
    const { ctx, el, calls } = fakeCtx([]);
    apply(ctx as never);
    await Promise.resolve(); await Promise.resolve();
    const file = new File([new Uint8Array([1, 2, 3])], "pic.png", { type: "image/png" });
    const paste = Object.assign(new Event("paste"), {
      clipboardData: { files: [file], preventDefault: () => {} },
    });
    el.querySelector<HTMLTextAreaElement>("textarea")!.dispatchEvent(paste);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(el.querySelector<HTMLElement>(".chat-chip")?.textContent).toContain("pic.png");
    el.querySelector<HTMLButtonElement>("[data-send]")!.click();
    await Promise.resolve(); await Promise.resolve();
    const call = calls.find(([name]) => name === "send");
    expect(call?.[1]).toBe("");
    expect(Array.isArray(call?.[2])).toBe(true);
    expect(el.querySelector<HTMLElement>(".agent-title")?.textContent).toBe("新会话");
  });

  it("恢复历史时消息与审批按日志顺序交错", async () => {
    const message = (role: "user" | "assistant"): unknown => ({
      type: "message",
      message: role === "user"
        ? { role, content: "用户消息" }
        : { role, reasoning: "", text: "助手", toolCalls: [] },
    });
    const { ctx, el } = fakeCtx([], {
      lines: [
        message("user"),
        { type: "approval", id: "a1", kind: "write", tool: "write", path: "/lib/a.md", decider: "human", decision: "allow" },
        message("assistant"),
      ],
    });
    apply(ctx as never);
    await Promise.resolve(); await Promise.resolve();
    const classes = [...el.querySelector<HTMLElement>(".agent-transcript")!.children]
      .map((node) => node.className);
    expect(classes.indexOf("chat-message chat-user")).toBeLessThan(classes.indexOf("agent-approval-card"));
    expect(classes.indexOf("agent-approval-card")).toBeLessThan(classes.indexOf("chat-message chat-assistant"));
  });
});
