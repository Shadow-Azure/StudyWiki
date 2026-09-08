#!/usr/bin/env node
// 门禁总调度：检查是叶子，模式是叶子组合。CI 的静态 lane 内嵌 doc-sync，
// 因此不存在"CI 忘配文档门禁"的路径。用法：
//   node scripts/run-gates.mjs --mode doc-quick|doc-sync|release [--tag vX.Y.Z]

import verifyAgentNotes from "./verify-agent-notes.mjs";
import verifyDocIndex from "./verify-doc-index.mjs";
import verifyPostmortem from "./verify-postmortem.mjs";
import verifyDocBudgets from "./verify-doc-budgets.mjs";
import verifyMdLinks from "./verify-md-links.mjs";
import verifyEnvIndependence from "./verify-env-independence.mjs";
import verifyTranslationPairing from "./verify-translation-pairing.mjs";
import verifyTypeEquiv from "./verify-type-equiv.mjs";
import verifyExportDocs from "./verify-export-docs.mjs";
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
  "verify-md-links": verifyMdLinks,
  "verify-env-independence": verifyEnvIndependence,
  "verify-translation-pairing": () => verifyTranslationPairing([]),
  "verify-type-equiv": verifyTypeEquiv,
  "verify-export-docs": verifyExportDocs,
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
    "verify-translation-pairing",
    "verify-type-equiv",
    "verify-export-docs",
  ],
  // 全量文档档：死链 + 环境无关源检查 + ts 围栏真实编译 + 生成区新鲜度。
  "doc-sync": [
    "verify-agent-notes",
    "verify-archived-agent-notes",
    "verify-doc-index",
    "verify-postmortem",
    "verify-doc-budgets",
    "verify-translation-pairing",
    "verify-type-equiv",
    "verify-export-docs",
    "doc-typecheck",
    "verify-commands-catalog",
    "verify-md-links",
    "verify-env-independence",
  ],
  // 发布档：doc-sync + 版本一致性（在 build 之后跑会连同 dist 一起扫描）。
  release: [
    "verify-agent-notes",
    "verify-archived-agent-notes",
    "verify-doc-index",
    "verify-postmortem",
    "verify-doc-budgets",
    "verify-translation-pairing",
    "verify-type-equiv",
    "verify-export-docs",
    "doc-typecheck",
    "verify-commands-catalog",
    "verify-md-links",
    "verify-env-independence",
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
