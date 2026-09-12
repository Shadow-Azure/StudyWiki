#!/usr/bin/env node
// 改动面路由器：看本次改动的路径，机械回答"该跑哪组门禁"（蓝本 change-scope
// 的单用途裁剪——dsh 是通用 SHA 区间报告器 + skill 路由，本库只要路径→命令）。
// 默认看工作树（git status --porcelain，含未跟踪）；--base <ref> 看 <ref>..工作树
// 的累计改动。输出命令 + 每组一行理由；这是建议不是门禁——穷尽覆盖归 CI。

import { execFileSync } from "node:child_process";

/**
 * 路由表：glob 前缀/精确名 → { commands, reason }。命中多组时命令并集，
 * 文档档就高（doc-quick 被命中的 verify:docs 覆盖则不再单独建议）。
 * 加新门禁命令时同步本表（spec 用例钉住代表路径）。
 */
export const ROUTES = [
  {
    match: (p) => p.startsWith("src-tauri/"),
    commands: ["verify:docs"],
    reason: "Rust 侧：命令目录（lib.rs ///）、code-map、doc-refs 读 src-tauri；另有 cargo fmt / clippy / test（shell 侧跑）",
  },
  {
    match: (p) => p.startsWith("src/"),
    commands: ["build", "verify:docs"],
    reason: "TS 源码：export-docs、type-equiv、doc-typecheck、code-map 读 src；build 连带 tsc 检查",
  },
  {
    match: (p) => p.startsWith("scripts/"),
    commands: ["test", "verify:docs"],
    reason: "门禁脚本：自测试必跑（gate-coverage/ci-wiring 对账接线与门禁本体）",
  },
  {
    match: (p) => p.startsWith("docs/") || p.startsWith(".agents/") || p.endsWith(".md") || p === "AGENTS.md",
    commands: ["verify:docs"],
    reason: "文档语料：配对、预算、type-equiv、生成区、索引全量档",
  },
  {
    match: (p) =>
      p === "package.json" || p === "pnpm-lock.yaml" || p.startsWith(".github/"),
    commands: ["test", "verify:docs"],
    reason: "接线与依赖：CI/命令清单/钩子安装的 spec 对账；lockfile 变更先 pnpm install --frozen-lockfile",
  },
  {
    match: (p) => p === "package.json" || p === "pnpm-lock.yaml",
    commands: ["verify:dep-audit"],
    reason: "依赖面变化必过白名单审计",
  },
  {
    match: (p) => ["src/plugins/", "src/host/", "src/loader/"].some((d) => p.startsWith(d)),
    commands: ["verify:layering"],
    reason: "分层纪律相关面",
  },
  {
    match: (p) =>
      p === "src-tauri/tauri.conf.json" ||
      p === "src-tauri/Cargo.toml" ||
      p === "src-tauri/Cargo.lock",
    commands: ["verify:native-links"],
    reason: "产物链接面变化（需先 build）",
  },
];

/** 无命中时的默认建议（轻档）。 */
export const FALLBACK = {
  commands: ["lint:docs"],
  reason: "未命中路由表：快速档兜底（穷尽覆盖归 CI）",
};

/** 分类改动路径 → 命中的路由组（保持 ROUTES 顺序）。 */
export function classify(paths) {
  return ROUTES.filter((route) => paths.some((p) => route.match(p)));
}

/** 建议命令的固定先后（构建 → 测试 → 专项审计 → 全量文档档）。 */
const COMMAND_ORDER = [
  "build",
  "test",
  "verify:dep-audit",
  "verify:layering",
  "verify:native-links",
  "verify:docs",
  "lint:docs",
];

/** 命中组的命令并集（按固定顺序去重），无命中回退 FALLBACK。 */
export function recommend(paths) {
  const hits = classify(paths);
  const source = hits.length ? hits : [FALLBACK];
  const commands = [...new Set(source.flatMap((hit) => hit.commands))].sort(
    (a, b) => COMMAND_ORDER.indexOf(a) - COMMAND_ORDER.indexOf(b),
  );
  return { commands, hits: source };
}

/** git status --porcelain 的路径（重命名取两侧，去状态前缀）。 */
export function worktreePaths(statusOutput) {
  return [
    ...new Set(
      statusOutput
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const rename = line.slice(3).match(/^(.*?) -> (.*)$/);
          return rename ? [rename[1], rename[2]] : line.slice(3);
        })
        .flat(),
    ),
  ];
}

function changedPaths() {
  const args = process.argv.slice(2);
  const baseIdx = args.indexOf("--base");
  if (baseIdx === -1)
    return worktreePaths(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }));
  const base = args[baseIdx + 1];
  if (!base) {
    console.error("route-gates: --base 需要一个 ref 参数（如 --base main）");
    process.exit(2);
  }
  const committed = execFileSync("git", ["diff", "--name-only", base], { encoding: "utf8" });
  const untracked = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
  return [...new Set([...committed.split("\n").filter(Boolean), ...worktreePaths(untracked)])];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const paths = changedPaths();
  if (!paths.length) {
    console.log("route-gates: 无改动。");
    process.exit(0);
  }

  const { commands, hits } = recommend(paths);
  console.log(`改动面（${paths.length} 条路径）命中：`);
  for (const hit of hits) console.log(`  - ${hit.reason}`);
  console.log("\n建议按序跑：");
  for (const command of commands) console.log(`  pnpm ${command}`);
}
