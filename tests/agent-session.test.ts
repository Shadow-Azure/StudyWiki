import { describe, expect, it } from "vitest";
import { encodeLine, parseSession, effectiveMessages, sessionTitle,
  type SessionLine, type AgentMessage } from "../src/plugins/agent-core/session";

const header = { v: 1 as const, id: "s1", rootPath: "/lib", title: "t", createdAt: "2026-10-04T00:00:00Z" };
const user: AgentMessage = { role: "user", content: "问题" };
const assistant: AgentMessage = { role: "assistant", reasoning: "", text: "回答", toolCalls: [], finishReason: "stop" };

describe("session codec", () => {
  it("header + 消息 roundtrip", () => {
    const text = [encodeLine({ type: "header", header }), encodeLine({ type: "message", message: user }),
      encodeLine({ type: "message", message: assistant })].join("\n") + "\n";
    const parsed = parseSession(text);
    expect(parsed.header.id).toBe("s1");
    expect(parsed.lines).toHaveLength(3);
    expect(parsed.tailTruncated).toBe(false);
  });

  it("半截尾巴截断并标注", () => {
    const text = encodeLine({ type: "header", header }) + "\n"
      + encodeLine({ type: "message", message: user }) + "\n"
      + "{\"type\":\"message\",\"message\":{\"role\":\"assi";
    const parsed = parseSession(text);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.tailTruncated).toBe(true);
  });

  it("非 v1 header 拒绝", () => {
    expect(() => parseSession("{\"type\":\"header\",\"header\":{\"v\":2}}\n")).toThrow();
  });

  it("header 非首行拒绝", () => {
    const text = encodeLine({ type: "header", header }) + "\n"
      + encodeLine({ type: "header", header }) + "\n";
    expect(() => parseSession(text)).toThrow();
  });

  it("compaction 有效视图：覆盖前缀换摘要，日志行保留", () => {
    const lines: SessionLine[] = [
      { type: "header", header },
      { type: "message", message: user },
      { type: "message", message: assistant },
      { type: "message", message: { role: "user", content: "追问" } },
      { type: "compaction", summary: "早前讨论了问题", covered: 2, createdAt: "2026-10-04T01:00:00Z" },
    ];
    const view = effectiveMessages(lines);
    expect(lines).toHaveLength(5); // 日志全文保留
    expect(view).toHaveLength(2);
    expect(view[0]).toEqual({ role: "user", content: "[早期对话摘要]\n早前讨论了问题" });
    expect(view[1]).toEqual({ role: "user", content: "追问" });
  });

  it("compaction 边界回退，防止 assistant 与 tool 拆开", () => {
    const tool: AgentMessage = { role: "tool", callId: "c1", name: "read", content: "结果" };
    const assistantWithCall: AgentMessage = {
      role: "assistant", reasoning: "", text: "调用",
      toolCalls: [{ id: "c1", name: "read", argumentsText: "{}" }],
    };
    const lines: SessionLine[] = [
      { type: "header", header },
      { type: "message", message: user },
      { type: "message", message: assistantWithCall },
      { type: "message", message: tool },
      { type: "message", message: user },
      { type: "compaction", summary: "早前", covered: 2, createdAt: "2026-10-04T01:00:00Z" },
    ];
    const view = effectiveMessages(lines);
    expect(view[0]).toMatchObject({ role: "user", content: expect.stringContaining("早前") });
    expect(view.slice(1, 3).map((message) => message.role)).toEqual(["assistant", "tool"]);
    expect(view.at(-1)).toEqual(user);
  });

  it("sessionTitle 截断与单行化", () => {
    expect(sessionTitle("第一行\n第二行")).toBe("第一行");
    expect(sessionTitle("x".repeat(80))).toHaveLength(50);
  });
});
