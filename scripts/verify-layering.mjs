#!/usr/bin/env node
// 分层纪律扫描：src/plugins/** 禁触达 @tauri-apps/* 与 host 实现（值导入/副作用导入/转口导出）；
// src/** 禁动态装载（import()/eval/new Function）。
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const IMPORT_FROM = /(?<![\w.$])import\s*(type\s+)?[^"';]*?from\s*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT = /(?<![\w.$])import\s*["']([^"']+)["']/g;
const EXPORT_FROM = /(?<![\w.$])export\s*(type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/g;
const REQUIRE = /require\(\s*["']([^"']+)["']\s*\)/g;
const HOST_RE = /(\.\.\/)+host(\/|$)/;
const FORBIDDEN = (spec) => spec.startsWith("@tauri-apps/") || HOST_RE.test(spec);
const SEAMS = [
  { name: "动态 import()", re: /(?<![.\w])import\s*\(/g },
  { name: "eval(", re: /(?<![.\w])eval\s*\(/g },
  { name: "new Function(", re: /new\s+Function\s*\(/g },
];

/**
 * Plugin-layer scan: runtime reach of @tauri-apps/* or ../host is a violation —
 * value imports, side-effect imports (`import "spec"`) and re-exports (`export … from "spec"`);
 * `import type` / `export type` are compile-time-only and allowed.
 * @param {string} relPath 相对仓库根的文件路径（仅用于报错信息定位）。
 * @param {string} code 该文件的完整源码文本。
 * @returns {string[]} 违规明细列表（每项一条，空数组即该文件合规）。
 */
export function scanPluginSource(relPath, code) {
  const violations = [];
  for (const m of code.matchAll(IMPORT_FROM)) {
    const [, isType, spec] = m;
    if (isType) continue;
    if (spec.startsWith("@tauri-apps/")) violations.push(`${relPath}: 值导入 ${spec}（插件只能经 ctx.* 宿主服务）`);
    if (HOST_RE.test(spec)) violations.push(`${relPath}: 值导入宿主实现 ${spec}（import type 放行）`);
  }
  for (const m of code.matchAll(SIDE_EFFECT_IMPORT)) {
    if (FORBIDDEN(m[1])) violations.push(`${relPath}: 副作用导入 ${m[1]}（插件只能经 ctx.* 宿主服务）`);
  }
  for (const m of code.matchAll(EXPORT_FROM)) {
    const [, isType, spec] = m;
    if (isType) continue;
    if (FORBIDDEN(spec)) violations.push(`${relPath}: 转口值导出 ${spec}（插件只能经 ctx.* 宿主服务）`);
  }
  for (const m of code.matchAll(REQUIRE)) {
    if (FORBIDDEN(m[1])) {
      violations.push(`${relPath}: require ${m[1]}`);
    }
  }
  return violations;
}

/**
 * Loading-seam scan: dynamic import/eval/new Function in src/**, minus allowlist.
 * @param {string} relPath 相对仓库根的文件路径（与白名单登记路径精确匹配）。
 * @param {string} code 该文件的完整源码文本（行注释与块注释先粗剪枝）。
 * @param {string[]} allowlist 白名单文件路径列表（相对仓库根，精确匹配放行）。
 * @returns {string[]} 违规明细列表（每项一条，空数组即该文件零装载缝）。
 */
export function scanLoadingSeams(relPath, code, allowlist) {
  if (allowlist.includes(relPath)) return [];
  const violations = [];
  const noComments = code.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const seam of SEAMS) {
    seam.re.lastIndex = 0; // /g 正则的 .test 携带 lastIndex，不重置会跨文件漏报
    if (seam.re.test(noComments)) violations.push(`${relPath}: ${seam.name}`);
  }
  return violations;
}

function* walkTs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkTs(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) yield p;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // cwd 相对（pnpm script 保证从仓库根跑），同 verify-dep-audit 等既有门禁；
  // 白名单 JSON 仍走脚本相对 URL（与脚本同目录，不随调用方 cwd 漂移）。
  const root = process.cwd();
  const allowlist = JSON.parse(readFileSync(new URL("./layering-allowlist.json", import.meta.url), "utf8")).files;
  const violations = [];
  const srcDir = path.join(root, "src");
  for (const file of walkTs(srcDir)) {
    const rel = path.relative(root, file);
    const code = readFileSync(file, "utf8");
    violations.push(...scanLoadingSeams(rel, code, allowlist));
    if (rel.startsWith("src/plugins/") || rel === "src/plugins") {
      violations.push(...scanPluginSource(rel, code));
    }
  }
  if (violations.length) {
    console.error(`[layering] 分层/装载缝扫描失败（${violations.length} 项）：`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log("[layering] 分层纪律与装载缝扫描通过");
}
