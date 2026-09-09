// 门禁自测试：翻译供给链机械背书——术语表数据行两侧一致、禁用替写只在
// 英文侧散文执行（围栏/行内代码/生成区是示例或机器写的，不算数；术语表
// 自身豁免——它的数据行本来就要写禁用词）、提示词模板占位符集合精确。
// 夹具走 createGateRunner：cwd 即临时仓库根。

import { afterAll, describe, expect, it } from "vitest";
import { createGateRunner } from "./spec-fixture.mjs";

const gate = createGateRunner("verify-terminology.mjs", "terminology");
afterAll(gate.cleanup);

const TERMS = "# 术语表\n\n| 中文 | English | 禁用替写 |\n|---|---|---|\n| 门禁 | gate | checkpoint, sentinel |\n| 切换行 | switcher line | switching line |\n";
const TERMS_EN = "# Terminology\n\n| Chinese | English | Banned alternates |\n|---|---|---|\n| 门禁 | gate | checkpoint, sentinel |\n| 切换行 | switcher line | switching line |\n";
const PROMPT = "# 翻译提示词\n\n```text\n术语：{{terminology}}\n文档：{{source_document}}\n切换行：English | [中文]({{source_basename}})\n```\n";

function corpus(extra = {}) {
  return {
    "docs/i18n/terminology.md": TERMS,
    "docs/i18n/terminology.en.md": TERMS_EN,
    "docs/i18n/translation-prompt.md": PROMPT,
    ...extra,
  };
}

describe("verify-terminology（翻译供给链背书）", () => {
  it("术语表两侧数据行一致 + 干净语料 → 绿", async () => {
    const result = await gate.run(
      corpus({ "docs/architecture.en.md": "# Arch\n\nThe gate is green.\n" }),
    );
    expect(result.ok).toBe(true);
  });

  it("术语表数据行两侧不一致 → 红（术语对是语言中立数据）", async () => {
    const result = await gate.run(
      corpus({ "docs/i18n/terminology.en.md": TERMS_EN.replace("gate", "guard") }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("数据行");
  });

  it("英文侧散文出现禁用替写 → 红（报文件:行号与规范术语）", async () => {
    const result = await gate.run(
      corpus({ "docs/architecture.en.md": "# Arch\n\nRun the checkpoint before pushing.\n" }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("docs/architecture.en.md:3");
    expect(result.errors.join("\n")).toContain("gate");
  });

  it("禁用替写在围栏/行内代码/生成区 → 绿（示例与机器写不算数）", async () => {
    const result = await gate.run(
      corpus({
        "docs/architecture.en.md":
          "# Arch\n\nExample `checkpoint` inline.\n\n```md\nUse the checkpoint.\n```\n",
        "docs/commands.en.md":
          "# Commands\n\n<!-- BEGIN GENERATED commands -->\nthe checkpoint table\n<!-- END GENERATED commands -->\n",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("中文侧（base）出现替写不查 → 绿", async () => {
    const result = await gate.run(
      corpus({ "docs/architecture.md": "# 架构\n\n先跑 checkpoint。\n" }),
    );
    expect(result.ok).toBe(true);
  });

  it("提示词模板缺占位符 → 红", async () => {
    const broken = PROMPT.replace("{{source_basename}}", "x.md");
    const result = await gate.run(corpus({ "docs/i18n/translation-prompt.md": broken }));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("source_basename");
  });

  it("提示词模板出现未知占位符 → 红", async () => {
    const broken = PROMPT.replace("{{terminology}}", "{{terms}}");
    const result = await gate.run(corpus({ "docs/i18n/translation-prompt.md": broken }));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("terms");
  });

  it("缺术语表或提示词 → 红（点名缺件）", async () => {
    const result = await gate.run({ "docs/architecture.en.md": "# Arch\n\nok gate.\n" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("docs/i18n/terminology.md");
    expect(result.errors.join("\n")).toContain("docs/i18n/translation-prompt.md");
  });
});
