#!/usr/bin/env node
// Gate: walkthrough 站点静态对账与 PR diff 增量对账。纯规则在 walkthrough-lib；
// 本文件只装配 root、code-map、flow issue 与注入的 diff 文件列表。用法：
//   node scripts/verify-walkthrough.mjs [--diff <base>]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkAnchors, checkChanges, checkDiff, checkFilePages, checkFeatures, checkLineCoverage, parseSite, validateSchema } from "./walkthrough-lib.mjs";
import { loadFlowTree } from "./flow-lib.mjs";

/** 判断 JSON 允许的扁平 map 根形状（非 null object 且非 Array）。 */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 读取 code-map 登记处；缺失、损坏或坏形状都报错并终止规则 3。 */
function readCodeMap(root, errors) {
  const file = "scripts/code-map.manifest.json";
  try {
    const value = JSON.parse(readFileSync(path.join(root, file), "utf8"));
    if (!isPlainObject(value)) {
      errors.push(`${file}: 必须是扁平对象映射`);
      return { codeMap: null, invalid: true };
    }
    return { codeMap: value, invalid: false };
  } catch (error) {
    errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    return { codeMap: null, invalid: true };
  }
}

/** 降级组统一输出 `WARN:` 前缀；bootstrap 关闭后原样进入 errors。 */
function appendDegraded(errors, warnings, bootstrap, ruleErrors) {
  for (const error of ruleErrors) {
    if (bootstrap) warnings.push(`WARN: ${error}`);
    else errors.push(error);
  }
}

/**
 * 执行 walkthrough 门禁并保留 bootstrap 警告，供 CLI 与测试观测。
 * @param {{root?: string, diffFiles?: string[], issues?: Array<{slug:string,status:string}>}} options
 *   root 默认 process.cwd；diffFiles 注入时执行规则 8/9；issues 注入用于纯装配测试。
 * @returns {Promise<{ok:boolean, errors:string[], warnings:string[]}>} 门禁结果。
 */
export async function collectWalkthrough(options = {}) {
  const root = options.root ?? process.cwd();
  const errors = [];
  const warnings = [];
  const site = parseSite(root);
  errors.push(...site.parseErrors);
  const registration = readCodeMap(root, errors);

  let issues = options.issues;
  if (issues === undefined) {
    const { tree, errors: flowErrors } = await loadFlowTree(path.join(root, ".agents/flow"));
    errors.push(...flowErrors);
    issues = tree.issues
      .filter((issue) => issue.data && typeof issue.data === "object")
      .map((issue) => ({ slug: issue.name, status: issue.data.status }));
  }

  const bootstrap = site.manifest?.bootstrap === true;
  errors.push(...validateSchema(site));
  errors.push(...checkAnchors(root, site));
  if (!registration.invalid) appendDegraded(errors, warnings, bootstrap, checkFilePages(site, registration.codeMap));
  errors.push(...checkFeatures(site));
  appendDegraded(errors, warnings, bootstrap, checkChanges(site, issues));
  appendDegraded(errors, warnings, bootstrap, checkLineCoverage(root, site));
  if (options.diffFiles !== undefined) errors.push(...checkDiff(options.diffFiles, site));

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * run-gates 叶子入口；bootstrap 警告不改变叶子结果，由 CLI stdout 呈现。
 * @param {{root?: string, diffFiles?: string[], issues?: Array<{slug:string,status:string}>}} options
 *   测试可注入 root/diffFiles/issues；生产调用保持无参。
 * @returns {Promise<{ok:boolean, errors:string[]}>} run-gates 叶子形状。
 */
export default async function verifyWalkthrough(options = {}) {
  const { ok, errors } = await collectWalkthrough(options);
  return { ok, errors };
}

/** 执行 `git diff --name-only base...HEAD`；exec 参数仅供测试注入。 */
export function readDiffFiles(base, exec = execFileSync) {
  return exec("git", ["diff", "--name-only", base + "...HEAD"])
    .toString()
    .split("\n")
    .filter(Boolean);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let diffIndex = -1;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--diff") {
      diffIndex = index;
      index += 1;
      continue;
    }
    console.error(`未知参数: ${args[index]}`);
    process.exit(2);
  }
  let diffFiles;
  if (diffIndex >= 0) {
    const base = args[diffIndex + 1];
    if (!base) {
      console.error("verify-walkthrough --diff 需要 <base> 参数（如 origin/main）");
      process.exit(2);
    }
    try {
      diffFiles = readDiffFiles(base);
    } catch (error) {
      console.error(`verify-walkthrough: 无法读取 git diff ${base}...HEAD`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  const result = await collectWalkthrough({ diffFiles });
  for (const warning of result.warnings) console.log(warning);
  if (!result.ok) {
    console.error(`verify-walkthrough: FAIL\n  ${result.errors.join("\n  ")}`);
    process.exit(1);
  }
  console.log("verify-walkthrough: ok");
}
