// spec 公用夹具工具（仅测试用，不是门禁）：临时仓库根 + chdir 窗口内动态
// import 门禁并调用。门禁在 import 时锚定 cwd（path.resolve("")），部分报错
// 路径又在调用时取 cwd——窗口必须同时罩住 import 与调用。query 防模块缓存，
// @vite-ignore 走原生 ESM（按完整 URL 区分模块）。用后 cleanup 清场。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 为一个门禁模块造夹具运行器。
 * @param {string} gateModule scripts/ 下的门禁文件名（如 "verify-md-links.mjs"）。
 * @param {string} prefix 临时目录前缀（如 "md-links"）。
 * @returns {{run: (files: Record<string,string>) => Promise<{ok:boolean,errors:string[],summary?:string}>, cleanup: () => void}}
 */
export function createGateRunner(gateModule, prefix) {
  const dirs = [];
  let seq = 0;
  const run = async (files) => {
    const dir = mkdtempSync(path.join(tmpdir(), `studywiki-${prefix}-`));
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    dirs.push(dir);
    const prev = process.cwd();
    process.chdir(dir);
    try {
      // @vite-ignore：绕开 vite 的动态导入分析，走原生 ESM。
      const gate = await import(/* @vite-ignore */ new URL(`./${gateModule}?fixture=${seq++}`, import.meta.url).href);
      return await gate.default();
    } finally {
      process.chdir(prev);
    }
  };
  const cleanup = () => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  };
  return { run, cleanup };
}
