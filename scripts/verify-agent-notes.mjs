#!/usr/bin/env node
// Gate: Agent Note 体系完整性（路径状态机 + 前三行格式 + 正文四段骨架 + 互引链接）。
// 规则 home：.agents/notes/README.md。加 class/lifecycle/骨架段须同步改本文件的封闭集合。
// archived/ 树不在此列——冻结件由 verify-archived-agent-notes 管辖（sha256 + append-only）。

import { readdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { documentAnchors, parseLinkTarget } from "./translation-pairing-lib.mjs";

const NOTES_ROOT = path.resolve(".agents/notes");
// 与 README.md「分类（封闭集合）」互为镜像，改一处必改另一处（spec 互检）。
export const LIFECYCLES = new Set(["proposed", "implemented", "rejected", "archived"]);
export const CLASSES = new Set([
  "feature",
  "bug-fix",
  "simplification",
  "architecture",
  "process",
  "testing",
]);
// 正文骨架段名（README「文件格式」互为镜像，spec 互检）：段名逐字、按序，
// 自由段只许插在骨架段之间（首段必须 Problem，末段之后不许再放二级标题）。
export const SKELETON = ["Problem", "Decision", "Alternatives considered", "Consequences"];

async function collectMarkdown(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await collectMarkdown(path.join(dir, entry.name), out);
    else if (entry.name.endsWith(".md")) out.push(path.join(dir, entry.name));
  }
  return out;
}

/** 相对链接可达性与锚点命中；返回损坏链接列表。 */
function checkLinks(filePath, lines) {
  const broken = [];
  const linkRe = /\]\(([^)\s]+)\)/g;
  for (const line of lines) {
    for (const [, target] of line.matchAll(linkRe)) {
      const { external, path: targetPath, fragment } = parseLinkTarget(target);
      if (external) continue; // 外链不在本门禁范围
      // 纯 #frag 是同文件锚：目标就是链接所在文件。
      const resolved = targetPath ? path.resolve(path.dirname(filePath), targetPath) : filePath;
      if (!existsSync(resolved)) {
        broken.push(`${path.relative("", filePath)}: 链接目标不存在 → ${target}`);
        continue;
      }
      if (fragment && resolved.endsWith(".md") && !documentAnchors(readFileSync(resolved, "utf8")).has(fragment))
        broken.push(`${path.relative("", filePath)}: 死锚 → ${target}`);
    }
  }
  return broken;
}

/** 围栏剔除后的文本：围栏里的 `##` 是示例代码，不构成文档结构。 */
function stripFences(text) {
  const kept = [];
  let fence = null;
  for (const line of text.split("\n")) {
    const open = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (!fence && open) {
      fence = { char: open[1][0], length: open[1].length };
      continue;
    }
    if (fence) {
      const close = new RegExp(`^\\s{0,3}\\${fence.char}{${fence.length},}\\s*$`).exec(line);
      if (close) fence = null;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

/**
 * 正文骨架检查（README「文件格式」的机械执行）：首段逐字 `## Problem`，
 * 四段按序齐全（子序列），自由段只许插在骨架段之间。base 与 .en.md 两侧
 * 各自适用——配对门禁的结构签名只比对层级不比段名，段名漂移由此钉住。
 * @param {string} rel 展示用相对路径。
 * @param {string} text 完整 Markdown 文本。
 * @returns {string[]} 错误清单（空数组 ⇔ 合规）。
 */
export function skeletonErrors(rel, text) {
  const headings = [...stripFences(text).matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  const errors = [];
  if (headings[0] !== SKELETON[0])
    errors.push(`${rel}: 首个二级标题须逐字为 "## Problem"`);

  let cursor = 0;
  const positions = [];
  for (const name of SKELETON) {
    const at = headings.indexOf(name, cursor);
    if (at === -1) break;
    positions.push(at);
    cursor = at + 1;
  }
  if (positions.length === SKELETON.length) {
    if (positions[positions.length - 1] !== headings.length - 1)
      errors.push(`${rel}: 骨架末段 "## Consequences" 之后不允许再放二级标题（自由段只能插在骨架段之间）`);
    return errors;
  }
  const missing = SKELETON.filter((name) => !headings.includes(name));
  if (missing.length)
    errors.push(`${rel}: 正文骨架缺 ${missing.map((s) => `"## ${s}"`).join("、")}（段名逐字，见 README「文件格式」）`);
  else errors.push(`${rel}: 骨架四段须按 Problem → Decision → Alternatives considered → Consequences 排序`);
  return errors;
}

export default async function verifyAgentNotes() {
  const errors = [];
  const files = (await collectMarkdown(NOTES_ROOT)).filter(
    (f) =>
      !f.startsWith(path.join(NOTES_ROOT, "archived") + path.sep) && // 冻结件归 verify-archived-agent-notes
      !/README(\.en)?\.md$/.test(f) &&
      !f.endsWith("AGENTS.md"),
  );

  for (const file of files) {
    const rel = path.relative("", file);
    const text = await readFile(file, "utf8");
    // 正文骨架两侧各自钉住（postmortem 门禁同例）。
    errors.push(...skeletonErrors(rel, text));
    // 英文侧其余检查随 base（配对门禁管辖），到此为止。
    if (rel.endsWith(".en.md")) continue;

    const relToRoot = path.relative(NOTES_ROOT, file);
    const segments = relToRoot.split(path.sep);

    if (segments.length !== 3 || !segments[2].endsWith(".md")) {
      errors.push(`${rel}: 路径必须为 {lifecycle}/{class}/yyyy-mm-dd-主题.md`);
      continue;
    }
    const [lifecycle, cls, name] = segments;
    if (!LIFECYCLES.has(lifecycle))
      errors.push(`${rel}: 非法 lifecycle "${lifecycle}"（合法：${[...LIFECYCLES].join("/")}）`);
    if (!CLASSES.has(cls)) {
      errors.push(`${rel}: 非法 class "${cls}"（合法：${[...CLASSES].join("/")}）`);
    }
    if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(name))
      errors.push(`${rel}: 文件名须为 yyyy-mm-dd-主题.md`);

    const lines = text.split("\n");
    if (!lines[0]?.startsWith("# Agent Note: "))
      errors.push(`${rel}: 第一行必须为 "# Agent Note: <标题>"`);
    const statusLine = lines[2] ?? "";
    if (!/^Status: /.test(statusLine)) {
      errors.push(`${rel}: 第三行必须为 "Status: <status>"`);
    } else {
      const value = statusLine.slice("Status: ".length).trim();
      if (lifecycle === "rejected" && !value.startsWith("rejected — "))
        errors.push(`${rel}: rejected note 的 Status 必须带一行理由（"rejected — …"）`);
      if (lifecycle !== "rejected" && value !== lifecycle)
        errors.push(`${rel}: Status "${value}" 与所在文件夹 "${lifecycle}" 不一致`);
      if (lifecycle === "rejected" && !value.startsWith("rejected"))
        errors.push(`${rel}: rejected note 的 Status 必须以 "rejected" 开头`);
    }
    errors.push(...checkLinks(file, lines));
  }

  return { ok: errors.length === 0, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await verifyAgentNotes();
  if (!result.ok) {
    console.error(`verify-agent-notes: FAIL\n  ${result.errors.join("\n  ")}`);
    process.exit(1);
  }
  console.log("verify-agent-notes: ok");
}
