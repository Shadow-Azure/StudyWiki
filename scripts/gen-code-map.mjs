#!/usr/bin/env node
// 架构组成树生成器：扫描 src/**/*.{ts,css} 与 src-tauri/src/**/*.rs，职责从
// code-map.manifest.json 取（唯一 home，新文件不登记即红），内部依赖从源码
// import 推导（TS 相对 import；Rust mod 声明 + lib crate 引用），渲染进
// docs/architecture.md 两侧的生成区（区块内容两侧逐字节一致）。--check 即
// verify：重新生成后与磁盘比对，加/删/改源文件或 import 而没再生成即红。

import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve("");
const MANIFEST = "scripts/code-map.manifest.json";
const TARGETS = ["docs/architecture.md", "docs/architecture.en.md"];
const SLUG = "code-map";
const BEGIN = `<!-- BEGIN GENERATED ${SLUG} (scripts/gen-code-map.mjs) — do not edit between markers -->`;
const END = `<!-- END GENERATED ${SLUG} -->`;
export const REGION_MARKERS = { BEGIN, END };

/** 扫描根：display 是 manifest 键与树上的目录行，dir 是实际目录。exts 为空的根不收
 *  文件、只渲染一行聚合（vendor/：vendored 上游源码，不逐文件入树，登记见 VENDORED.md）。 */
export const SCAN_ROOTS = [
  { display: "src", dir: "src", exts: [".ts", ".css"] },
  { display: "src-tauri", dir: "src-tauri/src", exts: [".rs"] },
  { display: "vendor", dir: "vendor", exts: [] },
];

/** 递归收集扫描根下的源文件（repo 相对 posix 路径，按路径排序）。 */
export async function collectSourceFiles(rootDir = ROOT) {
  const out = [];
  for (const { dir, exts } of SCAN_ROOTS) {
    const walk = async (rel) => {
      const full = path.join(rootDir, rel);
      if (!existsSync(full)) return;
      for (const entry of await readdir(full, { withFileTypes: true })) {
        const relPath = `${rel}/${entry.name}`;
        if (entry.isDirectory()) await walk(relPath);
        else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(relPath);
      }
    };
    await walk(dir);
  }
  return out.sort();
}

/** 对账磁盘文件 ↔ manifest（两个根的职责 + 每个文件的职责）。返回错误列表，空即通过。 */
export function reconcileManifest(files, manifest) {
  const errors = [];
  for (const { display } of SCAN_ROOTS)
    if (typeof manifest[display] !== "string")
      errors.push(`根目录 ${display}/ 缺职责登记（manifest 键 "${display}"）`);
  const registered = new Set(Object.keys(manifest).filter((key) => key !== "//"));
  for (const { display } of SCAN_ROOTS) registered.delete(display);
  const known = new Set(files);
  const missing = files.filter((file) => !registered.has(file));
  const orphan = [...registered].filter((key) => !known.has(key));
  if (missing.length) errors.push(`未登记的源文件（加进 ${MANIFEST}）：${missing.join("、")}`);
  if (orphan.length) errors.push(`manifest 登记了已不存在的文件（删源码后忘清）：${orphan.join("、")}`);
  return errors;
}

/** TS 相对 import 说明符（import/from 后的 "./x"；去重保序，外部包不算）。 */
export function tsImportSpecs(source) {
  const specs = [];
  for (const [, spec] of source.matchAll(/(?:import|from)\s+"(\.[^"]+)"/g))
    if (!specs.includes(spec)) specs.push(spec);
  return specs;
}

/** 相对说明符 → 已知源文件（无扩展名试 .ts）；解析不到返回 null。 */
export function resolveTsSpec(fromFile, spec, known) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  return known.has(base) ? base : known.has(`${base}.ts`) ? `${base}.ts` : null;
}

/** Rust 文件模块声明：`mod x;`（分号才是文件模块；`mod x {` 是内联模块，不算）。 */
export function rustModNames(source) {
  return [...source.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm)].map((m) => m[1]);
}

/** 从 Cargo.toml 解析 lib crate 名（缺 [lib] name 时回退：包名转下划线 + _lib）。 */
export function parseLibName(cargoToml) {
  const lib = /\[lib\][^[]*?name\s*=\s*"([^"]+)"/s.exec(cargoToml)?.[1];
  if (lib) return lib;
  const pkg = /\[package\][^[]*?name\s*=\s*"([^"]+)"/s.exec(cargoToml)?.[1] ?? "";
  return `${pkg.replaceAll("-", "_")}_lib`;
}

