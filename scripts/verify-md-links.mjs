#!/usr/bin/env node
// Gate: docs 与 Agent Notes 内的相对 markdown 链接可达（死链检查）。
// 外链（http/https）不在范围——那是发布投影的职责。

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOTS = [path.resolve("docs"), path.resolve(".agents/notes")];

async function collectMarkdown(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectMarkdown(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

export default async function verifyMdLinks() {
  const errors = [];
  const linkRe = /\]\(([^)#\s]+)(?:#[^)\s]*)?\)/g;

  for (const root of ROOTS) {
    for (const file of await collectMarkdown(root)) {
      const text = await readFile(file, "utf8");
      // 只查正文：围栏代码与行内代码里的"链接"是示例/代码，不是链接。
      const prose = text
        .replace(/```[\s\S]*?(?:```|$)/g, " ")
        .replace(/`[^`\n]*`/g, " ");
      for (const [, target] of prose.matchAll(linkRe)) {
        if (/^[a-z]+:\/\//i.test(target)) continue;
        const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
        if (!existsSync(resolved))
          errors.push(`${path.relative("", file)}: 死链 → ${target}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await verifyMdLinks();
  if (!result.ok) {
    console.error(`verify-md-links: FAIL\n  ${result.errors.join("\n  ")}`);
    process.exit(1);
  }
  console.log("verify-md-links: ok");
}
