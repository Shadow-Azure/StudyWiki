#!/usr/bin/env node
// 归档助手：把一条 implemented note 三件套整体冻结入 .agents/notes/archived/{class}/。
// 是否归档是语义判断，归人（README：不向配额归档，字数/年龄只是发现辅助）；
// 本脚本只做机械部分：移动三件套 → base/en 第三行改 "Status: archived" →
// 每文件 sha256 记入 append-only manifest → 报告活语料里指向旧路径的链接（须同 PR 修补）。
// 用法：pnpm archive:note -- `.agents/notes/implemented/process/2026-01-01-x.md`

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pairAnchorOfArgument, pairPaths } from "./translation-pairing-lib.mjs";
import { parseArchivedManifest } from "./verify-archived-agent-notes.mjs";

const IMPLEMENTED = ".agents/notes/implemented/";
const ARCHIVED_ROOT = ".agents/notes/archived";
const MANIFEST_REL = `${ARCHIVED_ROOT}/manifest.json`;

const arg = process.argv.slice(2).filter((a) => a !== "--")[0];
if (!arg) {
  console.error("用法：pnpm archive:note -- <implemented note 的 base.md 路径>");
  process.exit(2);
}
const base = pairAnchorOfArgument(arg);
if (!base.startsWith(IMPLEMENTED)) {
  console.error(`archive: 只归档 implemented note（收到 ${base}；rejected 应删除，proposed 不能归档）`);
  process.exit(2);
}
const { base: baseAbs, en: enRel, meta: metaRel } = pairPaths(base);
const enAbs = path.resolve(enRel);
const metaAbs = path.resolve(metaRel);
for (const [rel, abs] of [[base, path.resolve(base)], [enRel, enAbs], [metaRel, metaAbs]])
  if (!existsSync(abs)) {
    console.error(`archive: 三件套不齐，缺 ${rel}`);
    process.exit(1);
  }

const cls = base.slice(IMPLEMENTED.length).split("/")[0];
const destDir = path.join(ARCHIVED_ROOT, cls);
mkdirSync(destDir, { recursive: true });

/** 第三行 Status → archived（yaml 侧无 Status，不改）。 */
function freezeStatus(abs) {
  const lines = readFileSync(abs, "utf8").split("\n");
  if (lines[2] !== "Status: implemented") {
    console.error(`archive: ${path.relative("", abs)} 第三行不是 "Status: implemented"，先修格式`);
    process.exit(1);
  }
  lines[2] = "Status: archived";
  writeFileSync(abs, lines.join("\n"));
}

const manifest = existsSync(MANIFEST_REL)
  ? parseArchivedManifest(readFileSync(MANIFEST_REL, "utf8"))
  : { entries: {} };

const moved = [];
for (const [srcAbs, srcRel] of [
  [path.resolve(base), base],
  [enAbs, enRel],
  [metaAbs, metaRel],
]) {
  const name = path.basename(srcRel);
  if (srcRel.endsWith(".md")) freezeStatus(srcAbs); // base 与 en；yaml 冻结原样
  const entryKey = `${ARCHIVED_ROOT}/${cls}/${name}`;
  if (manifest.entries[entryKey]) {
    console.error(`archive: 清单已有 ${entryKey}，拒绝覆盖（append-only）`);
    process.exit(1);
  }
  const dest = path.join(destDir, name);
  renameSync(srcAbs, dest);
  manifest.entries[entryKey] = createHash("sha256").update(readFileSync(dest)).digest("hex");
  moved.push(entryKey);
}

const sortedEntries = Object.fromEntries(Object.entries(manifest.entries).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(
  MANIFEST_REL,
  `${JSON.stringify(
    {
      "//": "归档冻结清单（append-only）：path → sha256（封存时字节）。只增不改不删；删除或解封须在 PR 显式说明理由。",
      entries: sortedEntries,
    },
    null,
    2,
  )}\n`,
);

// 活语料中指向旧路径的链接（挪走后这些链接会死，须同 PR 修补）。
async function collectMarkdown(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "archived" && dir.endsWith(path.join(".agents", "notes"))) continue;
      await collectMarkdown(full, out);
    } else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const targets = [base, enRel, path.basename(base), path.basename(enRel)];
const referrers = [];
for (const file of [...(await collectMarkdown(path.resolve("docs"))), ...(await collectMarkdown(path.resolve(".agents", "notes"))), path.resolve("README.md")]) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (targets.some((t) => line.includes(`](${t}`) || line.includes(`](${t.replace(/^\.\//, "")}`)))
      referrers.push(`${path.relative("", file)}:${i + 1}`);
  });
}

console.log(`archive: 已冻结 ${moved.length} 个文件入 ${destDir}/，清单 ${MANIFEST_REL} 追加 ${moved.length} 条。`);
if (referrers.length) console.log(`注意：活语料中 ${referrers.length} 处链接指向旧路径，须同 PR 修补：\n  ${referrers.join("\n  ")}`);
console.log("同 PR 提交三件套移动 + manifest.json；跑 pnpm lint:docs 验证。");
