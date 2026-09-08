#!/usr/bin/env node
// Gate: 文档里普通 ```ts 围栏真实编译（蓝本 doc-typecheck 裁剪移植）。
// 围栏抽成仓库根下的虚拟文件（.doc-typecheck 只在内存里，import 路径以仓库根为
// 基准，如 "./src/types"），用 tsconfig.json 的 compilerOptions 建 Program；
// `ts ignore-check` 是显式豁免（计入豁免率，超半即红）。type-equiv 与生成区围栏
// 不在此列——它们各有自己的门禁。诊断行号映射回 markdown 源行。

import { readdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve("");

async function collectMarkdown(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectMarkdown(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** 围栏种类：check 编译；ignore 豁免；其余归各自门禁。 */
function kindOfInfo(info) {
  if (info === "ts") return "check";
  if (info === "ts ignore-check") return "ignore";
  if (info.startsWith("ts ")) return "other"; // type-equiv 等专属围栏
  return null; // rust/sh/markdown/text… 与本门禁无关
}

/** 抽取一个文件的 check/ignore 围栏。 */
function extractBlocks(text, file) {
  const lines = text.split("\n");
  const blocks = [];
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!fence && open) {
      fence = { char: open[1][0], length: open[1].length, info: open[2].trim(), code: [], line: i + 1 };
      continue;
    }
    if (fence) {
      const close = new RegExp(`^\\s{0,3}\\${fence.char}{${fence.length},}\\s*$`).test(lines[i]);
      if (close) {
        const kind = kindOfInfo(fence.info);
        if (kind) blocks.push({ file, line: fence.line, kind, code: fence.code.join("\n") });
        fence = null;
      } else fence.code.push(lines[i]);
    }
  }
  return blocks;
}

/** 仓库 tsconfig 的编译选项（文档示例与产品同一套严格度，另关未用告警类）。 */
function compilerOptions() {
  const config = ts.readConfigFile(path.join(ROOT, "tsconfig.json"), (p) => readTsFile(p));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  return {
    ...parsed.options,
    noEmit: true,
    noUnusedLocals: false,
    noUnusedParameters: false,
  };
}

function readTsFile(file) {
  return readFileSync(file, "utf8");
}

export default async function docTypecheck() {
  // archived/ 冻结快照不编译（改它须解封）。
  const files = [
    ...(await collectMarkdown(path.join(ROOT, "docs"))),
    ...(await collectMarkdown(path.join(ROOT, ".agents", "notes"))),
    path.join(ROOT, "README.md"),
  ].filter((f) => !f.startsWith(path.join(ROOT, ".agents", "notes", "archived") + path.sep));
  const relOf = (file) => path.relative(ROOT, file).split(path.sep).join("/");

  let blocks = [];
  for (const file of files) blocks.push(...extractBlocks(await readFile(file, "utf8"), relOf(file)));
  // .en.md 侧围栏与 base 逐字相同（配对门禁保证），只编译 base 侧一份。
  const baseBlocks = blocks.filter((b) => !b.file.endsWith(".en.md"));
  const checked = baseBlocks.filter((b) => b.kind === "check");
  const ignored = baseBlocks.filter((b) => b.kind === "ignore");
  const enMirrors = blocks.length - baseBlocks.length;

  if (checked.length === 0) {
    return { ok: true, errors: [], summary: `doc-typecheck: 无 ts 围栏待编译（${ignored.length} 豁免）` };
  }

  // 虚拟文件放在仓库根（名字带 doc-block 前缀，不落盘）。
  const sources = new Map();
  for (const [index, block] of checked.entries()) {
    sources.set(
      path.join(ROOT, `doc-block-${index}.ts`),
      block.code.endsWith("\n") ? block.code : `${block.code}\n`,
    );
  }

  const options = compilerOptions();
  const baseHost = ts.createCompilerHost(options, true);
  const host = {
    ...baseHost,
    fileExists: (name) => sources.has(path.resolve(name)) || baseHost.fileExists(name),
    readFile: (name) => sources.get(path.resolve(name)) ?? baseHost.readFile(name),
    getSourceFile: (name, version, onError, shouldCreate) => {
      const source = sources.get(path.resolve(name));
      if (source !== undefined) return ts.createSourceFile(name, source, version, true);
      return baseHost.getSourceFile(name, version, onError, shouldCreate);
    },
    writeFile: () => {
      throw new Error("doc-typecheck: noEmit 编译试图写盘");
    },
  };
  const program = ts.createProgram([...sources.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);

  if (diagnostics.length > 0) {
    const errors = diagnostics.map((diagnostic) => {
      const file = diagnostic.file?.fileName ?? "";
      const match = /doc-block-(\d+)\.ts$/.exec(file);
      const where = match ? `${checked[Number(match[1])].file}（第 ${checked[Number(match[1])].line} 行围栏）` : file;
      const pos = diagnostic.file && diagnostic.start !== undefined
        ? `:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`
        : "";
      return `${where}${pos}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
    });
    return { ok: false, errors };
  }

  const ratioDenominator = checked.length + ignored.length;
  const ratio = ignored.length / ratioDenominator;
  if (ratioDenominator >= 4 && ratio > 0.5)
    return { ok: false, errors: [`doc-typecheck: 豁免围栏过多（${ignored.length}/${ratioDenominator}），编译它们或删掉`] };

  return {
    ok: true,
    errors: [],
    summary: `doc-typecheck: ${checked.length} 个 ts 围栏编译通过（${ignored.length} 豁免，${enMirrors} 个英文侧折算）`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await docTypecheck();
  if (!result.ok) {
    console.error(`doc-typecheck: FAIL\n  ${result.errors.join("\n  ")}`);
    process.exit(1);
  }
  console.log(result.summary ?? "doc-typecheck: ok");
}
