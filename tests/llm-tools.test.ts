import { describe, expect, it } from "vitest";
import { LlmService, LlmError, type ToolDeclaration } from "../src/host/llm";
import type { StreamChunk } from "../src/host/llm-stream";

const TOOLS: ToolDeclaration[] = [
  { name: "read", description: "读文件", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
];

function serviceWith(capabilities: string[], invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) {
  return new LlmService({
    invoke: async (cmd, args) => {
      if (cmd === "llm_list_endpoints") {
        return { defaultModel: "m1", endpoints: [
          { id: "e1", kind: "chat", models: [{ id: "m1", capabilities }], apiKey: "***", baseUrl: "https://x" },
        ] };
      }
      return invoke(cmd, args);
    },
  });
}

describe("LlmService tools 口", () => {
  it("无 tools 能力带 tools 发送前报 UNSUPPORTED_CONTENT，请求不出网", async () => {
    let invoked = false;
    const svc = serviceWith(["text"], async () => { invoked = true; return {}; });
    await expect(svc.chat({ model: "m1", messages: [{ role: "user", content: "hi" }], tools: TOOLS }))
      .rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
    expect(invoked).toBe(false);
  });

  it("无 tools 能力带 tools 流式发送前报 UNSUPPORTED_CONTENT，不出网", async () => {
    let onmessage: ((chunk: StreamChunk) => void) | null = null;
    const calls: string[] = [];
    const channels: unknown[] = [];
    const svc = new LlmService({
      invoke: async (cmd, args) => {
        calls.push(cmd);
        if (cmd === "llm_list_endpoints") {
          return { defaultModel: "m1", endpoints: [
            { id: "e1", kind: "chat", models: [{ id: "m1", capabilities: ["text"] }], apiKey: "***", baseUrl: "https://x" },
          ] };
        }
        if (cmd === "llm_chat_stream") return undefined;
        void args;
        throw new Error(`unexpected ${cmd}`);
      },
      createChannel: () => {
        const channel = {
          set onmessage(f: ((chunk: StreamChunk) => void) | null) { onmessage = f; },
          get onmessage() { return onmessage; },
        };
        channels.push(channel);
        return channel;
      },
    });
    await expect(svc.chatStream({ model: "m1", messages: [{ role: "user", content: "hi" }], tools: TOOLS }))
      .rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
    expect(calls).toEqual(["llm_list_endpoints"]);
    expect(channels).toHaveLength(0);
  });

  it("有 tools 能力时 tools 透传到 llm_chat", async () => {
    let seen: Record<string, unknown> | undefined;
    const svc = serviceWith(["text", "tools"], async (_cmd, args) => {
      seen = args; return { content: "ok", finishReason: "stop" };
    });
    await svc.chat({ model: "m1", messages: [{ role: "user", content: "hi" }], tools: TOOLS });
    expect((seen?.req as { tools: ToolDeclaration[] }).tools[0].name).toBe("read");
  });

  it("assistant toolCalls 与 toolCallId 消息原样透传", async () => {
    let seen: Record<string, unknown> | undefined;
    const svc = serviceWith(["text", "tools"], async (_cmd, args) => {
      seen = args; return { content: "ok", finishReason: "stop" };
    });
    await svc.chat({ model: "m1", tools: TOOLS, messages: [
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read", argumentsText: "{\"path\":\"/a\"}" }] },
      { role: "tool", content: "结果", toolCallId: "c1" },
    ] });
    const msgs = (seen?.req as { messages: unknown[] }).messages;
    expect(msgs).toEqual([
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "read", argumentsText: "{\"path\":\"/a\"}" }] },
      { role: "tool", content: "结果", toolCallId: "c1" },
    ]);
  });
});
