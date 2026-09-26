#!/usr/bin/env node
// 依赖面审计（环境无关铁律的机械背书）：白名单精确 diff + 直连依赖包内 node: 内建引用扫描。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const NODE_REF = /(["'])node:[a-z][\w.-]*\1/g;
// 裸内建引用（无 node: 前缀）：require("fs") / import x from "fs"。Node 内建清单有限可枚举；
// 命中是否报错按"该包是否经 browser 字段改道"分流（见 browserRedirect）。
const BARE_BUILTIN_REF = [
  /\brequire\(\s*["']([a-z][\w.-]*(?:\/[a-z][\w.-]*)*)["']\s*\)/g,
  /\bfrom\s*["']([a-z][\w.-]*(?:\/[a-z][\w.-]*)*)["']/g,
];
const BUILTIN_MODULES = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants",
  "crypto", "dgram", "diagnostics_channel", "dns", "domain", "events", "fs", "http", "http2",
  "https", "inspector", "module", "net", "os", "path", "perf_hooks", "process", "punycode",
  "querystring", "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls",
  "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);
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
    for (const hit of scanBareBuiltinRefs(dir)) {
      if (exempt.includes(hit.file)) continue;
      errors.push(`裸内建引用（无 browser 改道）：${dep}/${hit.file} → ${hit.match}`);
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

/** browser 字段改道三态：entry（string 指向替代入口文件）/ mapped（object 模块级映射）/ none。
 * 改道包的 node 入口引用不会进产物（Vite/Rollup 按 browser 解析替代），裸内建命中据此分流。 */
function browserRedirect(dir) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    if (typeof pkg.browser === "string") return { kind: "entry", file: path.resolve(dir, pkg.browser) };
    if (pkg.browser && typeof pkg.browser === "object") return { kind: "mapped" };
  } catch { /* 无 package.json 视为未改道 */ }
  return { kind: "none" };
}

function bareBuiltinMatches(src) {
  const matches = [];
  for (const rx of BARE_BUILTIN_REF)
    for (const m of src.matchAll(rx)) {
      const root = m[1].split("/")[0];
      if (BUILTIN_MODULES.has(root)) matches.push(m[0]);
    }
  return matches;
}

/** 裸内建扫描：无 browser 字段 → 全部命中；string 改道 → 非入口文件的命中跳过（不进产物），
 * 入口文件自身照红（会进产物）；object 映射 → 整包跳过。 */
function scanBareBuiltinRefs(dir) {
  const redirect = browserRedirect(dir);
  if (redirect.kind === "mapped") return [];
  const hits = [];
  for (const file of walkFiles(dir)) {
    if (redirect.kind === "entry" && path.resolve(file) !== redirect.file) continue;
    const src = readFileSync(file, "utf8");
    for (const match of bareBuiltinMatches(src)) hits.push({ file: path.relative(dir, file), match });
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
