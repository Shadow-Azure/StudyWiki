#!/usr/bin/env node
// pre-push 检视元数据保鲜门禁：只检查本 push 将带出的 changes 页。
// gh 探测失败或分支无 PR 时放行，避免本地推送被网络抖动阻塞；
// PR 存在时，元数据 id 落后且中间有非 changes 变更则硬红。

import { execFileSync } from "node:child_process";
import { parseWalkthroughYaml } from "./walkthrough-yaml.mjs";

/** 判断路径是否是 walkthrough changes YAML。 */
function isChangePage(file) {
  return typeof file === "string" && /^walkthrough\/changes\/[^/]+\.yaml$/u.test(file);
}

/** 规范 pre-push 的 stdin/argv 输入。 */
export function parsePrePushInput(argv = [], stdin = "") {
  const values = argv.length >= 4 ? argv : stdin.trim().split(/\s+/u).filter(Boolean);
  if (values.length < 4) {
    throw new Error("pre-push 输入必须包含 local_ref/local_sha/remote_ref/remote_sha");
  }
  const [local_ref, local_sha, remote_ref, remote_sha] = values;
  if (!local_ref || !local_sha || !remote_ref || !remote_sha) {
    throw new Error("pre-push 输入不能为空");
  }
  return { local_ref, local_sha, remote_ref, remote_sha };
}

/** 探测当前分支 PR；返回 false 表示明确无 PR，抛错表示 gh 不可用/失败。 */
async function hasPullRequest(branch, deps) {
  let output;
  try {
    output = await deps.gh(["pr", "view", branch, "--json", "number"]);
  } catch (error) {
    if (/no pull requests?/iu.test(error instanceof Error ? error.message : String(error))) return false;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    return false;
  }
  return parsed?.number !== null && parsed?.number !== undefined;
}

/** 读取 local_sha 中待检页内容；readText 是真实 git show 的注入缝。 */
async function readChangeText(root, file, sha, deps) {
  if (deps.readText) return await deps.readText(root, file, sha, deps.git);
  return await deps.git(root, ["show", `${sha}:${file}`]);
}

/** 解析 freshness id；解析失败与字段缺失一样进入缺少字段红。 */
async function readFreshnessId(root, file, sha, deps) {
  try {
    const page = parseWalkthroughYaml(await readChangeText(root, file, sha, deps), file);
    return isObject(page) ? page.skill_gen_commit_id : undefined;
  } catch {
    return undefined;
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 把短/长 hash 统一到完整 object id；不可解析值返回原小写字符串。 */
async function canonicalSha(value, root, deps) {
  try {
    return (await deps.git(root, ["rev-parse", "--verify", `${value}^{commit}`])).trim();
  } catch {
    return String(value ?? "").toLowerCase();
  }
}

/** 判断 id..local_sha 的每个提交都只触碰 changes YAML。 */
async function onlyChangeCommits(root, id, sha, deps) {
  let output;
  try {
    output = await deps.git(root, [
      "log",
      "--name-only",
      "--format=%x00%H",
      `${id}..${sha}`,
    ]);
  } catch {
    return false;
  }
  return output
    .split("\u0000")
    .slice(1)
    .filter((block) => block.trim() !== "")
    .every((block) => {
      const lines = block.split("\n").filter((line) => line.trim() !== "");
      return lines.length >= 1 && lines.slice(1).every(isChangePage);
    });
}

/**
 * 纯装配规则：判定一个 pre-push 输入的检视元数据保鲜结果。
 * @param {{root?: string, local_ref:string, local_sha:string, remote_ref:string, remote_sha:string}} input - git pre-push 参数。
 * @param {{gh:Function, git:Function, readText?:Function}} deps - gh/git/YAML 读取注入缝。
 * @returns {Promise<{status:"pass"|"fail", messages:string[], stderrMessages:string[], errors:string[]}>} 结果。
 */
export async function assessFreshness(input, deps) {
  const root = input.root ?? process.cwd();
  const branch = input.local_ref.replace(/^refs\/heads\//u, "");
  const messages = [];
  const stderrMessages = [];
  try {
    const hasPr = await hasPullRequest(branch, deps);
    if (!hasPr) {
      messages.push("无关联 PR，跳过保鲜检查");
      return { status: "pass", messages, stderrMessages, errors: [] };
    }
  } catch (error) {
    stderrMessages.push(`gh 探测失败，跳过保鲜检查: ${error instanceof Error ? error.message : String(error)}`);
    return { status: "pass", messages, stderrMessages, errors: [] };
  }

  const base = (await deps.git(root, ["merge-base", "origin/main", input.local_sha])).trim();
  const changed = (await deps.git(root, [
    "diff",
    "--name-only",
    base,
    input.local_sha,
  ])).split("\n").map((line) => line.trim()).filter(isChangePage).sort();
  const errors = [];
  for (const file of changed) {
    const id = await readFreshnessId(root, file, input.local_sha, deps);
    if (id === undefined || id === null || String(id).trim() === "") {
      errors.push("变更页缺少 skill_gen_commit_id（调用 walkthrough-change-metadata-gen skill 生成/更新）");
      continue;
    }
    const [actualId, localId] = await Promise.all([
      canonicalSha(String(id).trim(), root, deps),
      canonicalSha(input.local_sha, root, deps),
    ]);
    if (actualId === localId) continue;
    if (await onlyChangeCommits(root, String(id).trim(), input.local_sha, deps)) continue;
    errors.push("变更页元数据落后于最新提交（调用 walkthrough-change-metadata-gen skill 增量更新）");
  }
  return { status: errors.length === 0 ? "pass" : "fail", messages, stderrMessages, errors };
}

/** 读取 pre-push stdin（有 argv 时不用等待管道）。 */
async function readStdin() {
  if (process.stdin.isTTY) return "";
  let output = "";
  for await (const chunk of process.stdin) output += chunk;
  return output;
}

async function main() {
  const input = parsePrePushInput(process.argv.slice(2), await readStdin());
  const deps = {
    gh: (argv) => execFileSync("gh", argv, { encoding: "utf8" }),
    git: (root, argv) => execFileSync("git", argv, { cwd: root, encoding: "utf8" }),
  };
  const result = await assessFreshness(input, deps);
  for (const message of result.messages) console.log(message);
  for (const message of result.stderrMessages) console.error(message);
  if (result.status === "fail") {
    console.error(`review-freshness: FAIL\n  ${result.errors.join("\n  ")}`);
    process.exit(1);
  }
  console.log("review-freshness: ok");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error) {
    console.error(`check-review-freshness: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
