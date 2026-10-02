import { describe, expect, it } from "vitest";
import { LlmError, LlmService } from "../src/host/llm";
import { ChunkQueue, StreamAssembler, type StreamChunk } from "../src/host/llm-stream";

describe("StreamAssembler", () => {
  it("交错 delta 各自归位", () => {
    const a = new StreamAssembler();
    a.push({ type: "reasoning-delta", index: 0, text: "想" });
    a.push({ type: "text-delta", index: 0, text: "答" });
    a.push({ type: "reasoning-delta", index: 0, text: "完" });
    const s = a.snapshot();
    expect(s.reasoning).toBe("想完");
    expect(s.text).toBe("答");
  });

  it("tool-call 按 index 归并参数并升序快照", () => {
    const a = new StreamAssembler();
    a.push({ type: "tool-call-delta", index: 0, id: "c1", name: "read", argumentsDelta: "{\"pa" });
    a.push({ type: "tool-call-delta", index: 1, id: "c2", name: "write", argumentsDelta: "{}" });
    a.push({ type: "tool-call-delta", index: 0, id: "c1", argumentsDelta: "th\"}" });
    const s = a.snapshot();
    expect(s.toolCalls.map((tool) => [tool.id, tool.argumentsText])).toEqual([
      ["c1", "{\"path\"}"],
      ["c2", "{}"],
    ]);
  });

  it("usage、finish 与 error chunk 落快照", () => {
    const a = new StreamAssembler();
    a.push({ type: "usage", usage: { promptTokens: 2, completionTokens: 3 } });
    a.push({ type: "finish", reason: "stop" });
    a.push({ type: "error", code: "RATE_LIMITED", message: "慢点" });
    expect(a.snapshot()).toMatchObject({
      usage: { promptTokens: 2, completionTokens: 3 },
      finishReason: "stop",
      error: { code: "RATE_LIMITED", message: "慢点" },
    });
  });
  it("snapshot 返回隔离副本：突变快照不污染组装器内部状态", () => {
    const a = new StreamAssembler();
    a.push({ type: "tool-call-delta", index: 0, id: "c1", name: "read", argumentsDelta: "{}" });
    a.push({ type: "usage", usage: { promptTokens: 3, completionTokens: 5 } });
    const s1 = a.snapshot();
    s1.toolCalls[0].name = "mutated";
    s1.usage!.promptTokens = 999;
    const s2 = a.snapshot();
    expect(s2.toolCalls[0].name).toBe("read");
    expect(s2.usage?.promptTokens).toBe(3);
  });
});

describe("ChunkQueue", () => {
  it("close 使迭代正常结束", async () => {
    const queue = new ChunkQueue();
    const iterator = queue[Symbol.asyncIterator]();
    queue.push({ type: "text-delta", index: 0, text: "好" });
    queue.close();
    const first = await iterator.next();
    expect(first).toEqual({ value: { type: "text-delta", index: 0, text: "好" }, done: false });
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });

  it("fail 使在途与后续 next 拒绝 LlmError", async () => {
    const queue = new ChunkQueue();
    const iterator = queue[Symbol.asyncIterator]();
    const pending = iterator.next();
    const failure = new LlmError("STREAM_CLOSED", "断了");
    queue.fail(failure);
    await expect(pending).rejects.toBe(failure);
    const failedIterator = queue[Symbol.asyncIterator]();
    await expect(failedIterator.next()).rejects.toBe(failure);
  });
});

/** 假 invoke：listEndpoints 回单 endpoint；llm_chat_stream 把脚本化 chunk 灌进假 channel。 */
function fakeDeps(script: StreamChunk[], caps = ["text", "vision"]) {
  let onmessage: ((c: StreamChunk) => void) | null = null;
  const calls: string[] = [];
  const deps = {
    invoke: async (cmd: string, _args?: Record<string, unknown>) => {
      calls.push(cmd);
      if (cmd === "llm_list_endpoints") {
        return { endpoints: [{ id: "e1", name: "E", kind: "chat", baseUrl: "https://x", vendor: "custom", hasKey: true, keyPreview: "sk-…", models: [{ id: "m1", capabilities: caps }] }], defaultModel: "m1" };
      }
      if (cmd === "llm_chat_stream") {
        queueMicrotask(() => { for (const c of script) onmessage?.(c); });
        return undefined;
      }
      if (cmd === "llm_chat_abort") return undefined;
      throw new Error(`unexpected ${cmd}`);
    },
    createChannel: () => ({
      set onmessage(f: ((c: StreamChunk) => void) | null) { onmessage = f; },
      get onmessage() { return onmessage; },
    }),
  };
  return { calls, deps };
}