/** 一份源文件的内部依赖边（repo 相对路径，排序）。 */
export function deriveDeps(file, source, known, libName) {
  const deps = new Set();
  if (file.endsWith(".ts")) {
    for (const spec of tsImportSpecs(source)) {
      const target = resolveTsSpec(file, spec, known);
      if (target && target !== file) deps.add(target);
    }
  } else if (file.endsWith(".rs")) {
    for (const mod of rustModNames(source)) {
      const dir = path.posix.dirname(file);
      for (const candidate of [`${dir}/${mod}.rs`, `${dir}/${mod}/mod.rs`])
        if (known.has(candidate)) deps.add(candidate);
    }
    const libRoot = `${SCAN_ROOTS[1].dir}/lib.rs`;
    if (file !== libRoot && new RegExp(`\\b${libName}::`).test(source)) deps.add(libRoot);
  }
  return [...deps].sort();
}

/** 渲染组成树（生成区标记之间的正文，含 ```text 围栏）。 */
export function renderTree(files, manifest, depsByFile) {
  const dirOf = (file) => SCAN_ROOTS.find((root) => file.startsWith(`${root.dir}/`)).dir;
  const relNames = files.map((file) => file.slice(dirOf(file).length + 1));
  // 描述列起点：文件名（含 2 空格缩进）与根目录行的最大宽度 + 2 空格空隙。
  const colWidth =
    Math.max(
      ...relNames.map((name) => name.length + 2),
      ...SCAN_ROOTS.map(({ display }) => `${display}/`.length),
    ) + 2;
  const lines = ["```text"];
  for (const { display, dir } of SCAN_ROOTS) {
    lines.push(`${display}/`.padEnd(colWidth) + manifest[display]);
    for (const file of files.filter((f) => f.startsWith(`${dir}/`))) {
      const deps = depsByFile[file] ?? [];
      const suffix = deps.length ? `（→ ${deps.map((d) => path.posix.basename(d)).join("、")}）` : "";
      lines.push(`  ${file.slice(dir.length + 1)}`.padEnd(colWidth) + manifest[file] + suffix);
    }
  }
  lines.push("```");
  return lines.join("\n");
}

/** 把生成区替换进文档（保留区块外人工内容），返回新全文。 */
export function spliceRegion(text, region) {
  const lines = text.split("\n");
  const begin = lines.findIndex((line) => line.trim() === BEGIN);
  const end = lines.findIndex((line) => line.trim() === END);
  if (begin === -1 || end === -1 || end < begin)
    throw new Error(`gen-code-map: 文档缺 ${SLUG} 生成区标记对`);
  return [...lines.slice(0, begin), ...region.split("\n"), ...lines.slice(end + 1)].join("\n");
}

async function main() {
  const check = process.argv.includes("--check");
  const manifest = JSON.parse(await readFile(path.join(ROOT, MANIFEST), "utf8"));
  const files = await collectSourceFiles();
  const errors = reconcileManifest(files, manifest);
  if (errors.length) {
    console.error(`gen-code-map: ${errors.join("\ngen-code-map: ")}`);
    process.exit(1);
  }

  const known = new Set(files);
  const cargoToml = existsSync(path.join(ROOT, "src-tauri/Cargo.toml"))
    ? await readFile(path.join(ROOT, "src-tauri/Cargo.toml"), "utf8")
    : "";
  const libName = parseLibName(cargoToml);
  const depsByFile = {};
  for (const file of files)
    depsByFile[file] = deriveDeps(file, await readFile(path.join(ROOT, file), "utf8"), known, libName);
  const region = [BEGIN, renderTree(files, manifest, depsByFile), END].join("\n");

  for (const target of TARGETS) {
    const file = path.join(ROOT, target);
    const current = await readFile(file, "utf8");
    const next = spliceRegion(current, region);
    if (next !== current) {
      if (check) {
        const diffAt = next.split("\n").findIndex((line, i) => line !== current.split("\n")[i]) + 1;
        console.error(`gen-code-map: ${target} 过期（第一处差异在第 ${diffAt} 行）；跑 pnpm gen:code-map`);
        process.exit(1);
      }
      await writeFile(file, next);
      console.log(`gen-code-map: 写入 ${target}（${files.length} 个源文件）`);
    } else if (check) {
      console.log(`gen-code-map: ${target} 新鲜`);
    }
  }
  if (!check) console.log(`gen-code-map: done（${files.length} 个源文件）`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
