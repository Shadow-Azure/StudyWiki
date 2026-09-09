// 门禁自测试：md 段落一行到底。语义对齐蓝本 verify-md-wrap：散文段跨物理行
// 即红，列表项折行与引用内段落同理；围栏、生成区、表格、HTML 注释、冻结件
// 与清单外文件不误报、不进扫描面。

import { afterAll, describe, expect, it } from "vitest";
import { createGateRunner } from "./spec-fixture.mjs";

const { run, cleanup } = createGateRunner("verify-md-wrap.mjs", "md-wrap");
afterAll(cleanup);

describe("verify-md-wrap", () => {
  it("合规语料全绿（note 前三行/标题/单行段落/列表/表格/单行引用/hr/单行与多行注释/围栏/生成区）", async () => {
    const result = await run({
      ".agents/notes/implemented/process/2026-01-01-x.md": [
        "# Agent Note: 样例",
        "",
        "Status: implemented",
        "",
        "[English](2026-01-01-x.en.md) | 中文",
        "",
        "## Problem",
        "",
        "这是一个单行段落，写满一整行，不硬换行。",
        "",
        "第二段隔空行。",
        "",
        "## Decision",
        "",
        "- 列表项一，一行写完。",
        "- 列表项二。",
        "",
        "| 列一 | 列二 |",
        "|---|---|",
        "| a | b |",
        "",
        "> 引用段落也是单行。",
        "",
        "---",
        "",
        "<!-- 单行注释 -->",
        "",
        "<!--",
        "多行注释",
        "第二行",
        "-->",
        "",
        "```ts",
        "const a = 1;",
        "const b = 2;",
        "```",
        "",
        "<!-- BEGIN GENERATED commands (gen-commands-catalog.mjs) — do not edit between markers -->",
        "生成区里的",
        "多行内容不查。",
        "<!-- END GENERATED commands -->",
        "",
        "结尾段落。",
      ].join("\n"),
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("散文段跨物理行即红，报起始行；三行段落只报一次", async () => {
    const result = await run({
      "docs/architecture.md": [
        "# 架构",
        "",
        "这一段被硬换行成",
        "两行物理行。",
        "",
        "这一段更长，被切成",
        "三行",
        "物理行。",
      ].join("\n"),
    });
    expect(result.ok).toBe(false);
    const hits = result.errors.filter((e) => e.includes("architecture.md"));
    expect(hits.length).toBe(2);
    expect(hits[0]).toMatch(/architecture\.md:3/);
    expect(hits[0]).toContain("这一段被硬换行成");
    expect(hits.some((e) => /architecture\.md:6/.test(e))).toBe(true);
  });

  it("列表项折行与引用内段落跨行都红；引用内列表与连续引用列表不红", async () => {
    const result = await run({
      ".agents/notes/implemented/process/2026-01-01-x.md": [
        "# Agent Note: 样例",
        "",
        "Status: implemented",
        "",
        "## Problem",
        "",
        "- 列表项折行",
        "  续行在这里。",
        "",
        "> 引用一",
        "> 引用二。",
        "",
        "> - 引用列表 a",
        "> - 引用列表 b",
      ].join("\n"),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes(":7"))).toBe(true);
    expect(result.errors.some((e) => e.includes(":10"))).toBe(true);
    expect(result.errors.some((e) => e.includes("引用列表"))).toBe(false);
  });

  it("冻结件与清单外文件不查（archived/ 冻结快照、根下未列入清单的 md）", async () => {
    const result = await run({
      ".agents/notes/archived/process/2020-01-01-frozen.md": [
        "# Agent Note: 冻结样例",
        "",
        "冻结快照里的",
        "历史换行不改。",
      ].join("\n"),
      "NOTES.md": ["# 随手记", "", "清单外的", "文件不查。"].join("\n"),
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("英文侧与根清单文件（README.md / AGENTS.md）同样受查", async () => {
    const result = await run({
      "README.md": ["# StudyWiki", "", "wrapped", "english para."].join("\n"),
      "AGENTS.md": ["# AGENTS", "", "orders wrapped", "across lines."].join("\n"),
      "docs/foo.en.md": ["# Foo", "", "wrapped", "english side."].join("\n"),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /README\.md:3/.test(e))).toBe(true);
    expect(result.errors.some((e) => /AGENTS\.md:3/.test(e))).toBe(true);
    expect(result.errors.some((e) => /foo\.en\.md:3/.test(e))).toBe(true);
  });
});
