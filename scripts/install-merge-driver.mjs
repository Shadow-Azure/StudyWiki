#!/usr/bin/env node
// 把 i18n-merge-driver 注册进本仓库的 .git/config（每个 clone 跑一次）。
// 未注册时 git 退回默认文本合并——.i18n.yaml 的 hash 行会照常冲突，同样 fail-closed；
// 注册后仅无歧义的情形自动合成。CI 不需要本脚本（merge 只发生在本地）。
// pnpm install:hooks（install-git-hooks.mjs）会顺带调用；单独重装可直接运行本文件。

import { execFileSync } from "node:child_process";

const NAME = "studywiki-i18n";
const DRIVER = "node scripts/i18n-merge-driver.mjs %O %A %B";

/** 注册 fail-closed merge driver 进本仓库 .git/config（幂等：同值覆盖）。 */
export function registerMergeDriver() {
  execFileSync("git", ["config", `merge.${NAME}.name`, "StudyWiki 双语配对记录合并（fail-closed）"]);
  execFileSync("git", ["config", `merge.${NAME}.driver`, DRIVER]);
  console.log(`install-merge-driver: 已注册 merge=${NAME} → ${DRIVER}（.git/config，仅本 clone）`);
}

if (import.meta.url === `file://${process.argv[1]}`) registerMergeDriver();