describe("LlmService.chatStream", () => {
  it("路由 + 逐 chunk 交付 + settled", async () => {
    const { deps } = fakeDeps([
      { type: "text-delta", index: 0, text: "好" },
      { type: "finish", reason: "stop" },
    ]);
    const llm = new LlmService(deps);
    const h = await llm.chatStream({ messages: [{ role: "user", content: "hi" }] });
    const seen: string[] = [];
    for await (const c of h.events) seen.push(c.type);
    expect(seen).toEqual(["text-delta", "finish"]);
    await h.settled;
  });

  it("service-owned snapshot advances with chunks and stays readable after settle", async () => {
    const { deps } = fakeDeps([
      { type: "reasoning-delta", index: 0, text: "想" },
      { type: "text-delta", index: 0, text: "答" },
      { type: "usage", usage: { promptTokens: 2, completionTokens: 1 } },
      { type: "finish", reason: "stop" },
    ]);
    const llm = new LlmService(deps);
    const h = await llm.chatStream({ messages: [{ role: "user", content: "hi" }] });
    let seen = 0;
    for await (const _chunk of h.events) {
      seen += 1;
      if (seen === 1) expect(h.snapshot()).toMatchObject({ reasoning: "想" });
      if (seen === 2) expect(h.snapshot()).toMatchObject({ reasoning: "想", text: "答" });
    }
    await h.settled;
    expect(h.snapshot()).toMatchObject({
      reasoning: "想",
      text: "答",
      usage: { promptTokens: 2, completionTokens: 1 },
      finishReason: "stop",
    });
  });

  it("invoke args 带 streamId 与 channel", async () => {
    const { calls, deps } = fakeDeps([]);
    const llm = new LlmService(deps);
    await llm.chatStream({ messages: [{ role: "user", content: "hi" }], maxTokens: 8, temperature: 0.2 });
    const streamCall = calls.indexOf("llm_chat_stream");
    expect(streamCall).toBe(1);
    expect(calls[0]).toBe("llm_list_endpoints");
  });

  it("无 vision 能力带图被拦（UNSUPPORTED_CONTENT，不出网）", async () => {
    const { deps, calls } = fakeDeps([], ["text"]);
    const llm = new LlmService(deps);
    await expect(llm.chatStream({
      messages: [{ role: "user", content: [
        { type: "text", text: "看" },
        { type: "image", source: { kind: "inline", data: "AA", mimeType: "image/png" } },
      ] }],
    })).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
    expect(calls).not.toContain("llm_chat_stream");
  });

  it("无 audio 能力带音频被拦", async () => {
    const { deps, calls } = fakeDeps([], ["text", "vision"]);
    const llm = new LlmService(deps);
    await expect(llm.chatStream({
      messages: [{ role: "user", content: [
        { type: "audio", source: { kind: "path", path: "/w/a.mp3" } },
      ] }],
    })).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
    expect(calls).not.toContain("llm_chat_stream");
  });

  it("abort 调 llm_chat_abort", async () => {
    const { deps, calls } = fakeDeps([]);
    const llm = new LlmService(deps);
    const h = await llm.chatStream({ messages: [] });
    await h.abort();
    expect(calls).toContain("llm_chat_abort");
  });

  it("error chunk 使 settled 与迭代拒绝 LlmError", async () => {
    const { deps } = fakeDeps([{ type: "error", code: "RATE_LIMITED", message: "慢点" }]);
    const llm = new LlmService(deps);
    const h = await llm.chatStream({ messages: [] });
    const consume = async () => { for await (const _chunk of h.events) { _chunk satisfies StreamChunk; } };
    await expect(consume()).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(h.settled).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("invoke 拒绝使迭代抛 LlmError", async () => {
    const deps = {
      invoke: async (cmd: string) => {
        if (cmd === "llm_list_endpoints") return { endpoints: [{ id: "e1", kind: "chat", baseUrl: "https://x", vendor: "custom", hasKey: true, keyPreview: "", models: [{ id: "m1", capabilities: ["text"] }] }], defaultModel: "m1" };
        if (cmd === "llm_chat_stream") throw { code: "UNREACHABLE", message: "断网" };
        return undefined;
      },
      createChannel: () => ({ onmessage: null as null | ((c: StreamChunk) => void) }),
    };
    const llm = new LlmService(deps);
    const h = await llm.chatStream({ messages: [] });
    await expect(h.settled).rejects.toMatchObject({ code: "UNREACHABLE" });
    const consume = async () => { for await (const _chunk of h.events) { _chunk satisfies StreamChunk; } };
    await expect(consume()).rejects.toMatchObject({ code: "UNREACHABLE" });
  });
});
