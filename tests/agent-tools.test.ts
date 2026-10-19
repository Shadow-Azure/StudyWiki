import { describe, expect, it } from "vitest";
import { executeTool, isUnauthorized, MAX_APPROVAL_PREVIEW_CHARACTERS, TOOL_DECLARATIONS,
  type ToolRunContext, type ApprovalOutcome, type ApprovalRequest } from "../src/plugins/agent-core/tools";
import { parseTimestampedLines } from "../src/plugins/agent-core/transcribe";

function ctxWith(
  host: Partial<ToolRunContext["host"]>,
  answer?: ApprovalOutcome,
): ToolRunContext & { asked: string[]; requests: ApprovalRequest[] } {
  const asked: string[] = [];
  const requests: ApprovalRequest[] = [];
  return {
    root: "/lib", asked, requests,
    host: { readText: async () => "1 行\n2 行", grep: async () => ({ matches: [], truncated: false }),
      writeText: async () => {}, authorizeRead: async () => {}, ...host },
    ask: async (req) => { asked.push(req.kind); requests.push(req); return answer ?? { decision: "allow" }; },
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

  it("write 审批请求携带有界预览且执行保留完整内容", async () => {
    const head = "机密笔记预览";
    const content = `${head}\n${"中".repeat(MAX_APPROVAL_PREVIEW_CHARACTERS * 2)}\n尾部标记`;
    let saved = "";
    const ctx = ctxWith({ writeText: async (_path, value) => { saved = value; } });
    await executeTool({
      id: "preview", name: "write",
      argumentsText: JSON.stringify({ path: "/lib/n.md", content }),
    }, ctx);
    expect(ctx.requests).toHaveLength(1);
    expect(ctx.requests[0]).not.toHaveProperty("newText");
    expect(ctx.requests[0]?.preview).toMatchObject({
      omitted: true,
      totalCharacters: content.length,
      totalLines: 3,
    });
    expect(ctx.requests[0]?.preview.text).toContain(head);
    expect(ctx.requests[0]?.preview.text).toContain("尾部标记");
    expect(ctx.requests[0]?.preview.text.length).toBeLessThanOrEqual(MAX_APPROVAL_PREVIEW_CHARACTERS);
    expect(saved).toBe(content);
  });

  it("edit 审批请求生成有界上下文 diff", async () => {
    const current = Array.from({ length: 20 }, (_, index) => `${index + 1} 行`).join("\n");
    const ctx = ctxWith({ readText: async () => current });
    await executeTool({
      id: "edit-preview", name: "edit",
      argumentsText: JSON.stringify({ path: "/lib/a.md", old_string: "10 行", new_string: "第十行" }),
    }, ctx);
    expect(ctx.requests[0]?.summary).toContain("旧 4 字符");
    expect(ctx.requests[0]?.summary).toContain("新 3 字符");
    expect(ctx.requests[0]?.preview).toMatchObject({
      omitted: false,
      totalCharacters: 7,
      totalLines: 2,
    });
    expect(ctx.requests[0]?.preview.text).toContain("@@ -7,7 +7,7 @@");
    expect(ctx.requests[0]?.preview.text).toContain("-10 行");
    expect(ctx.requests[0]?.preview.text).toContain("+第十行");
    expect(ctx.requests[0]?.preview.text).toContain(" 7 行");
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

  it("grep 格式化输出按 200KB 截断并标注", async () => {
    const line = "x".repeat(4096);
    const ctx = ctxWith({ grep: async () => ({
      truncated: false,
      matches: Array.from({ length: 200 }, (_, index) => ({
        path: `/lib/${index}.md`, line: 1, text: line, before: [], after: [],
      })),
    }) });
    const r = await executeTool({ id: "1", name: "grep", argumentsText: "{\"pattern\":\"x\"}" }, ctx);
    expect(r.content).toContain("（输出超过 200 KB，已截断）");
    expect(new TextEncoder().encode(r.content).length).toBeLessThanOrEqual(200 * 1024);
  });

  it("声明四工具且名称唯一", () => {
    expect(TOOL_DECLARATIONS.map((t) => t.name)).toEqual(["read", "grep", "write", "edit"]);
  });

  it("isUnauthorized 识别稳定前缀", () => {
    expect(isUnauthorized(new Error("UNAUTHORIZED_PATH|/x"))).toBe(true);
    expect(isUnauthorized(new Error("其他错误"))).toBe(false);
  });
});

describe("transcribe 工具", () => {
  const hookOk = {
    probeSize: async () => 2048,
    run: async () => ({ text: "全文", segments: [
      { start: 0, end: 4.2, text: "今天我们讲二叉树" },
      { start: 4.2, end: 9.8, text: "它的定义是" },
    ] }),
  };

  it("审批→执行→格式化落盘→摘要", async () => {
    const writes: string[] = [];
    const ctx = ctxWith({ writeText: async (p, c) => { writes.push(`${p}\n${c}`); } });
    ctx.transcribe = hookOk;
    const r = await executeTool({ id: "t1", name: "transcribe",
      argumentsText: JSON.stringify({ path: "/lib/courses/lecture-01.mp4", language: "zh" }) }, ctx);
    expect(ctx.asked).toEqual(["transcribe"]);
    expect(writes).toHaveLength(1);
    const newline = writes[0]!.indexOf("\n");
    const path = writes[0]!.slice(0, newline);
    const content = writes[0]!.slice(newline + 1);
    expect(path).toBe("/lib/.study-wiki/raw/courses/lecture-01/transcript.md");
    expect(content).toContain("source: courses/lecture-01.mp4");
    expect(content).toContain("timestamps: segment");
    expect(content).toContain("[00:00:00] 今天我们讲二叉树");
    expect(content).toContain("[00:00:04] 它的定义是");
    expect(r.content).toContain("2 段");
  });

  it("审批拒绝不上传", async () => {
    let ran = false;
    const ctx = ctxWith({}, { decision: "deny", reason: "不要上传" });
    ctx.transcribe = { probeSize: async () => 1, run: async () => { ran = true; return { text: "", segments: [] }; } };
    const r = await executeTool({ id: "t1", name: "transcribe",
      argumentsText: JSON.stringify({ path: "/lib/a.mp4" }) }, ctx);
    expect(ran).toBe(false);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("不要上传");
  });

  it("无时间戳回包降级单段并标注 timestamps: none", async () => {
    const writes: string[] = [];
    const ctx = ctxWith({ writeText: async (p, c) => { writes.push(c); } });
    ctx.transcribe = { probeSize: async () => 1, run: async () => ({ text: "一整段没有分段的文本", segments: [] }) };
    await executeTool({ id: "t1", name: "transcribe", argumentsText: JSON.stringify({ path: "/lib/a.mp4" }) }, ctx);
    expect(writes[0]).toContain("timestamps: none");
    expect(writes[0]).toContain("一整段没有分段的文本");
    expect(writes[0]).not.toContain("[00:00:");
  });

  it("chat 路文本按 80% 覆盖规则解析；不足则降级", async () => {
    const good = "[00:00:00] 第一句\n[00:00:04] 第二句\n[00:00:09] 第三句";
    const parsed = parseTimestampedLines(good);
    expect(parsed).toHaveLength(3);
    const writes: string[] = [];
    const ctx = ctxWith({ writeText: async (_p, c) => { writes.push(c); } });
    ctx.transcribe = { probeSize: async () => 1, run: async () => ({ text: `好的，以下是转录：\n[00:00:00] 短`, segments: [] }) };
    await executeTool({ id: "t1", name: "transcribe", argumentsText: JSON.stringify({ path: "/lib/a.mp4" }) }, ctx);
    expect(writes[0]).toContain("timestamps: none");
  });

  it("未注入 transcribe hook 时明确报错（配置被删的会话中途场景）", async () => {
    const ctx = ctxWith({});
    const r = await executeTool({ id: "t1", name: "transcribe", argumentsText: JSON.stringify({ path: "/lib/a.mp4" }) }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("未配置 ASR");
  });

  it("扩展名白名单预检", async () => {
    const ctx = ctxWith({});
    ctx.transcribe = hookOk;
    const r = await executeTool({ id: "t1", name: "transcribe", argumentsText: JSON.stringify({ path: "/lib/a.txt" }) }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("不支持");
  });
});
