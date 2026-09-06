#!/usr/bin/env node
// Gate: Agent Note 体系完整性（路径状态机 + 前三行格式 + 互引链接）。
// 规则 home：.agents/notes/README.md。加 class/lifecycle 须同步改本文件的封闭集合。

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const NOTES_ROOT = path.resolve(".agents/notes");
// 与 README.md「分类（封闭集合）」互为镜像，改一处必改另一处。
const LIFECYCLES = new Set(["proposed", "implemented", "rejected", "archived"]);
const CLASSES = new Set([
  "feature",
  "bug-fix",
  "simplification",
  "architecture",
  "process",
  "testing",
]);

async function collectMarkdown(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await collectMarkdown(path.join(dir, entry.name), out);
    else if (entry.name.endsWith(".md")) out.push(path.join(dir, entry.name));
  }
  return out;
}

/** 相对链接可达性；返回损坏链接列表。 */
function checkLinks(filePath, lines) {
  const broken = [];
  const linkRe = /\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g;
  for (const line of lines) {
    for (const [, target] of line.matchAll(linkRe)) {
      if (/^[a-z]+:\/\//i.test(target)) continue; // 外链不在本门禁范围
      const resolved = path.resolve(path.dirname(filePath), target);
      if (!existsSync(resolved)) {
        broken.push(`${path.relative("", filePath)}: 链接目标不存在 → ${target}`);
      }
    }
  }
  return broken;
}

export default async function verifyAgentNotes() {
  const errors = [];
  const files = (await collectMarkdown(NOTES_ROOT)).filter(
    (f) => !f.endsWith(path.join("notes", "README.md")) && !f.endsWith("AGENTS.md"),
  );

  for (const file of files) {
    const rel = path.relative("", file);
    const relToRoot = path.relative(NOTES_ROOT, file);
    const segments = relToRoot.split(path.sep);

    if (segments.length !== 3 || !segments[2].endsWith(".md")) {
      errors.push(`${rel}: 路径必须为 {lifecycle}/{class}/yyyy-mm-dd-主题.md`);
      continue;
    }
    const [lifecycle, cls, name] = segments;
    if (!LIFECYCLES.has(lifecycle))
      errors.push(`${rel}: 非法 lifecycle "${lifecycle}"（合法：${[...LIFECYCLES].join("/")}）`);
    if (lifecycle === "archived" && cls === "implemented") {
      // archived 树省略 implemented 层（只有 implemented 才能进 archived）
    } else if (!CLASSES.has(cls)) {
      errors.push(`${rel}: 非法 class "${cls}"（合法：${[...CLASSES].join("/")}）`);
    }
    if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(name))
      errors.push(`${rel}: 文件名须为 yyyy-mm-dd-主题.md`);

    const text = await readFile(file, "utf8");
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
