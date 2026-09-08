// 门禁自测试：接线自保护——"门禁的门禁"。模式数组被误删叶、CI 静态 lane
// 忘跑文档门禁、AGENTS.md 命令清单与 package.json 脱钩，这三类漂移没有任何
// 功能叶子会红（它们本身就在被检查物里），由本 spec 钉住。

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MODES, LEAVES } from "./run-gates.mjs";

describe("run-gates 模式组合", () => {
  it("模式里的每个叶子都有定义", () => {
    for (const [mode, leaves] of Object.entries(MODES))
      for (const leaf of leaves) expect(LEAVES[leaf], `${mode} 的叶子 ${leaf} 未定义`).toBeDefined();
  });

  it("doc-quick ⊆ doc-sync，release = doc-sync + verify-release（快速档是过滤，不是另一套）", () => {
    const sync = new Set(MODES["doc-sync"]);
    for (const leaf of MODES["doc-quick"])
      expect(sync.has(leaf), `${leaf} 在 doc-quick 却不在 doc-sync`).toBe(true);
    expect(MODES.release).toEqual([...MODES["doc-sync"], "verify-release"]);
  });

  it("doc-sync 关键叶子在列（防误删——删一个 CI 就静默失明一角）", () => {
    for (const leaf of [
      "verify-agent-notes",
      "verify-archived-agent-notes",
      "verify-doc-index",
      "verify-doc-budgets",
      "verify-translation-pairing",
      "verify-type-equiv",
      "verify-export-docs",
      "doc-typecheck",
      "verify-commands-catalog",
      "verify-md-links",
      "verify-env-independence",
    ])
      expect(MODES["doc-sync"], `doc-sync 缺 ${leaf}`).toContain(leaf);
  });
});

describe("CI 接线", () => {
  it("静态 lane 内嵌自测试 + 构建 + 全量文档门禁", async () => {
    const ci = await readFile(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain("pnpm test");
    expect(ci).toContain("pnpm build");
    expect(ci).toContain("pnpm verify:docs");
  });

  it("release 流程：产物前过 release 档门禁，产物后再扫环境无关", async () => {
    const release = await readFile(".github/workflows/release.yml", "utf8");
    expect(release).toContain("--mode release");
    expect(release).toContain("verify-env-independence.mjs");
  });
});

describe("AGENTS.md 命令清单 ↔ package.json scripts", () => {
  it("清单里的每个 pnpm 命令都真实存在", async () => {
    const fence = /```sh\n([\s\S]*?)```/.exec(await readFile("AGENTS.md", "utf8"))?.[1] ?? "";
    const scripts = JSON.parse(await readFile("package.json", "utf8")).scripts;
    for (const [, cmd] of fence.matchAll(/^pnpm (\S+)/gm)) {
      if (cmd === "install") continue; // pnpm 内建，不是 script
      expect(scripts[cmd], `AGENTS.md 列了 pnpm ${cmd}，package.json 无此 script`).toBeDefined();
    }
  });

  it("每个门禁类 script 都列进清单（改门禁不改清单即红）", async () => {
    const agents = await readFile("AGENTS.md", "utf8");
    const scripts = JSON.parse(await readFile("package.json", "utf8")).scripts;
    const gateScripts = Object.keys(scripts).filter(
      (key) => /^(verify:|lint:|gen:|record:|archive:|install:)/.test(key) || key === "test",
    );
    expect(gateScripts.length).toBeGreaterThan(0); // 防过滤式失明：一个没匹配到也算红
    for (const script of gateScripts)
      expect(agents, `package.json 有门禁 script "${script}"，AGENTS.md 命令清单未列`).toContain(`pnpm ${script}`);
  });
});
