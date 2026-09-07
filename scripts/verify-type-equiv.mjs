#!/usr/bin/env node
// Gate: type-equiv 围栏与源码逐字等价（蓝本 verify-type-equiv 裁剪移植）。
// ```ts type-equiv 围栏声明"与源码一致"：脚本用 TS 编译器 API 从源文件解析真实声明，
// 结构归一化对比（忽略空白与非 JSDoc 注释，保留声明结构与每一条 JSDoc）。
// 围栏与 manifest 条目 1:1：多贴未登记的块、登记了没有块、同块重复，都红。
// .en.md 侧围栏须与 base 侧字节相同（相同则按 base 的检查折算，不再重复检查）。

import { readdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve("");
const MANIFEST = "scripts/type-equiv.manifest.json";

async function collectMarkdown(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectMarkdown(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** 提取一个文件的围栏（info 串 + 内容 + 1 起始行号）。 */
function extractFences(text) {
  const lines = text.split("\n");
  const fences = [];
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!fence && open) {
      fence = { char: open[1][0], length: open[1].length, info: open[2].trim(), code: [], line: i + 1 };
      continue;
    }
    if (fence) {
      const close = new RegExp(`^\\s{0,3}\\${fence.char}{${fence.length},}\\s*$`).exec(lines[i]);
      if (close) {
        fences.push({ info: fence.info, code: fence.code.join("\n"), line: fence.line });
        fence = null;
      } else fence.code.push(lines[i]);
    }
  }
  if (fence) throw new Error("文档末尾有未闭合围栏");
  return fences;
}

/** 结构归一：去所有注释 → 剥开头的 export → 折叠空白——只比声明结构。 */
function normalizeStructure(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .trim()
    .replace(/^export\s+(default\s+)?/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 源序 JSDoc 清单（空白归一）。 */
function normalizeJSDoc(code) {
  return [...code.matchAll(/\/\*\*[\s\S]*?\*\//g)].map((m) => m[0].replace(/\s+/g, " ").trim());
}

/** 从围栏正文解析声明的符号名。 */
function blockSymbol(code) {
  const sf = ts.createSourceFile("type-equiv.ts", code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  for (const stmt of sf.statements) {
    const named =
      ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt);
    if (named && stmt.name) return stmt.name.text;
  }
  return null;
}

/** 源文件中 symbol 的声明文本（export 剥离、JSDoc 前置），找不到返回 null。 */
function sourceDeclaration(sourceRel, symbol) {
  const abs = path.join(ROOT, sourceRel);
  if (!existsSync(abs)) return null;
  const text = readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true);
  for (const stmt of sf.statements) {
    const named =
      ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt);
    if (named && stmt.name?.text === symbol) {
      const declarationStart = stmt.getStart(sf);
      const jsDoc = ts
        .getJSDocCommentsAndTags(stmt)
        .filter(ts.isJSDoc)
        .map((doc) => text.slice(doc.pos, doc.end))
        .join("\n");
      const declaration = text.slice(declarationStart, stmt.getEnd()).replace(/^export\s+(default\s+)?/, "");
      return jsDoc === "" ? declaration : `${jsDoc}\n${declaration}`;
    }
  }
  return null;
}

export default async function verifyTypeEquiv() {
  const errors = [];
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const entries = manifest.entries;

  // 语料内全部 markdown（base + .en.md）；.en.md 的围栏序列若与 base 字节一致则折算。
  const files = [
    ...(await collectMarkdown(path.join(ROOT, "docs"))),
    ...(await collectMarkdown(path.join(ROOT, ".agents", "notes"))),
    path.join(ROOT, "README.md"),
  ];
  const relOf = (file) => path.relative(ROOT, file).split(path.sep).join("/");

  const blocksByDoc = new Map();
  for (const file of files) {
    const rel = relOf(file);
    const equiv = extractFences(await readFile(file, "utf8")).filter((f) => f.info === "ts type-equiv");
    if (equiv.length) blocksByDoc.set(rel, equiv);
  }
  // derivative：.en.md 围栏序列与 base 逐字节一致 → 不进 1:1 检查。
  const primaries = new Map(blocksByDoc);
  let derivatives = 0;
  for (const [rel, blocks] of [...blocksByDoc]) {
    if (!rel.endsWith(".en.md")) continue;
    const baseRel = rel.replace(/\.en\.md$/, ".md");
    const baseBlocks = blocksByDoc.get(baseRel);
    const identical =
      baseBlocks &&
      baseBlocks.length === blocks.length &&
      blocks.every((block, i) => block.info === baseBlocks[i].info && block.code === baseBlocks[i].code);
    if (identical) {
      primaries.delete(rel);
      derivatives += blocks.length;
    }
  }

  // 重复块守卫。
  const blockByKey = new Map();
  for (const [rel, blocks] of primaries) {
    for (const block of blocks) {
      const symbol = blockSymbol(block.code);
      if (!symbol) {
        errors.push(`${rel}:${block.line}: type-equiv 围栏内无可解析的 interface/type/class 声明`);
        continue;
      }
      const key = `${rel}::${symbol}`;
      const prior = blockByKey.get(key);
      if (prior) errors.push(`${rel}: 符号 ${symbol} 的 type-equiv 围栏重复（第 ${prior} 与 ${block.line} 行）`);
      else blockByKey.set(key, { ...block, symbol, rel });
    }
  }

  // manifest 条目守卫（重复、指向不存在/不在扫描面的文档）。
  const entryByKey = new Map();
  for (const entry of entries) {
    const key = `${entry.doc}::${entry.symbol}`;
    if (entryByKey.has(key)) {
      errors.push(`manifest: ${entry.symbol}（${entry.doc}）条目重复`);
      continue;
    }
    if (!existsSync(path.join(ROOT, entry.doc)))
      errors.push(`manifest: ${entry.doc} 不存在`);
    entryByKey.set(key, entry);
  }

  // 1:1：孤儿块与孤儿条目。
  for (const [key, block] of blockByKey) {
    if (!entryByKey.has(key))
      errors.push(`${block.rel}:${block.line}: ${block.symbol} 的 type-equiv 围栏没有 manifest 条目（scripts/type-equiv.manifest.json）`);
  }
  for (const [key, entry] of entryByKey) {
    if (!blockByKey.has(key))
      errors.push(`manifest: ${entry.symbol}（${entry.doc}）没有对应围栏——删除条目或补围栏`);
  }

  // 逐条比对源码。
  let verified = 0;
  for (const [key, entry] of entryByKey) {
    const block = blockByKey.get(key);
    if (!block) continue; // 已作为孤儿条目报告
    const decl = sourceDeclaration(entry.source, entry.symbol);
    if (decl === null) {
      errors.push(`manifest: 符号 ${entry.symbol} 不在 ${entry.source} 中（条目 ${entry.doc}）`);
      continue;
    }
    const docCode = block.code;
    if (
      normalizeStructure(decl) !== normalizeStructure(docCode) ||
      JSON.stringify(normalizeJSDoc(decl)) !== JSON.stringify(normalizeJSDoc(docCode))
    ) {
      errors.push(
        `DRIFT: ${block.rel}:${block.line} — ${entry.symbol} 的围栏与 ${entry.source} 不一致。\n` +
          `    源码结构: ${normalizeStructure(decl)}\n` +
          `    文档结构: ${normalizeStructure(docCode)}`,
      );
      continue;
    }
    verified += 1;
  }

  if (errors.length)
    return { ok: false, errors: [`verify-type-equiv 检查了 ${blockByKey.size} 个围栏`, ...errors] };
  return {
    ok: true,
    errors: [],
    summary: `verify-type-equiv: ${verified} 个围栏与源码结构+JSDoc 一致（manifest 1:1）；${derivatives} 个英文侧字节折算`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await verifyTypeEquiv();
  if (!result.ok) {
    console.error(`verify-type-equiv: FAIL\n  ${result.errors.join("\n  ")}`);
    process.exit(1);
  }
  console.log(result.summary ?? "verify-type-equiv: ok");
}
