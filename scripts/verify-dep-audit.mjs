#!/usr/bin/env node
// 依赖面审计（环境无关铁律的机械背书）：白名单精确 diff + 直连依赖包内 node: 内建引用扫描。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const NODE_REF = /(["'])node:[a-z][\w.-]*\1/g;
const SCAN_EXTS = new Set([".js", ".cjs", ".mjs"]);

/** Core audit: pure, fixture-testable. nodeRefExempt: dep → 包内相对路径豁免表（bin 等确认不进 bundle 的文件）。 */
export function auditDependencies(pkgJson, allowlist, nodeModulesDir, nodeRefExempt = {}) {
  const errors = [];
  const deps = Object.keys(pkgJson.dependencies ?? {});
  for (const dep of deps) {
    if (!allowlist.includes(dep)) errors.push(`依赖未登记白名单：${dep}（登记 scripts/dep-allowlist.json 并在 PR 说明理由）`);
  }
  for (const entry of allowlist) {
    if (!deps.includes(entry)) errors.push(`白名单过期：${entry} 已不在 dependencies`);
  }
  for (const dep of deps) {
    const dir = path.join(nodeModulesDir, dep);
    if (!existsSync(dir)) { errors.push(`依赖目录缺失：${dir}（先 pnpm install）`); continue; }
    const exempt = nodeRefExempt[dep] ?? [];
    for (const hit of scanNodeRefs(dir)) {
      if (exempt.includes(hit.file)) continue;
      errors.push(`node: 内建引用：${dep}/${hit.file} → ${hit.match}`);
    }
  }
  return { errors };
}

function* walkFiles(dir) {
  for (const entry of readDirSafe(dir)) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(p);
    else if (SCAN_EXTS.has(path.extname(entry.name))) yield p;
  }
}

function readDirSafe(dir) {
  try { return [...readdirSync(dir, { withFileTypes: true })]; } catch { return []; }
}

function scanNodeRefs(dir) {
  const hits = [];
  for (const file of walkFiles(dir)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(NODE_REF)) hits.push({ file: path.relative(dir, file), match: m[0] });
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // cwd 相对（pnpm script 保证从仓库根跑），同 verify-env-independence 等既有门禁。
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const allowlistJson = JSON.parse(readFileSync(new URL("./dep-allowlist.json", import.meta.url), "utf8"));
  const { errors } = auditDependencies(pkg, allowlistJson.deps, "node_modules", allowlistJson.nodeRefExempt);
  if (errors.length) {
    console.error(`[dep-audit] 依赖面审计失败（${errors.length} 项）：`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log("[dep-audit] 依赖面审计通过");
}
