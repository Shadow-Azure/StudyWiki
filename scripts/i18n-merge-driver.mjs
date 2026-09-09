#!/usr/bin/env node
// .i18n.yaml 的 fail-closed git merge driver（由 install-merge-driver.mjs 注册，
// .gitattributes 声明 `*.i18n.yaml merge=studywiki-i18n`）。
// 只合成无歧义的记录：两侧相同、或一侧未动（沿用另一侧的新确认）。
// 两个分支各自重录了同一对时留在冲突态——机器无法判断哪次"确认一致"更可信，
// 人工合并 md 两侧后跑 `pnpm record:i18n -- <pair>` 重录。用法（git 调用）：
//   node scripts/i18n-merge-driver.mjs %O %A %B

import { readFile, writeFile } from "node:fs/promises";

/**
 * 三方合成决策：两侧相同取任一侧；一侧未动取对侧；两侧各自重录则冲突。
 * @param {string} baseText 共同祖先版本。
 * @param {string} oursText 本侧版本。
 * @param {string} theirsText 对侧版本。
 * @returns {{conflict: boolean, result?: string}} conflict 为 true 时无合成结果，
 * 调用方应留在冲突态退出非零。
 */
export function decideMerge(baseText, oursText, theirsText) {
  if (oursText === theirsText) return { conflict: false, result: oursText }; // 同一确认，无歧义
  if (baseText === oursText) return { conflict: false, result: theirsText }; // 本侧未动，取对侧
  if (baseText === theirsText) return { conflict: false, result: oursText }; // 对侧未动，取本侧
  return { conflict: true };
}

const [, , base, ours, theirs] = process.argv;

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (!base || !ours || !theirs) {
      console.error("i18n-merge-driver: 期望 %O %A %B 三个临时文件路径");
      process.exit(2);
    }

    const read = async (file) => (await readFile(file)).toString("utf8");
    const { conflict, result } = decideMerge(
      await read(base),
      await read(ours),
      await read(theirs),
    );
    if (conflict) {
      console.error(
        "i18n-merge-driver: 两侧各自重录了配对记录，无法机械合成。\n" +
          "  合并两侧 markdown 后执行：pnpm record:i18n -- <pair>",
      );
      process.exit(1);
    }

    await writeFile(ours, result);
    process.exit(0);
  } catch (error) {
    console.error(`i18n-merge-driver: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
