// 门禁自测试：本地钩子安装器——pre-commit/pre-push 写入且可执行，且顺带
// 注册 i18n merge driver（.gitattributes 已引用 merge=studywiki-i18n，未注册
// 则退回文本合并、hash 行照常冲突——fail-closed 兜底，但便利机制应当装上）。
// 安装器是顶层即动作的脚本：在临时 git 仓库里 chdir 后动态 import 即触发。

import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const dirs = [];
let seq = 0;
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** 临时 git 仓库里触发一次安装器 import。 */
async function installOnce() {
  const dir = mkdtempSync(path.join(tmpdir(), "studywiki-hooks-"));
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  dirs.push(dir);
  const prev = process.cwd();
  process.chdir(dir);
  try {
    // @vite-ignore：绕开 vite 的动态导入分析，走原生 ESM。
    await import(/* @vite-ignore */ new URL(`./install-git-hooks.mjs?case=${seq++}`, import.meta.url).href);
  } finally {
    process.chdir(prev);
  }
  return dir;
}

describe("install-git-hooks", () => {
  it("写入 pre-commit / pre-push 且可执行", async () => {
    const dir = await installOnce();
    for (const hook of ["pre-commit", "pre-push"]) {
      const mode = statSync(path.join(dir, ".git/hooks", hook)).mode;
      expect(mode & 0o111).not.toBe(0);
    }
  });

  it("顺带注册 studywiki-i18n merge driver（.git/config）", async () => {
    const dir = await installOnce();
    const get = (key) =>
      execFileSync("git", ["config", "--get", key], { cwd: dir, encoding: "utf8" }).trim();
    expect(get("merge.studywiki-i18n.name")).toBe("StudyWiki 双语配对记录合并（fail-closed）");
    expect(get("merge.studywiki-i18n.driver")).toBe("node scripts/i18n-merge-driver.mjs %O %A %B");
  });
});
