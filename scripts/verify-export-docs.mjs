#!/usr/bin/env node
// Gate: 注释即契约——导出面必须带文档注释（蓝本 verify-export-jsdoc 的裁剪移植）。
// TS 侧（src/**/*.ts）：顶层导出的声明须有 JSDoc；导出函数每个形参须有 @param，
// 非 void 返回须有 @returns（推断类型也须标注——契约不靠猜）。
// Rust 侧（src-tauri/src/lib.rs）：每个 #[tauri::command] 上方须紧邻 /// 注释——
// 命令目录生成器从这里搬运，缺 /// 的命令在 docs/commands.md 里是裸签名。
// 门禁只钉"有"，写什么（契约语义：何时触发/边界/失败处置）归评审。

import { readdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve("src");
const LIB_RS = path.resolve("src-tauri/src/lib.rs");

async function collectTs(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectTs(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** 语句的 JSDoc 块（VariableStatement 兜底取声明上的注释）。 */
function jsDocOf(stmt) {
  const docs = ts.getJSDocCommentsAndTags(stmt).filter(ts.isJSDoc);
  if (docs.length || !ts.isVariableStatement(stmt)) return docs;
  return stmt.declarationList.declarations.flatMap((d) =>
    ts.getJSDocCommentsAndTags(d).filter(ts.isJSDoc),
  );
}

function symbolName(stmt) {
  if (ts.isVariableStatement(stmt))
    return stmt.declarationList.declarations[0]?.name.getText();
  return stmt.name?.text;
}

/** 导出函数的 @param / @returns 契约。 */
function checkFunction(rel, fn, docs, errors) {
  const tags = docs.flatMap((doc) => doc.tags ?? []);
  for (const param of fn.parameters) {
    const name = param.name.getText();
    if (!tags.some((t) => ts.isJSDocParameterTag(t) && t.name.getText() === name))
      errors.push(`${rel}: 函数 ${fn.name?.text} 的形参 ${name} 缺 @param`);
  }
  const ret = fn.type?.getText() ?? "推断类型";
  const voidLike = ret === "void" || ret === "Promise<void>" || ret === "never";
  if (!voidLike && !tags.some(ts.isJSDocReturnTag))
    errors.push(`${rel}: 函数 ${fn.name?.text} 返回 ${ret}，缺 @returns`);
}

/** lib.rs：#[tauri::command] 上方须紧邻 ///（生成目录按此搬运）。 */
function verifyRustCommands(errors) {
  if (!existsSync(LIB_RS)) return;
  const lines = readFileSync(LIB_RS, "utf8").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*#\[tauri::command\]/.test(lines[i])) continue;
    if (!/^\s*\/\/\//.test(lines[i - 1] ?? ""))
      errors.push(`src-tauri/src/lib.rs:${i + 1}: #[tauri::command] 上方须紧邻 /// 文档注释`);
  }
}

export default async function verifyExportDocs() {
  const errors = [];

  if (existsSync(SRC)) {
    for (const file of await collectTs(SRC)) {
      const rel = path.relative("", file);
      const sf = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true);
      for (const stmt of sf.statements) {
        if ((ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) === 0) continue;
        const docs = jsDocOf(stmt);
        if (docs.length === 0) {
          errors.push(
            `${rel}: 导出 ${symbolName(stmt) ?? "声明"} 缺 JSDoc（写契约语义：何时触发/边界/失败处置）`,
          );
          continue;
        }
        if (ts.isFunctionDeclaration(stmt)) checkFunction(rel, stmt, docs, errors);
      }
    }
  }

  verifyRustCommands(errors);
  return { ok: errors.length === 0, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await verifyExportDocs();
  if (!result.ok) {
    console.error(`verify-export-docs: FAIL\n  ${result.errors.join("\n  ")}`);
    process.exit(1);
  }
  console.log("verify-export-docs: ok");
}
