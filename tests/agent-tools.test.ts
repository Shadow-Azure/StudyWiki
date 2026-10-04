import { describe, expect, it } from "vitest";
import { executeTool, isUnauthorized, TOOL_DECLARATIONS,
  type ToolRunContext, type ApprovalOutcome } from "../src/plugins/agent-core/tools";

function ctxWith(host: Partial<ToolRunContext["host"]>, answer?: ApprovalOutcome): ToolRunContext & { asked: string[] } {
  const asked: string[] = [];
  return {
    root: "/lib", asked,
    host: { readText: async () => "1 行\n2 行", grep: async () => ({ matches: [], truncated: false }),
      writeText: async () => {}, authorizeRead: async () => {}, ...host },
    ask: async (req) => { asked.push(req.kind); return answer ?? { decision: "allow" }; },
  } as ToolRunContext & { asked: string[] };
}

describe("tools", () => {
  it("read 行号前缀与分页", async () => {
    const ctx = ctxWith({ readText: async () => "甲\n乙\n丙" });
    const r = await executeTool({ id: "1", name: "read", argumentsText: "{\"path\":\"/lib/a.md\",\"offset\":2,\"limit\":1}" }, ctx);
    expect(r.content).toBe("2: 乙");
  });

  it("read 越权→审批→授权→重试", async () => {
    let reads = 0; const grants: string[] = [];
    const ctx = ctxWith({
      readText: async () => { reads++; if (reads === 1) throw new Error("UNAUTHORIZED_PATH|/out/a.md"); return "内容"; },
      authorizeRead: async (p) => { grants.push(p); },
    }, { decision: "allow", grant: "file" });
    const r = await executeTool({ id: "1", name: "read", argumentsText: "{\"path\":\"/out/a.md\"}" }, ctx);
    expect(ctx.asked).toEqual(["read-outside"]);
    expect(grants).toEqual(["/out/a.md"]);
    expect(r.content).toContain("内容");
    expect(r.isError).toBeUndefined();
  });

  it("read 越权被拒不重试", async () => {
    const ctx = ctxWith({ readText: async () => { throw new Error("UNAUTHORIZED_PATH|/out/a.md"); } },
      { decision: "deny", reason: "不给看" });
    const r = await executeTool({ id: "1", name: "read", argumentsText: "{\"path\":\"/out/a.md\"}" }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("不给看");
  });

  it("write 先审批后落盘", async () => {
    const writes: string[] = [];
    const ctx = ctxWith({ writeText: async (p, c) => { writes.push(`${p}:${c.length}`); } });
    const r = await executeTool({ id: "1", name: "write", argumentsText: "{\"path\":\"/lib/n.md\",\"content\":\"# 笔记\"}" }, ctx);
    expect(ctx.asked).toEqual(["write"]);
    // 控制器裁决：计划原断言 5 是算术错误；write 必须原样写字节，不得追加换行
    expect(writes).toEqual(["/lib/n.md:4"]);
    expect(r.content).toContain("已写入");
  });

  it("write 原样保留末尾换行", async () => {
    const writes: string[] = [];
    const ctx = ctxWith({ writeText: async (_p, c) => { writes.push(c); } });
    await executeTool({
      id: "1", name: "write",
      argumentsText: JSON.stringify({ path: "/lib/n.md", content: "a\n" }),
    }, ctx);
    expect(writes).toEqual(["a\n"]);
  });

  it("write 越界遍历路径不审批", async () => {
    const writes: string[] = [];
    const ctx = ctxWith({ writeText: async (p, c) => { writes.push(`${p}:${c}`); } });
    const r = await executeTool({
      id: "1", name: "write",
      argumentsText: JSON.stringify({ path: "/lib/../outside.md", content: "x" }),
    }, ctx);
    expect(r.isError).toBe(true);
    expect(ctx.asked).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("edit 越界遍历路径不审批", async () => {
    let reads = 0;
    const ctx = ctxWith({
      readText: async () => { reads += 1; return "x"; },
      writeText: async () => {},
    });
    const r = await executeTool({
      id: "1", name: "edit",
      argumentsText: JSON.stringify({ path: "/lib/../outside.md", old_string: "x", new_string: "y" }),
    }, ctx);
    expect(r.isError).toBe(true);
    expect(ctx.asked).toEqual([]);
    expect(reads).toBe(0);
  });

  it("edit 精确替换；零匹配与多匹配报错", async () => {
    let saved = "";
    const ctx = ctxWith({ readText: async () => "foo bar foo", writeText: async (_p, c) => { saved = c; } });
    const ok = await executeTool({ id: "1", name: "edit",
      argumentsText: "{\"path\":\"/lib/a.md\",\"old_string\":\"bar\",\"new_string\":\"baz\"}" }, ctx);
    expect(saved).toBe("foo baz foo");
    const none = await executeTool({ id: "2", name: "edit",
      argumentsText: "{\"path\":\"/lib/a.md\",\"old_string\":\"不存在\",\"new_string\":\"x\"}" }, ctx);
    expect(none.isError).toBe(true); expect(none.content).toContain("未找到");
    const many = await executeTool({ id: "3", name: "edit",
      argumentsText: "{\"path\":\"/lib/a.md\",\"old_string\":\"foo\",\"new_string\":\"x\"}" }, ctx);
    expect(many.isError).toBe(true); expect(many.content).toContain("2");
    expect(ok.isError).toBeUndefined();
  });

  it("grep 结果格式化与截断标注", async () => {
    const ctx = ctxWith({ grep: async () => ({ truncated: true,
      matches: [{ path: "/lib/a.md", line: 3, text: "命中", before: ["上"], after: ["下"] }] }) });
    const r = await executeTool({ id: "1", name: "grep", argumentsText: "{\"pattern\":\"命中\"}" }, ctx);
    expect(r.content).toContain("/lib/a.md:3: 命中");
    expect(r.content).toContain("已截断");
    expect(r.content).toContain("上").and.toContain("下");
  });

  it("声明四工具且名称唯一", () => {
    expect(TOOL_DECLARATIONS.map((t) => t.name)).toEqual(["read", "grep", "write", "edit"]);
  });

  it("isUnauthorized 识别稳定前缀", () => {
    expect(isUnauthorized(new Error("UNAUTHORIZED_PATH|/x"))).toBe(true);
    expect(isUnauthorized(new Error("其他错误"))).toBe(false);
  });
});
