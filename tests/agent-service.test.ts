import { describe, expect, it } from "vitest";
import { createAgentService, type AgentService, type AgentSession } from "../src/plugins/agent-core/service";
import type { StreamChunk } from "../src/host/llm-stream";
import type { ApprovalRequest } from "../src/plugins/agent-core/tools";
import { vi } from "vitest";
import type { GrepRequest } from "../src/host/files";

function fakeHost(rootFiles: Record<string, string>) {
  const files = { ...rootFiles };
  return {
    files,
    svc: {
      readText: async (p: string) => { if (!(p in files)) throw new Error("ENOENT"); return files[p]; },
      agentSessionPaths: async (_root: string) => Object.keys(files)
        .filter((p) => p.startsWith("/home/.study-wiki/sessions/lib-root/")),
      agentSessionPath: async (_root: string, id: string) =>
        `/home/.study-wiki/sessions/lib-root/${id}.jsonl`,
      readAgentSessionFile: async (p: string) => {
        if (!(p in files)) throw new Error("ENOENT");
        return files[p];
      },
      writeAgentSessionFile: async (p: string, c: string) => { files[p] = c; },
      readTree: async (root: string) => Object.keys(files).filter((p) => p.startsWith(root))
        .map((p) => ({ name: p.split("/").pop()!, path: p, kind: "markdown" as const })),
      writeText: async (p: string, c: string) => { files[p] = c; },
      grepFiles: async (_req: GrepRequest) => ({ matches: [], truncated: false }),
      authorizeReadPath: async () => {},
      appendSessionEvent: async (p: string, line: string) => { files[p] = (files[p] ?? "") + line + "\n"; },
      deleteSessionFile: async (p: string) => { delete files[p]; },
    },
  };
}

// 服务层脚本化流：每个脚本元素是一回合的 chunk 列表（与 Task 11 同一形状）
function scriptedChatStream(scripts: StreamChunk[][]) {
  let i = 0;
  return async () => {
    const { StreamAssembler } = await import("../src/host/llm-stream");
    const asm = new StreamAssembler();
    for (const c of scripts[Math.min(i++, scripts.length - 1)]) asm.push(c);
    return { events: (async function* () {})(), snapshot: () => asm.snapshot(),
      settled: Promise.resolve(), abort: async () => {} };
  };
}

// 先阻塞首回合，直到测试调用 abort；后续回合继续使用脚本流。
function blockedFirstThenScriptedChatStream(scripts: StreamChunk[][]) {
  const scripted = scriptedChatStream(scripts);
  const calls: number[] = [];
  let releaseFirst: (() => void) | null = null;
  const firstSnapshot = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  return {
    calls,
    firstSnapshot,
    chatStream: async () => {
      calls.push(calls.length + 1);
      if (calls.length > 1) return await scripted();
      const { StreamAssembler } = await import("../src/host/llm-stream");
      const asm = new StreamAssembler();
      for (const chunk of TEXT("第一回合被停止")) asm.push(chunk);
      const release = releaseFirst!;
      return {
        events: (async function* () {
          yield TEXT("第一回合被停止")[0]!;
          await firstSnapshot;
        })(),
        snapshot: () => asm.snapshot(),
        settled: Promise.resolve(),
        abort: async () => { release(); },
      };
    },
  };
}

const TEXT = (t: string, promptTokens = 10): StreamChunk[] => [
  { type: "text-delta", index: 0, text: t },
  { type: "usage", usage: { promptTokens, completionTokens: 1 } },
  { type: "finish", reason: "stop" },
];
const WRITE_CALL: StreamChunk[] = [
  { type: "tool-call-delta", index: 0, id: "w1", name: "write",
    argumentsDelta: "{\"path\":\"/lib/n.md\",\"content\":\"# 笔记\"}" },
  { type: "finish", reason: "tool_calls" },
];

