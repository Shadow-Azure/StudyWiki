import { describe, expect, it } from "vitest";
import { createApprovalGate, type ApprovalGate } from "../src/plugins/agent-core/approval";
import type { SessionLine } from "../src/plugins/agent-core/session";

const REQ = { id: "a1", kind: "write" as const, tool: "write", path: "/lib/n.md", summary: "写入 5 字节" };

function gateWith(mode: "ask" | "auto", impl: {
  human?: (req: typeof REQ) => Promise<{ decision: "allow" | "deny"; reason?: string }>;
  chat?: (req: { messages: { role: string; content: string }[] }) => Promise<{ content: string }>;
}) {
  const log: SessionLine[] = [];
  const gate = createApprovalGate({
    mode: () => mode, log: (l) => log.push(l),
    askHuman: impl.human ?? (async () => { throw new Error("不该问人"); }),
    chat: impl.chat ?? (async () => { throw new Error("不该问模型"); }),
  });
  return { gate, log };
}

describe("approval gate", () => {
  it("ask 模式路由到人并记日志", async () => {
    const { gate, log } = gateWith("ask", { human: async () => ({ decision: "allow" }) });
    const out = await gate.ask(REQ);
    expect(out.decision).toBe("allow");
    expect(log.at(-1)).toMatchObject({ type: "approval", decider: "human", decision: "allow", path: "/lib/n.md" });
  });

  it("auto 模式 guardian 批准 JSON → allow", async () => {
    const { gate, log } = gateWith("auto", { chat: async () => ({ content: "```json\n{\"approve\":true,\"reason\":\"库内笔记\"}\n```" }) });
    const out = await gate.ask(REQ);
    expect(out.decision).toBe("allow");
    expect(log.at(-1)).toMatchObject({ decider: "guardian", decision: "allow", reason: "库内笔记" });
  });

  it("guardian 非 JSON → fail-closed 拒绝", async () => {
    const { gate, log } = gateWith("auto", { chat: async () => ({ content: "我觉得可以吧" }) });
    const out = await gate.ask(REQ);
    expect(out.decision).toBe("deny");
    expect(log.at(-1)).toMatchObject({ decider: "guardian", decision: "deny" });
  });

  it("guardian 抛错 → fail-closed 拒绝", async () => {
    const { gate } = gateWith("auto", { chat: async () => { throw new Error("网络断了"); } });
    const out = await gate.ask(REQ);
    expect(out.decision).toBe("deny");
    expect(out.reason).toContain("网络断了");
  });

  it("guardian 否决理由透传", async () => {
    const { gate } = gateWith("auto", { chat: async () => ({ content: "{\"approve\":false,\"reason\":\"可疑越界\"}" }) });
    expect(await gate.ask(REQ)).toEqual({ decision: "deny", reason: "可疑越界" });
  });

  it("cancelAll 悬挂审批 fail-closed", async () => {
    let resolveHuman!: (v: { decision: "allow" | "deny"; reason?: string }) => void;
    const { gate, log } = gateWith("ask", { human: () => new Promise((res) => { resolveHuman = res; }) });
    const pending = gate.ask(REQ);
    gate.cancelAll("用户停止");
    await expect(pending).resolves.toMatchObject({ decision: "deny", reason: "用户停止" });
    expect(log.at(-1)).toMatchObject({ decision: "unavailable" });
    resolveHuman({ decision: "allow" }); // 迟到应答被忽略
  });
});
