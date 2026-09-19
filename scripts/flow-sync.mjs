#!/usr/bin/env node
// 开发工具：把 .agents/flow/ 流程树写到 GitHub 的唯一入口。对 github.number
// 为 null 的 milestone / issue 建远端对象（milestone 先行，issue 按 title
// 归属），回填两侧围栏的 number/url（配对门禁要求围栏两侧逐字节一致，两侧
// 同样替换）并重录配对记录。只建不改不删。需要 gh 已登录；CI 在线 lane
// （verify-flow-online）只校验，写操作全部走这里。

import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { blobHash, pairPaths, renderPairRecord } from "./translation-pairing-lib.mjs";
import { loadFlowTree } from "./flow-lib.mjs";

/**
 * 同步计划：哪些 milestone / issue 需要建远端对象。
 * @returns {{milestones: Array, issues: Array}}
 */
export function planSync(tree) {
  return {
    milestones: tree.milestones.filter((m) => m.data.github?.number === null),
    issues: tree.issues.filter((i) => i.data.github?.number === null),
  };
}

/** 把围栏内 github 段的 number/url 从 null 回填为实值（字符串变换，两侧共用）。 */
export function applyGithubRef(content, number, url) {
  const next = content
    .replace("  number: null", `  number: ${number}`)
    .replace("  url: null", `  url: ${url}`);
  if (next === content)
    throw new Error("回填失败：未找到 github 段的 null 占位（编号已回填过？）");
  return next;
}

/** 回填一个文件的两侧围栏并重录配对记录。 */
async function backfill(file, number, url) {
  const paths = pairPaths(file);
  for (const side of [paths.base, paths.en]) {
    const content = await readFile(side, "utf8");
    await writeFile(side, applyGithubRef(content, number, url));
  }
  const baseContent = await readFile(paths.base, "utf8");
  const enContent = await readFile(paths.en, "utf8");
  await writeFile(
    paths.meta,
    renderPairRecord(paths, { baseHash: blobHash(baseContent), enHash: blobHash(enContent) }),
  );
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

/** issue 的中文标题 = base 侧 H1。 */
function titleOf(content) {
  const m = /^# (.+)$/m.exec(content);
  if (!m) throw new Error("缺 H1 标题");
  return m[1].trim();
}

async function main() {
  const repoUrl = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  const repo = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(repoUrl)?.[1];
  if (!repo) throw new Error(`无法从 origin 推导 GitHub 仓库：${repoUrl}`);
  const { tree, errors } = await loadFlowTree();
  if (errors.length > 0) {
    console.error(`flow:sync: 流程树有错误，先修到 verify:flow 绿\n  ${errors.join("\n  ")}`);
    process.exit(1);
  }
  const plan = planSync(tree);
  if (plan.milestones.length === 0 && plan.issues.length === 0) {
    console.log("flow:sync: 没有待同步项");
    return;
  }
  for (const m of plan.milestones) {
    const out = gh(["api", `repos/${repo}/milestones`, "-f", `title=${m.data.title}`, "-f", "state=open"]);
    const { number } = JSON.parse(out);
    const url = `https://github.com/${repo}/milestone/${number}`;
    await backfill(m.file, number, url);
    console.log(`flow:sync: milestone ${m.data.id} → #${number}`);
  }
  for (const issue of plan.issues) {
    const milestone = tree.milestones.find((m) => m.data.id === issue.data.milestone);
    if (milestone?.data.github?.number === null)
      throw new Error(`${issue.file}: 所属 milestone ${issue.data.milestone} 尚未同步——重跑本命令`);
    const title = titleOf(await readFile(issue.file, "utf8"));
    const body = `流程树条目：${issue.file}（详见仓库 .agents/flow/）`;
    const url = gh([
      "issue", "create", "--repo", repo, "--title", title,
      "--milestone", milestone?.data.title ?? "", "--body", body,
    ]);
    const number = Number.parseInt(url.match(/\/issues\/(\d+)/)?.[1] ?? "", 10);
    if (!Number.isInteger(number)) throw new Error(`无法从 gh 输出解析 issue 编号：${url}`);
    await backfill(issue.file, number, url);
    console.log(`flow:sync: issue ${issue.name} → #${number}`);
  }
  console.log("flow:sync: 完成");
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