function serviceWith(rootFiles: Record<string, string>, opts: {
  scripts: StreamChunk[][];
  chat?: (req: { messages: { role: string; content: string }[] }) => Promise<{ content: string; finishReason: string }>;
  streamRequests?: Array<{ model?: string }>;
}) {
  const host = fakeHost(rootFiles);
  const scripted = scriptedChatStream(opts.scripts);
  const svc = createAgentService({
    llm: {
      chatStream: async (request) => {
        opts.streamRequests?.push({ ...(request.model === undefined ? {} : { model: request.model }) });
        return scripted(request);
      },
      chat: opts.chat ?? (async () => ({ content: "{\"approve\":true,\"reason\":\"ok\"}", finishReason: "stop" })),
    } as never,
    files: host.svc as never,
    workspace: { activeFile: null, root: "/lib" } as never,
  });
  return { svc, host };
}

const HEADER_S1 = (rootPath: string) =>
  `{"type":"header","header":{"v":1,"id":"s1","rootPath":"${rootPath}","title":"旧","createdAt":"x"}}\n`;

describe("AgentService", () => {
  it("停止后当前控制器立即轮换，同一会话可继续发送", async () => {
    const host = fakeHost({});
    const scripts = [TEXT("第二回合")];
    const stream = blockedFirstThenScriptedChatStream(scripts);
    const svc = createAgentService({
      llm: { chatStream: stream.chatStream } as never,
      files: host.svc as never,
      workspace: { activeFile: null, root: "/lib" } as never,
    });
    const session = await svc.openSession(null);
    const first = session.send("第一问");
    await vi.waitFor(() => expect(stream.calls).toEqual([1]));
    await session.abort();
    await session.abort();
    await first;

    expect(session.messages().some((message) => message.role === "assistant")).toBe(false);
    await expect(session.send("第二问")).resolves.toBeUndefined();
    expect(stream.calls).toEqual([1, 2]);
    expect(session.messages().filter((message) => message.role === "assistant"))
      .toEqual([expect.objectContaining({ role: "assistant", text: "第二回合" })]);
  });

  it("runTurn 前等待期间停止时使用入口控制器且下一问可运行", async () => {
    const host = fakeHost({});
    const calls: number[] = [];
    let session!: AgentSession;
    const scripted = scriptedChatStream([TEXT("下一回合")]);
    const svc = createAgentService({
      llm: {
        chatStream: async (request) => {
          calls.push(calls.length + 1);
          return scripted(request);
        },
      } as never,
      files: host.svc as never,
      workspace: { activeFile: null, root: "/lib" } as never,
    });
    const appendSessionEvent = host.svc.appendSessionEvent;
    host.svc.appendSessionEvent = async (path, line) => {
      if (line.includes('"content":"流启动前停止"')) await session.abort();
      await appendSessionEvent(path, line);
    };
    session = await svc.openSession(null);
    const events: Array<{ type: string }> = [];
    session.on((event) => events.push({ type: event.type }));

    await session.send("流启动前停止");

    expect(events.map((event) => event.type)).toEqual(["turn-start", "aborted"]);
    expect(session.messages()).toEqual([{ role: "user", content: "流启动前停止" }]);

    await session.send("第二问");
    expect(calls).toEqual([1]);
    expect(session.messages().filter((message) => message.role === "assistant"))
      .toEqual([expect.objectContaining({ role: "assistant", text: "下一回合" })]);
  });

  it("新会话使用显式默认审批模式；会话内切换不改全局", async () => {
    const { svc, host } = serviceWith({}, { scripts: [TEXT("好")] });
    const session = await svc.openSession(null, "auto");
    expect(session.mode).toBe("auto");
    await session.send("开始");
    session.setMode("ask");
    expect(session.mode).toBe("ask");
    expect(Object.keys(host.files).some((path) => path.includes("settings.json"))).toBe(false);
    const next = await svc.openSession(null, "auto");
    expect(next.mode).toBe("auto");
  });

  it("附件-only 首发保留标题改写资格，后续文本重写文件头", async () => {
    const { svc, host } = serviceWith({}, {
      scripts: [TEXT("附件回合"), TEXT("文字回合")],
    });
    const session = await svc.openSession(null);
    await session.send("", [{
      type: "image",
      source: { kind: "inline", data: "aW1n", mimeType: "image/png" },
    }]);
    expect(session.title).toBe("新会话");

    await session.send("第二问");
    expect(session.title).toBe("第二问");
    const path = Object.keys(host.files).find((p) => p.includes("/home/.study-wiki/sessions/lib-root/"))!;
    const content = host.files[path]!;
    expect(content).toContain('"title":"第二问"');
    expect(content).toContain("附件回合");
    expect(content).toContain("第二问");
    expect(session.messages().filter((message) => message.role === "assistant").map((message) =>
      message.role === "assistant" ? message.text : "",
    )).toEqual(["附件回合", "文字回合"]);
  });

  it("新会话发消息后 JSONL 落盘 header+消息", async () => {
    const { svc, host } = serviceWith({}, { scripts: [TEXT("你好，我是 agent")] });
    const session = await svc.openSession(null);
    await session.send("你好");
    const path = Object.keys(host.files).find((p) => p.includes("/home/.study-wiki/sessions/lib-root/"))!;
    expect(host.files[path]).toContain("\"type\":\"header\"");
    expect(host.files[path]).toContain("你好");
    expect(host.files[path]).toContain("你好，我是 agent");
  });

  it("listSessions 按库根目录读 header，坏文件跳过", async () => {
    const { svc } = serviceWith({
      "/home/.study-wiki/sessions/lib-root/a.jsonl": `{"type":"header","header":{"v":1,"id":"a","rootPath":"/lib","title":"会话甲","createdAt":"x"}}\n`,
      "/home/.study-wiki/sessions/lib-root/bad.jsonl": "不是json",
    }, { scripts: [] });
    expect(await svc.listSessions()).toEqual([{ id: "a", title: "会话甲", createdAt: "x" }]);
  });

  it("加载历史会话只读不跑，发新消息才续", async () => {
    const existing = HEADER_S1("/lib")
      + `{"type":"message","message":{"role":"user","content":"老问题"}}\n`;
    const { svc } = serviceWith({ "/home/.study-wiki/sessions/lib-root/s1.jsonl": existing }, { scripts: [] });
    const session = await svc.openSession("s1");
    expect(session.messages().map((m) => m.role)).toEqual(["user"]);
    expect(session.running).toBe(false);
  });

  it("会话 rootPath 与当前库不符：rootMismatch 暴露原路径但仍加载", async () => {
    const { svc } = serviceWith({ "/home/.study-wiki/sessions/lib-root/s1.jsonl": HEADER_S1("/old-lib") }, { scripts: [] });
    const session = await svc.openSession("s1");
    expect(session.rootMismatch).toBe("/old-lib");
  });

  it("审批经 onApproval 暴露，respond 批准后 write 落盘", async () => {
    const { svc, host } = serviceWith({}, { scripts: [WRITE_CALL, TEXT("已写好")] });
    const session = await svc.openSession(null);
    const reqs: ApprovalRequest[] = [];
    session.onApproval((r) => reqs.push(r));
    const done = session.send("记个笔记");
    await vi.waitFor(() => expect(reqs).toHaveLength(1));
    expect(reqs[0]).toMatchObject({ kind: "write", path: "/lib/n.md" });
    session.respond(reqs[0].id, { decision: "allow" });
    await done;
    expect(host.files["/lib/n.md"]).toBe("# 笔记");
  });

  it("compaction 超阈值：摘要调用 + compaction 行 + 有效视图缩短", async () => {
    const summaries: string[] = [];
    const { svc, host } = serviceWith({}, {
      scripts: [TEXT("长回答", 90_000), TEXT("继续回答", 20_000)],
      chat: async (req) => {
        summaries.push(JSON.stringify(req.messages));
        return { content: "摘要：早前聊了甲", finishReason: "stop" };
      },
    });
    const session = await svc.openSession(null);
    await session.send("第一问");   // assistant usage 90k > 阈值 80k
    await session.send("第二问");   // 先压缩再跑回合
    expect(summaries).toHaveLength(1);
    const path = Object.keys(host.files).find((p) => p.includes("/home/.study-wiki/sessions/lib-root/"))!;
    expect(host.files[path]).toContain("\"type\":\"compaction\"");
    expect(session.messages()[0]).toMatchObject({ role: "user", content: expect.stringContaining("摘要：早前聊了甲") });
  });

  it("compaction 不拆开 assistant 与 tool，也不重复摘要同一 assistant", async () => {
    const summaries: string[] = [];
    const toolAssistant: StreamChunk[] = [
      { type: "tool-call-delta", index: 0, id: "t1", name: "unknown-a", argumentsDelta: "{}" },
      { type: "tool-call-delta", index: 1, id: "t2", name: "unknown-b", argumentsDelta: "{}" },
      { type: "finish", reason: "tool_calls" },
    ];
    const { svc, host } = serviceWith({}, {
      scripts: [toolAssistant, TEXT("长回答", 90_000), TEXT("压缩后回答", 10_000), TEXT("压缩后再问", 10_000)],
      chat: async (req) => {
        summaries.push(JSON.stringify(req.messages));
        return { content: "摘要：早前工具回合", finishReason: "stop" };
      },
    });
    const session = await svc.openSession(null);
    await session.send("第一问");
    await session.send("第二问");
    await session.send("第三问");
    expect(summaries).toHaveLength(1);

    const path = Object.keys(host.files).find((p) => p.includes("/home/.study-wiki/sessions/lib-root/"))!;
    const compactions = host.files[path]!.trimEnd().split("\n")
      .map((line) => JSON.parse(line) as { type?: string; covered?: number })
      .filter((line) => line.type === "compaction");
    expect(compactions).toHaveLength(1);
    const view = session.messages();
    const assistantIndex = view.findIndex((message) => message.role === "assistant");
    const toolIndex = view.findIndex((message) => message.role === "tool");
    expect(compactions[0]!.covered).toBe(1);
    expect(compactions[0]!.covered).toBeLessThan(view.length);
    expect(toolIndex).toBeGreaterThan(assistantIndex);
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(view[toolIndex - 1]?.role).toBe("assistant");
  });

  it("附件-only 首条消息保留默认标题且发给 session 内容", async () => {
    const { svc } = serviceWith({}, { scripts: [TEXT("已收到图片")] });
    const session = await svc.openSession(null);
    await session.send("", [{ type: "image", source: { kind: "inline", data: "abcd", mimeType: "image/png" } }]);
    expect(session.title).toBe("新会话");
  });

  it("停止当前回合后同一会话可继续发送", async () => {
    const { svc } = serviceWith({}, { scripts: [TEXT("第一回合"), TEXT("第二回合")] });
    const session = await svc.openSession(null);
    await session.send("第一问");
    await session.abort();
    await expect(session.send("第二问")).resolves.toBeUndefined();
  });

  it("活动回合停止结算后同一会话可继续发送", async () => {
    const { svc } = serviceWith({}, { scripts: [WRITE_CALL, TEXT("第二回合")] });
    const session = await svc.openSession(null);
    const reqs: ApprovalRequest[] = [];
    session.onApproval((req) => reqs.push(req));
    const first = session.send("记个笔记");
    await vi.waitFor(() => expect(reqs).toHaveLength(1));
    await session.abort();
    await first;
    await expect(session.send("第二问")).resolves.toBeUndefined();
  });

  it("打开崩溃尾巴会话后先归一化，再追加完整行", async () => {
    const existing = HEADER_S1("/lib")
      + `{"type":"message","message":{"role":"user","content":"完整问题"}}\n`
      + `{"type":"message","message":{"role":"user","content":"partial-tail-marker"}`;
    const { svc, host } = serviceWith({
      "/home/.study-wiki/sessions/lib-root/s1.jsonl": existing,
    }, { scripts: [] });
    const session = await svc.openSession("s1");
    await session.send("新问题");

    const content = host.files["/home/.study-wiki/sessions/lib-root/s1.jsonl"];
    expect(content).not.toContain("partial-tail-marker");
    const lines = content.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[2]!)).toMatchObject({ type: "message", message: { role: "user", content: "新问题" } });
  });

  it("setModel 只作用于当前回合路由，null 回落端点默认", async () => {
    const requests: Array<{ model?: string }> = [];
    const { svc } = serviceWith({}, { scripts: [TEXT("m2"), TEXT("default")], streamRequests: requests });
    const session = await svc.openSession(null);
    session.setModel("m2");
    await session.send("第一问");
    session.setModel(null);
    await session.send("第二问");
    expect(requests.map((request) => request.model)).toEqual(["m2", undefined]);
    expect(session.model).toBeNull();
  });

  it("lines 返回防御性副本并保留含 kind 的审批行", async () => {
    const existing = HEADER_S1("/lib")
      + `{"type":"approval","id":"a1","kind":"edit","tool":"edit","path":"/lib/a.md","decider":"human","decision":"deny","reason":"不对"}
`;
    const { svc } = serviceWith({ "/home/.study-wiki/sessions/lib-root/s1.jsonl": existing }, { scripts: [] });
    const session = await svc.openSession("s1");
    const lines = session.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: "approval", id: "a1", kind: "edit", decision: "deny" });
    lines.pop();
    expect(session.lines()).toHaveLength(1);
  });

  it("加载历史会话暴露 header 标题", async () => {
    const { svc } = serviceWith({ "/home/.study-wiki/sessions/lib-root/s1.jsonl": HEADER_S1("/lib") }, { scripts: [] });
    const session = await svc.openSession("s1");
    expect(session.title).toBe("旧");
  });

  it("加载历史会话恢复最后一次持久化模式", async () => {
    const existing = HEADER_S1("/lib")
      + `{"type":"mode","mode":"auto"}\n`;
    const { svc } = serviceWith({ "/home/.study-wiki/sessions/lib-root/s1.jsonl": existing }, { scripts: [] });
    const session = await svc.openSession("s1");
    expect(session.mode).toBe("auto");
  });

  it("运行中的会话拒绝删除且文件保留，空闲会话可删除", async () => {
    const { svc, host } = serviceWith({}, { scripts: [WRITE_CALL, TEXT("已写好")] });
    const session = await svc.openSession(null);
    const path = Object.keys(host.files).find((p) => p.includes("/home/.study-wiki/sessions/lib-root/"))!;
    const reqs: ApprovalRequest[] = [];
    session.onApproval((r) => reqs.push(r));
    const done = session.send("记个笔记");
    await vi.waitFor(() => expect(reqs).toHaveLength(1));
    await expect(svc.deleteSession(session.id)).rejects.toThrow("会话进行中，先停止再删除");
    expect(host.files[path]).toBeDefined();
    session.respond(reqs[0]!.id, { decision: "allow" });
    await done;
    await session.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await svc.deleteSession(session.id);
    expect(host.files[path]).toBeUndefined();
  });

  it("deleteSession 调 deleteSessionFile", async () => {
    const { svc, host } = serviceWith({ "/home/.study-wiki/sessions/lib-root/s1.jsonl": HEADER_S1("/lib") }, { scripts: [] });
    await svc.deleteSession("s1");
    expect(host.files["/home/.study-wiki/sessions/lib-root/s1.jsonl"]).toBeUndefined();
  });
});
