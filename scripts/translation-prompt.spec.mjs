// 门禁自测试：翻译提示词的渲染契约（蓝本 verify-translation-prompt 的裁剪移植）。
// 占位符集合校验归 verify-terminology ③；本 spec 管"模板真的能渲染"：从
// docs/i18n/translation-prompt.md 抽模板围栏，用合成术语表 + 合成文档渲染三
// 占位符，与内联快照逐字比对——围栏结构、语言切换行、分节横线被无意改动即红。
// 合成夹具不触真语料：改配对文档不该搅动提示词快照。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FENCE_OPEN_RE } from "./translation-pairing-lib.mjs";

const PROMPT = "docs/i18n/translation-prompt.md";
const PROMPT_EN = "docs/i18n/translation-prompt.en.md";

/** 抽 info 为 "text" 的围栏内容；恰好一个，否则抛（文档重构须带上本 spec）。 */
function templateFence(docPath) {
  const lines = readFileSync(docPath, "utf8").split("\n");
  const blocks = [];
  let fence = null; // { marker, info, body }
  for (const line of lines) {
    const match = FENCE_OPEN_RE.exec(line);
    if (fence === null) {
      if (match) fence = { marker: match[1], info: match[2].trim(), body: [] };
    } else if (match && line.trim().startsWith(fence.marker)) {
      if (fence.info === "text") blocks.push(fence.body.join("\n"));
      fence = null;
    } else {
      fence.body.push(line);
    }
  }
  if (blocks.length !== 1) throw new Error(`${docPath}: 恰好一个 \`\`\`text 模板围栏，实得 ${blocks.length} 个`);
  return blocks[0];
}

/** 渲染：已知占位符替换，未知占位符抛（与 verify-terminology ③ 同口径的兜底）。 */
function render(template, values) {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`未知占位符 {{${key}}}`);
    return values[key];
  });
}

const terminology = [
  "| 中文 | English | 禁用替写 |",
  "|---|---|---|",
  "| 门禁 | gate | 红线、拦截器 |",
  "| 三件套 | triplet | 三件、套件 |",
].join("\n");

const sourceDocument = [
  "# 学习库",
  "",
  "English | [中文](library.md)",
  "",
  "正文一段，含 [链接](other.md) 与 `行内代码`。",
  "",
  "| 列一 | 列二 |",
  "|---|---|",
  "| a | b |",
].join("\n");

describe("翻译提示词渲染", () => {
  const template = templateFence(PROMPT);
  const rendered = render(template, {
    source_basename: "library.md",
    terminology,
    source_document: sourceDocument,
  });

  it("渲染结果与快照逐字一致（模板围栏被无意改动即红）", () => {
    expect(rendered).toBe(
      [
        "你是 StudyWiki 的文档译者：把下面的中文文档整体译成英文，产出即英文侧文件全文。",
        "",
        "规则：",
        "1. 术语按术语表执行，禁用替写一个不能出现。",
        "2. 围栏与生成区逐字复制，不翻译；行内代码里的示例逐字保留。",
        "3. 结构与中文侧镜像：标题层级、表格行列、列表项、链接目标一一对应。",
        "4. 语言切换行固定为：English | [中文](library.md)",
        "5. 指向语料内文档的相对链接用英文侧文件名（.en.md）。",
        "",
        "=== 术语表 ===",
        terminology,
        "",
        "=== 中文文档 ===",
        sourceDocument,
      ].join("\n"),
    );
  });

  it("替换完整：无残留占位符，术语表与文档全文各恰好出现一次", () => {
    expect(rendered).not.toMatch(/\{\{/);
    expect(rendered.split(terminology)).toHaveLength(2);
    expect(rendered.split(sourceDocument)).toHaveLength(2);
  });

  it("英文侧模板围栏与中文侧逐字一致（配对门禁的提示词侧就地背书）", () => {
    expect(templateFence(PROMPT_EN)).toBe(template);
  });
});
