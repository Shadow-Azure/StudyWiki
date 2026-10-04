import { describe, expect, it } from "vitest";
import { ChunkQueue, type ChatStreamHandle, type StreamChunk } from "../src/host/llm-stream";
import { runTurn, type LoopDeps } from "../src/plugins/agent-core/loop";
import type { AgentMessage, SessionLine } from "../src/plugins/agent-core/session";

function fakeStream(script: StreamChunk[][]): LoopDeps["chatStream"] {
  let i = 0;
  return async () => {
    const chunks = script[i++];
    const queue = new ChunkQueue();
    for (const c of chunks) queue.push(c);
    queue.close();
    const asm = new (await import("../src/host/llm-stream")).StreamAssembler();
    for await (const c of queue) asm.push(c);
    return {
      events: (async function* () {})(),
      snapshot: () => asm.snapshot(),
      settled: Promise.resolve(),
      abort: async () => {},
    } satisfies ChatStreamHandle;
  };
}

const TEXT_DONE: StreamChunk[] = [
  { type: "text-delta", index: 0, text: "回答" },
  { type: "finish", reason: "stop" },
];
const TOOL_THEN_TEXT: StreamChunk[][] = [
  [
    { type: "tool-call-delta", index: 0, id: "c1", name: "read", argumentsDelta: "{\"path\":\"/lib/a.md\"}" },
    { type: "finish", reason: "tool_calls" },
  ],
  TEXT_DONE,
];

function depsWith(script: StreamChunk[][], runTool: LoopDeps["runTool"]) {
  const persisted: SessionLine[] = [];
  const events: string[] = [];
  const deps: LoopDeps = {
    chatStream: fakeStream(script), runTool,
    systemPrompt: () => "sys", tools: [], model: "m1",
    persist: (l) => persisted.push(l), emit: (e) => events.push(e.type),
  };
  return { deps, persisted, events };
}

describe("runTurn", () => {
  it("纯文本回合落 assistant 并 turn-end", async () => {
    const { deps, persisted, events } = depsWith([TEXT_DONE], async () => { throw new Error("不该调工具"); });
    const appended = await runTurn([], deps, new AbortController().signal);
    expect(appended).toEqual([{ role: "assistant", reasoning: "", text: "回答", toolCalls: [], usage: undefined, finishReason: "stop" }]);
    expect(persisted.map((l) => l.type)).toEqual(["message"]);
    expect(events).toEqual(["turn-start", "message", "turn-end"]);
  });

  it("工具回合：toolCalls→串行执行→结果回灌→再请求", async () => {
    const calls: string[] = [];
    const { deps, persisted } = depsWith(TOOL_THEN_TEXT, async (call) => {
      calls.push(call.name);
      return { content: "文件内容" };
    });
    const appended = await runTurn([], deps, new AbortController().signal);
    expect(calls).toEqual(["read"]);
    expect(appended.map((m) => m.role)).toEqual(["assistant", "tool", "assistant"]);
    expect(appended[1]).toMatchObject({ role: "tool", callId: "c1", name: "read", content: "文件内容" });
    expect(persisted).toHaveLength(3);
  });

  it("工具结果 isError 也回灌继续", async () => {
    const { deps } = depsWith(TOOL_THEN_TEXT, async () => ({ content: "未找到匹配", isError: true }));
    const appended = await runTurn([], deps, new AbortController().signal);
    expect(appended[1]).toMatchObject({ isError: true });
    expect(appended).toHaveLength(3);
  });

  it("流中中止：半截 assistant 不落账", async () => {
    const ac = new AbortController();
    const script: StreamChunk[][] = [[{ type: "text-delta", index: 0, text: "半截" }]];
    const { deps, persisted, events } = depsWith(script, async () => ({ content: "" }));
    ac.abort();
    const appended = await runTurn([], deps, ac.signal);
    expect(appended).toEqual([]);
    expect(persisted).toEqual([]);
    expect(events).toContain("aborted");
  });

  it("工具审批中中止：runTool 返回拒绝结果后回合收尾", async () => {
    const ac = new AbortController();
    const { deps } = depsWith([TOOL_THEN_TEXT[0], TEXT_DONE], async () => {
      ac.abort();
      return { content: "已取消", isError: true };
    });
    const appended = await runTurn([], deps, ac.signal);
    expect(appended.at(-1)).toMatchObject({ role: "tool", isError: true });
  });

  it("toChatMessages 映射 assistant/tool 形状", async () => {
    const { toChatMessages } = await import("../src/plugins/agent-core/loop");
    const history: AgentMessage[] = [
      { role: "assistant", reasoning: "r", text: "t", toolCalls: [{ id: "c1", name: "read", argumentsText: "{}" }] },
      { role: "tool", callId: "c1", name: "read", content: "结果" },
    ];
    expect(toChatMessages(history)).toEqual([
      { role: "assistant", content: "t", toolCalls: [{ id: "c1", name: "read", argumentsText: "{}" }] },
      { role: "tool", content: "结果", toolCallId: "c1" },
    ]);
  });
});
