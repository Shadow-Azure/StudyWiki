#!/usr/bin/env node
// 门禁总调度：检查是叶子，模式是叶子组合。CI 的静态 lane 内嵌 doc-sync，
// 因此不存在"CI 忘配文档门禁"的路径。用法：
//   node scripts/run-gates.mjs --mode doc-quick|doc-sync|release [--tag vX.Y.Z]

import verifyAgentNotes from "./verify-agent-notes.mjs";
import verifyDocIndex from "./verify-doc-index.mjs";
import verifyPostmortem from "./verify-postmortem.mjs";
import verifyDocBudgets from "./verify-doc-budgets.mjs";
import verifyMdWrap from "./verify-md-wrap.mjs";
import verifyMdLinks from "./verify-md-links.mjs";
import verifyEnvIndependence from "./verify-env-independence.mjs";
import verifyTranslationPairing from "./verify-translation-pairing.mjs";
import verifyTerminology from "./verify-terminology.mjs";
import verifyTypeEquiv from "./verify-type-equiv.mjs";
import verifyExportDocs from "./verify-export-docs.mjs";
import verifyDocRefs from "./verify-doc-refs.mjs";
import verifyArchivedAgentNotes from "./verify-archived-agent-notes.mjs";
import docTypecheck from "./doc-typecheck.mjs";

const args = process.argv.slice(2);
const tag = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : undefined;

export const LEAVES = {
  "verify-agent-notes": verifyAgentNotes,
  "verify-archived-agent-notes": verifyArchivedAgentNotes,
  "verify-doc-index": verifyDocIndex,
  "verify-postmortem": verifyPostmortem,
  "verify-doc-budgets": verifyDocBudgets,
  "verify-md-wrap": verifyMdWrap,
  "verify-terminology": verifyTerminology,
  "verify-md-links": verifyMdLinks,
  "verify-env-independence": verifyEnvIndependence,
  "dep-audit": async () => {
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync(process.execPath, ["scripts/verify-dep-audit.mjs"], { stdio: "inherit" });
      return { ok: true, errors: [] };
    } catch {
      return { ok: false, errors: ["scripts/verify-dep-audit.mjs 退出非零（依赖面审计失败，明细见上方输出）"] };
    }
  },
  "layering": async () => {
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync(process.execPath, ["scripts/verify-layering.mjs"], { stdio: "inherit" });
      return { ok: true, errors: [] };
    } catch {
      return { ok: false, errors: ["scripts/verify-layering.mjs 退出非零（分层/装载缝扫描失败，明细见上方输出）"] };
    }
  },
  "native-links": async () => {
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync(process.execPath, ["scripts/verify-native-links.mjs"], { stdio: "inherit" });
      return { ok: true, errors: [] };
    } catch {
      return { ok: false, errors: ["scripts/verify-native-links.mjs 退出非零（产物动态链接扫描失败，明细见上方输出）"] };
    }
  },
  "verify-translation-pairing": () => verifyTranslationPairing([]),
  "verify-type-equiv": verifyTypeEquiv,
  "verify-export-docs": verifyExportDocs,
  "verify-doc-refs": verifyDocRefs,
  "doc-typecheck": docTypecheck,
  "verify-commands-catalog": async () => {
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync(process.execPath, ["scripts/gen-commands-catalog.mjs", "--check"], {
        stdio: "inherit",
      });
      return { ok: true, errors: [] };
    } catch {
      return { ok: false, errors: ["scripts/gen-commands-catalog.mjs --check 退出非零（跑 pnpm gen:commands 重生成）"] };
    }
  },
  "verify-code-map": async () => {
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync(process.execPath, ["scripts/gen-code-map.mjs", "--check"], { stdio: "inherit" });
      return { ok: true, errors: [] };
    } catch {
      return {
        ok: false,
        errors: ["scripts/gen-code-map.mjs --check 退出非零（跑 pnpm gen:code-map；新文件先在 code-map.manifest.json 登记职责）"],
      };
    }
  },
  // 文档标准自测试也进来：本地 verify:docs 与 CI 静态 lane 跑同一套（vitest 启动
  // 秒级成本，刻意不进 doc-quick——快速档的"秒级"承诺优先）。
  "gate-self-tests": async () => {
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run"], { stdio: "inherit" });
      return { ok: true, errors: [] };
    } catch {
      return { ok: false, errors: ["vitest run 退出非零（门禁自测试失败，具体用例见上方输出）"] };
    }
  },
  "verify-release": async () => {
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync(process.execPath, ["scripts/verify-release.mjs", ...(tag ? ["--tag", tag] : [])], {
        stdio: "inherit",
      });
      return { ok: true, errors: [] };
    } catch {
      return { ok: false, errors: ["scripts/verify-release.mjs 退出非零"] };
    }
  },
};

export const MODES = {
  // 快速档：无构建、秒级，提交前随手跑。配对/类型等价两叶读盘即可判。
  "doc-quick": [
    "verify-agent-notes",
    "verify-archived-agent-notes",
    "verify-doc-index",
    "verify-postmortem",
    "verify-doc-budgets",
    "verify-md-wrap",
    "verify-terminology",
    "verify-translation-pairing",
    "verify-type-equiv",
    "verify-export-docs",
    "verify-doc-refs",
    "verify-code-map",
  ],
  // 全量文档档：死链 + 环境无关源检查 + ts 围栏真实编译 + 生成区新鲜度 + 自测试。
  "doc-sync": [
    "verify-agent-notes",
    "verify-archived-agent-notes",
    "verify-doc-index",
    "verify-postmortem",
    "verify-doc-budgets",
    "verify-md-wrap",
    "verify-terminology",
    "verify-translation-pairing",
    "verify-type-equiv",
    "verify-export-docs",
    "verify-doc-refs",
    "verify-code-map",
    "doc-typecheck",
    "verify-commands-catalog",
    "verify-md-links",
    "verify-env-independence",
    "dep-audit",
    "layering",
    "gate-self-tests",
  ],
  // 发布档：doc-sync + 产物链接扫描（需先 pnpm tauri build 产出 bundle）+ 版本一致性
  // （在 build 之后跑会连同 dist 一起扫描）。
  release: [
    "verify-agent-notes",
    "verify-archived-agent-notes",
    "verify-doc-index",
    "verify-postmortem",
    "verify-doc-budgets",
    "verify-md-wrap",
    "verify-terminology",
    "verify-translation-pairing",
    "verify-type-equiv",
    "verify-export-docs",
    "verify-doc-refs",
    "verify-code-map",
    "doc-typecheck",
    "verify-commands-catalog",
    "verify-md-links",
    "verify-env-independence",
    "dep-audit",
    "layering",
    "gate-self-tests",
    "native-links",
    "verify-release",
  ],
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const modeIdx = args.indexOf("--mode");
  const mode = modeIdx >= 0 ? args[modeIdx + 1] : "doc-quick";
  if (!MODES[mode]) {
    console.error(`未知模式 "${mode}"，可选：${Object.keys(MODES).join(" | ")}`);
    process.exit(2);
  }

  const failures = [];
  for (const leaf of MODES[mode]) {
    const { ok, errors } = await LEAVES[leaf]();
    if (ok) {
      console.log(`✓ ${leaf}`);
    } else {
      failures.push(leaf);
      console.error(`✗ ${leaf}\n    ${errors.join("\n    ")}`);
    }
  }

  if (failures.length) {
    console.error(`\n${failures.length} 个门禁失败：${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(`\n${mode}: 全绿（${MODES[mode].length} 叶）`);
}
