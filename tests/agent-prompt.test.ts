import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/plugins/agent-core/prompt";

const base = { root: "/lib", agentsMd: null, activeFilePath: null, mode: "ask" as const, now: "2026-10-04" };

describe("buildSystemPrompt", () => {
  it("含工具纪律、边界与库根", () => {
    const p = buildSystemPrompt(base);
    expect(p).toContain("/lib");
    expect(p).toContain("read").toContain("grep").toContain("write").toContain("edit");
    expect(p).toContain("授权");
  });

  it("模式句两态", () => {
    expect(buildSystemPrompt(base)).toContain("请求批准");
    expect(buildSystemPrompt({ ...base, mode: "auto" })).toContain("帮我批准");
  });

  it("活动文件与 AGENTS.md 注入", () => {
    const p = buildSystemPrompt({ ...base, activeFilePath: "/lib/a.md", agentsMd: "# 库约定\n笔记用中文。" });
    expect(p).toContain("/lib/a.md");
    expect(p).toContain("笔记用中文。");
  });

  it("无 AGENTS.md 不留占位", () => {
    expect(buildSystemPrompt(base)).not.toContain("AGENTS.md");
  });
});
