// 门禁自测试：词数计数（中英混排下两侧权重一致的门禁基础）+ 编排层——
// 前向（登记须存在、超限红）与反向对账（常驻即须登记，未登记即免检是漏洞）。
// 夹具走 createGateRunner：cwd 即临时仓库根（manifest 从 cwd 读）。

import { afterAll, describe, expect, it } from "vitest";
import { countWords } from "./verify-doc-budgets.mjs";
import { createGateRunner } from "./spec-fixture.mjs";

const gate = createGateRunner("verify-doc-budgets.mjs", "doc-budgets");
afterAll(gate.cleanup);

const manifest = (entries) =>
  JSON.stringify({ "//": "常驻文档词数上限。", ...entries });

describe("countWords", () => {
  it("空白分词", () => {
    expect(countWords("hello world")).toBe(2);
    expect(countWords("")).toBe(0);
    expect(countWords("  \n\t ")).toBe(0);
  });
  it("CJK 按字计", () => {
    expect(countWords("你好世界")).toBe(4);
  });
  it("中英混排权重一致", () => {
    expect(countWords("你好 world")).toBe(3);
    expect(countWords("env 无关性 hard constraint")).toBe(6);
  });
});

describe("verify-doc-budgets（编排层）", () => {
  it("常驻 docs 文档未登记预算 → 红（未登记即免检是漏洞）", async () => {
    const result = await gate.run({
      "scripts/doc-budgets.manifest.json": manifest({}),
      "docs/foo.md": "# 文\n\n正文。\n",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("docs/foo.md");
    expect(result.errors.join("\n")).toContain("未登记预算");
  });

  it("根三件（README.md、AGENTS.md、.agents/notes/README.md）同样必须登记", async () => {
    const result = await gate.run({
      "scripts/doc-budgets.manifest.json": manifest({}),
      "README.md": "# StudyWiki\n",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("README.md");
    expect(result.errors.join("\n")).toContain("未登记预算");
  });

  it("postmortem 事故件是冻结历史 → 未登记不红（README.md 才是常驻规则文档）", async () => {
    const result = await gate.run({
      "scripts/doc-budgets.manifest.json": manifest({}),
      "docs/postmortem/2026-01-01-crash.md": "# 事故\n\n冻结历史。\n",
    });
    expect(result.ok).toBe(true);
  });

  it(".en.md 不登记（预算按 base 侧计）→ 绿", async () => {
    const result = await gate.run({
      "scripts/doc-budgets.manifest.json": manifest({ "docs/foo.md": 100 }),
      "docs/foo.md": "# 文\n\n正文。\n",
      "docs/foo.en.md": "# Doc\n\nBody.\n",
    });
    expect(result.ok).toBe(true);
  });

  it("登记的文件不存在 → 红（既有前向对账，钉住）", async () => {
    const result = await gate.run({
      "scripts/doc-budgets.manifest.json": manifest({ "docs/ghost.md": 100 }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("预算登记了但文件不存在");
  });

  it("超预算 → 红，报词数与上限", async () => {
    const result = await gate.run({
      "scripts/doc-budgets.manifest.json": manifest({ "docs/foo.md": 1 }),
      "docs/foo.md": "# 文档标题与正文远超一词\n",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("超预算 1");
  });
});
