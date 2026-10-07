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
    root?: string | null;
  } = {},
) {
  const sessionEvents = createEmitter<Record<string, unknown>>();
  const approvalEvents = createEmitter<Record<string, unknown>>();
  const workspaceEvents = createEmitter<{ type: string; payload?: unknown }>();
  const calls: [string, unknown?][] = [];
  const openCalls: Array<{ id: string | null; mode?: string }> = [];
  let durableMode: "ask" | "auto" | null = opts.defaultMode ?? null;
  let root: string | null = opts.root === undefined ? "/lib/root" : opts.root;
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
      listSessions: async () => root === null ? [] : sessions,
      openSession: async (id: string | null, mode?: string) => {
        openCalls.push({ id, mode });
        if (root === null) throw new Error("尚未打开学习库");
        session.mode = mode === "auto" ? "auto" : "ask";
        return session;
      },
      deleteSession: async () => {},
    },
    slots: { register: (_slot: string, render: (el: HTMLElement) => void) => { render(el); return () => {}; } },
    workspace: {
      get root() { return root; },
      activeFile: null,
      events: {
        on: (event: string, listener: (value?: unknown) => void) => {
          if (event === "root-changed") return workspaceEvents.on("e", (item) => listener((item as { payload?: unknown })?.payload));
          if (event === "file-opened") return workspaceEvents.on("e", (item) => listener((item as { payload?: unknown })?.payload));
          return () => {};
        },
      },
    },
    ...(opts.models ? {
      llm: {
        listEndpoints: async () => ({
          endpoints: [{ id: "e1", kind: "chat", models: opts.models }],
          defaultModel: opts.defaultModel ?? opts.models[0]?.id ?? null,
          agentApprovalMode: durableMode,
        }),
        setDefaultAgentApprovalMode: async (mode: "ask" | "auto") => {
          durableMode = mode;
          calls.push(["setDefaultAgentApprovalMode", mode]);
        },
      },
    } : {}),
  };
  const el = globalThis.document.createElement("div");
  return {
    ctx, el, calls, sessionEvents, approvalEvents, session, openCalls,
    get durableMode() { return durableMode; },
    setRoot(next: string | null) { root = next; workspaceEvents.emit("e", { type: "root-changed", payload: next }); },
  };
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toContainEqual(["send", "总结一下", undefined]);
    el.querySelector<HTMLButtonElement>("[data-stop]")!.click();
    expect(calls).toContainEqual(["abort"]);
  });

  it("审批接管 composer；批准后恢复草稿", async () => {
    const { ctx, el, calls, approvalEvents } = fakeCtx([]);
    apply(ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const input = el.querySelector<HTMLTextAreaElement>(".chat-input")!;
    input.value = "我的草稿";
    approvalEvents.emit("r", {
      id: "a1", kind: "write", tool: "write", path: "/lib/n.md", summary: "写", newText: "机密内容",
    } as never);
    const composer = el.querySelector<HTMLElement>(".chat-composer")!;
    expect(composer.dataset.state).toBe("approval");
    expect(el.querySelector(".agent-approval-card")).toBeNull();
    expect(el.querySelector<HTMLElement>(".agent-approval-detail")!.textContent).toContain("机密内容");
    el.querySelector<HTMLButtonElement>("[data-approve]")!.click();
    expect(calls[0]).toEqual(["respond", "a1", { decision: "allow" }]);
    expect(composer.dataset.state).toBe("decided");
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(composer.dataset.state).toBe("normal");
    expect(input.value).toBe("我的草稿");
  });

  it("审批详情浮层 toggle 与 Esc 关闭", async () => {
    const { ctx, el, approvalEvents } = fakeCtx([]);
    document.body.append(el); // 事件冒泡到 document 需要真实树
    apply(ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    approvalEvents.emit("r", { id: "a2", kind: "write", tool: "write", path: "/lib/n.md", summary: "写", newText: "x" } as never);
    const detail = el.querySelector<HTMLElement>(".agent-approval-detail")!;
    expect(detail.classList.contains("open")).toBe(false);
    el.querySelector<HTMLButtonElement>("[data-detail-toggle]")!.click();
    expect(detail.classList.contains("open")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(detail.classList.contains("open")).toBe(false);
    el.querySelector<HTMLButtonElement>("[data-detail-toggle]")!.click();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(detail.classList.contains("open")).toBe(false);
    el.remove();
  });

  it("多个审批排队，处理完自动显示下一个", async () => {
    const { ctx, el, calls, approvalEvents } = fakeCtx([]);
    apply(ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    approvalEvents.emit("r", { id: "a1", kind: "write", tool: "write", path: "/1.md", summary: "写", newText: "1" } as never);
    approvalEvents.emit("r", { id: "a2", kind: "write", tool: "write", path: "/2.md", summary: "写", newText: "2" } as never);
    const composer = el.querySelector<HTMLElement>(".chat-composer")!;
    expect(composer.dataset.approvalId).toBe("a1");
    el.querySelector<HTMLButtonElement>("[data-approve]")!.click();
    expect(calls[0]).toEqual(["respond", "a1", { decision: "allow" }]);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(composer.dataset.state).toBe("approval");
    expect(composer.dataset.approvalId).toBe("a2");
  });

  it("模式胶囊切换调 setMode", async () => {
    const { ctx, el, calls } = fakeCtx([]);
    apply(ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    el.querySelector<HTMLButtonElement>("[data-mode-auto]")!.click();
    expect(calls).toContainEqual(["setMode", "auto"]);
  });

  it("新会话使用 durable 审批模式；模式胶囊仍只改当前会话", async () => {
    const { ctx, el, calls, openCalls, session, setRoot } = fakeCtx([], {
      models: [{ id: "m1", capabilities: [] }],
      defaultMode: "auto",
      root: null,
    });
    apply(ctx as never);
    setRoot("/lib/root");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(openCalls.at(-1)).toEqual({ id: null, mode: "auto" });
    expect(session.mode).toBe("auto");

    el.querySelector<HTMLButtonElement>("[data-mode-ask]")!.click();
    expect(calls).toContainEqual(["setMode", "ask"]);
    expect(calls).not.toContainEqual(["setDefaultAgentApprovalMode", "ask"]);

    el.querySelector<HTMLButtonElement>("[data-new-session]")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(openCalls.at(-1)).toEqual({ id: null, mode: "auto" });
  });

  it("默认审批模式下拉写全局设置，不改当前会话", async () => {
    const { ctx, el, calls, session } = fakeCtx([], {
      models: [{ id: "m1", capabilities: [] }],
      defaultMode: "ask",
    });
    apply(ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const select = el.querySelector<HTMLSelectElement>(".agent-default-mode")!;
    select.value = "auto";
    select.dispatchEvent(new Event("change"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toContainEqual(["setDefaultAgentApprovalMode", "auto"]);
    expect(calls).not.toContainEqual(["setMode", "auto"]);
    expect(session.mode).toBe("ask");
  });

  it("模型选择回写 session.setModel", async () => {
    const { ctx, el, calls } = fakeCtx([], {
      models: [{ id: "m1", capabilities: [] }, { id: "m2", capabilities: ["vision"] }],
      defaultModel: "m1",
    });
    apply(ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const select = el.querySelector<HTMLSelectElement>(".agent-model-select")!;
    select.value = "m2";
    select.dispatchEvent(new Event("change"));
    expect(calls).toContainEqual(["setModel", "m2"]);
  });

  it("历史审批行渲染为只读决策行", async () => {
    const { ctx, el } = fakeCtx([], {
      lines: [{ type: "approval", id: "a9", kind: "edit", tool: "edit", path: "/lib/a.md", decider: "human", decision: "allow" }],
    });
    apply(ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const line = el.querySelector<HTMLElement>(".agent-decision-line");
    expect(line?.textContent).toContain("/lib/a.md");
    expect(line?.textContent).toContain("已批准");
    expect(line?.querySelector("button")).toBeNull();
  });

  it("历史会话下拉列出并打开", async () => {
    const { ctx, el } = fakeCtx([{ id: "s9", title: "旧会话" }]);
    apply(ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const item = el.querySelector<HTMLElement>("[data-session-id='s9']");
    expect(item?.textContent).toContain("旧会话");
  });

  it("root 从未开库变为有值时重置并重建 agent 会话", async () => {
    const { ctx, el, calls, openCalls, setRoot } = fakeCtx([{ id: "s9", title: "旧会话" }], { root: null });
    apply(ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(el.querySelector<HTMLElement>(".chat-notice")?.textContent).toContain("尚未打开学习库");

    setRoot("/lib/root");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(openCalls.map((call) => call.id)).toEqual([null, null]);
    const notice = el.querySelector<HTMLElement>(".chat-notice")!;
    expect(notice.hidden).toBe(true);
    expect(notice.textContent).toBe("");
    expect(el.querySelector<HTMLElement>("[data-session-id='s9']")?.textContent).toContain("旧会话");
  });

  it("root 切换时中止旧会话并拆绑旧事件", async () => {
    const { ctx, el, calls, sessionEvents, approvalEvents, setRoot } = fakeCtx([]);
    apply(ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    setRoot("/lib/root-a");
    sessionEvents.emit("e", { type: "error", message: "旧 root 错误" });
    approvalEvents.emit("r", { id: "old", kind: "write", tool: "write", path: "/old", summary: "旧" } as never);
    setRoot("/lib/root-b");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toContainEqual(["abort"]);
    expect(el.querySelector<HTMLElement>(".chat-error")).toBeNull();
    expect(el.querySelector<HTMLElement>("[data-approval-id='old']")).toBeNull();
  });

  it("附件-only 发送把 ContentPart 传给 session 且标题保持非空", async () => {
    const { ctx, el, calls } = fakeCtx([]);
    apply(ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const file = new File([new Uint8Array([1, 2, 3])], "pic.png", { type: "image/png" });
    const paste = Object.assign(new Event("paste"), {
      clipboardData: { files: [file], preventDefault: () => {} },
    });
    el.querySelector<HTMLTextAreaElement>("textarea")!.dispatchEvent(paste);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(el.querySelector<HTMLElement>(".chat-chip")?.textContent).toContain("pic.png");
    el.querySelector<HTMLButtonElement>("[data-send]")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const call = calls.find(([name]) => name === "send");
    expect(call?.[1]).toBe("");
    expect(Array.isArray(call?.[2])).toBe(true);
    expect(el.querySelector<HTMLElement>(".agent-title")?.textContent).toBe("新会话");
  });

  it("发送中不做本地标题改写，完成后按服务标题同步", async () => {
    const { ctx, el, calls, session } = fakeCtx([]);
    session.send = async (text: string, content?: unknown) => {
      calls.push(["send", text, content]);
      session.title = "服务同步标题";
    };
    apply(ctx as never);
    await Promise.resolve();
    await Promise.resolve();
    el.querySelector<HTMLTextAreaElement>("textarea")!.value = "总结一下";
    el.querySelector<HTMLButtonElement>("[data-send]")!.click();
    expect(el.querySelector<HTMLElement>(".agent-title")?.textContent).toBe("新会话");
    await Promise.resolve();
    await Promise.resolve();
    expect(el.querySelector<HTMLElement>(".agent-title")?.textContent).toBe("服务同步标题");
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    const classes = [...el.querySelector<HTMLElement>(".agent-transcript")!.children]
      .map((node) => node.className);
    expect(classes.indexOf("chat-message chat-user")).toBeLessThan(classes.indexOf("agent-decision-line"));
    expect(classes.indexOf("agent-decision-line")).toBeLessThan(classes.indexOf("chat-message chat-assistant"));
  });
});

describe("agent-ui v2 回合过程组", () => {
  it("工具事件进过程组，turn-end 后默认折叠", async () => {
    const { ctx, el, sessionEvents } = fakeCtx([]);
    apply(ctx as never);
    await new Promise((r) => setTimeout(r, 0));
    sessionEvents.emit("e", { type: "turn-start" } as never);
    sessionEvents.emit("e", { type: "tool-start", call: { id: "t1", name: "read", argumentsText: "{}" } } as never);
    sessionEvents.emit("e", { type: "tool-end", call: { id: "t1", name: "read", argumentsText: "{}" }, content: "ok", isError: false } as never);
    sessionEvents.emit("e", { type: "turn-end" } as never);
    const group = el.querySelector<HTMLElement>(".agent-process")!;
    expect(group).not.toBeNull();
    expect(group.classList.contains("open")).toBe(false);
    expect(group.textContent).toContain("已完成");
    expect(group.querySelector(".agent-tool-card")).not.toBeNull();
  });

  it("运行中摘要显示当前动作", async () => {
    const { ctx, el, sessionEvents } = fakeCtx([]);
    apply(ctx as never);
    await new Promise((r) => setTimeout(r, 0));
    sessionEvents.emit("e", { type: "turn-start" } as never);
    sessionEvents.emit("e", { type: "tool-start", call: { id: "t2", name: "grep", argumentsText: "{}" } } as never);
    const group = el.querySelector<HTMLElement>(".agent-process")!;
    expect(group.classList.contains("running")).toBe(true);
    expect(group.textContent).toContain("正在");
  });

  it("历史中的工具行渲染为折叠过程组", async () => {
    const { ctx, el } = fakeCtx([], {
      lines: [
        { type: "message", message: { role: "user", content: "读一下" } },
        { type: "tool", callId: "h1", name: "read", argumentsText: "{}", content: "内容", isError: false },
        { type: "message", message: { role: "assistant", reasoning: null, text: "好了", toolCalls: [], usage: null, finishReason: "stop" } },
      ],
    });
    apply(ctx as never);
    await new Promise((r) => setTimeout(r, 0));
    const group = el.querySelector<HTMLElement>(".agent-process")!;
    expect(group).not.toBeNull();
    expect(group.classList.contains("open")).toBe(false);
    expect(group.querySelector(".agent-tool-card")).not.toBeNull();
  });
});
