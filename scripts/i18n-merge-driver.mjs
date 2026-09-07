#!/usr/bin/env node
// .i18n.yaml 的 fail-closed git merge driver（由 install-merge-driver.mjs 注册，
// .gitattributes 声明 `*.i18n.yaml merge=studywiki-i18n`）。
// 只合成无歧义的记录：两侧相同、或一侧未动（沿用另一侧的新确认）。
// 两个分支各自重录了同一对时留在冲突态——机器无法判断哪次"确认一致"更可信，
// 人工合并 md 两侧后跑 `pnpm record:i18n -- <pair>` 重录。用法（git 调用）：
//   node scripts/i18n-merge-driver.mjs %O %A %B

import { readFile, writeFile } from "node:fs/promises";

const [, , base, ours, theirs] = process.argv;
if (!base || !ours || !theirs) {
  console.error("i18n-merge-driver: 期望 %O %A %B 三个临时文件路径");
  process.exit(2);
}

const read = async (file) => (await readFile(file)).toString("utf8");
const [baseText, oursText, theirsText] = await Promise.all([read(base), read(ours), read(theirs)]);

let result;
if (oursText === theirsText) result = oursText; // 同一确认，无歧义
else if (baseText === oursText) result = theirsText; // 本侧未动，取对侧
else if (baseText === theirsText) result = oursText; // 对侧未动，取本侧
else {
  console.error(
    "i18n-merge-driver: 两侧各自重录了配对记录，无法机械合成。\n" +
      "  合并两侧 markdown 后执行：pnpm record:i18n -- <pair>",
  );
  process.exit(1);
}

await writeFile(ours, result);
process.exit(0);
