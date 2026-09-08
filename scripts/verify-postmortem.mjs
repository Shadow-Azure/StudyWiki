#!/usr/bin/env node
// Gate: postmortem 结构（home：docs/postmortem/README.md）。
// 事故层是全库唯一允许叙事的层级，自由度的义务由本门禁钉住：文件名
// NNNN-主题.*、编号从 0001 连续不重复、每个 md 侧（base 与 .en.md）四段
// 标题逐字齐全且顺序固定。SECTIONS 与 README 的固定结构互为镜像——
// 加/改段须同 PR 改 README 与本清单（spec 断言两侧一致）。

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(path.resolve(""), "docs", "postmortem");

export const SECTIONS = ["Executive summary", "Timeline", "Root cause", "Action items"];

async function collectMarkdown(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectMarkdown(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** 一个 md 侧的四段结构校验（H1 + ## 段落序列与 SECTIONS 深等价）。 */
function checkStructure(rel, text, errors) {
  if (!/^# .+/.test(text)) errors.push(`${rel}: 首行须为 H1 标题`);
  const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  if (JSON.stringify(headings) === JSON.stringify(SECTIONS)) return;
  const missing = SECTIONS.filter((s) => !headings.includes(s));
  const extra = headings.filter((h) => !SECTIONS.includes(h));
  const order = missing.length === 0 && extra.length === 0 ? "顺序不符" : "";
  const detail = [`缺 ${missing.join(" / ")}`, `多 ${extra.join(" / ")}`, order]
    .filter((part) => part && part !== "缺 " && part !== "多 ")
    .join("，");
  errors.push(`${rel}: 四段 ${SECTIONS.join(" / ")} 顺序齐全——${detail}`);
}

export default async function verifyPostmortem() {
  const errors = [];

  const files = (await collectMarkdown(ROOT)).filter((f) => !path.basename(f).startsWith("README."));
  const relOf = (file) => path.relative(path.resolve(""), file).split(path.sep).join("/");

  // 结构：每个事故件 md 侧独立校验（base 与 .en.md 各自四段齐全）。
  for (const file of files) checkStructure(relOf(file), await readFile(file, "utf8"), errors);

  // 编号：NNNN 连续从 0001 起、不重复（按词干归并两侧）。
  const byNumber = new Map();
  for (const file of files) {
    const rel = relOf(file);
    const name = path.basename(rel).replace(/\.en\.md$/, ".md");
    const match = /^(\d{4})-.+\.md$/.exec(name);
    if (!match) {
      errors.push(`${rel}: 文件名须为 NNNN-主题.md`);
      continue;
    }
    const group = byNumber.get(match[1]) ?? new Set();
    group.add(name.replace(/\.md$/, ""));
    byNumber.set(match[1], group);
  }
  const numbers = [...byNumber.keys()].sort();
  for (const [number, stems] of byNumber)
    if (stems.size > 1) errors.push(`docs/postmortem: 编号 ${number} 重复（${[...stems].join(" / ")}）`);
  for (let i = 0; i < numbers.length; i += 1)
    if (Number(numbers[i]) !== i + 1) {
      errors.push(`docs/postmortem: 编号须从 0001 连续——缺 ${String(i + 1).padStart(4, "0")}`);
      break;
    }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    summary: `verify-postmortem: ${byNumber.size} 篇事故件结构合法（编号连续、四段两侧齐全）`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await verifyPostmortem();
  if (!result.ok) {
    console.error(`verify-postmortem: FAIL\n  ${result.errors.join("\n  ")}`);
    process.exit(1);
  }
  console.log(result.summary ?? "verify-postmortem: ok");
}
