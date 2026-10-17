// 门禁自测试：verify-walkthrough 薄壳——bootstrap 降级、永久红规则与 diff 注入。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import verifyWalkthrough, { collectWalkthrough, readDiffFiles, readNumstat } from "./verify-walkthrough.mjs";

const dirs = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempRoot(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function write(root, relativePath, text) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function writeWalkthroughPage(root, overrides = "") {
  write(
    root,
    "walkthrough/files/src/demo.ts.yaml",
    `kind: file-page
source: src/demo.ts
summary: demo source
segments:
  - snippet: |
      export const first = 1;
    note: |
      首行讲解。
${overrides}`,
  );
}

function writeSite(root, { bootstrap = false, status = "backlog", fullCoverage = false } = {}) {
  write(root, "walkthrough/overview.yaml", `kind: overview
sections:
  - heading: Overview
    body: |
      Demo overview.
`);
  write(root, "walkthrough/architecture.yaml", `kind: architecture
sections:
  - heading: Architecture
    body: |
      Demo architecture.
`);
  write(root, "walkthrough/features.yaml", "features: []\n");
  writeWalkthroughPage(
    root,
    fullCoverage
      ? `  - snippet: |
      export const second = 2;
    note: |
      第二行讲解。
  - snippet: |
      export const third = 3;
    note: |
      第三行讲解。
`
      : "",
  );
  write(root, "walkthrough/manifest.json", `${JSON.stringify({
    bootstrap,
    lineCoverage: { threshold: 0.5, exemptions: {} },
  }, null, 2)}\n`);
  const codeMap = {
    "src/": "Demo source directory",
    "src/demo.ts": "demo source",
  };
  if (!fullCoverage) codeMap["src/missing.ts"] = "missing source";
  write(root, "scripts/code-map.manifest.json", `${JSON.stringify(codeMap, null, 2)}\n`);
  write(root, "src/demo.ts", `export const first = 1;
export const second = 2;
export const third = 3;
`);
  write(root, ".agents/flow/roadmap.md", `\`\`\`yaml flow
kind: roadmap
\`\`\`
`);
  write(root, ".agents/flow/issues/demo.md", `# Demo issue

\`\`\`yaml flow
kind: issue
milestone: m2
priority: P1
status: ${status}
scope: []
adr: []
github:
  number: null
  url: null
\`\`\`
`);
}

describe("verify-walkthrough", () => {
  it("bootstrap 站点把文件页、变更和覆盖率三档降级为 WARN 且叶子绿", async () => {
    const root = tempRoot("verify-walkthrough-bootstrap-");
    writeSite(root, { bootstrap: true, status: "in-progress" });
    const result = await collectWalkthrough({ root });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      "WARN: 文件页缺失: src/missing.ts",
      "WARN: 变更页缺失: demo",
      "WARN: 行覆盖率低于阈值: src/demo.ts (33.33% < 50.00%)",
    ]);
  });

  it("bootstrap 关闭后同一站点三档转红", async () => {
    const root = tempRoot("verify-walkthrough-enforced-");
    writeSite(root, { bootstrap: false, status: "in-progress" });
    const result = await collectWalkthrough({ root });

    expect(result.ok).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([
      "文件页缺失: src/missing.ts",
      "变更页缺失: demo",
      "行覆盖率低于阈值: src/demo.ts (33.33% < 50.00%)",
    ]);
  });

  it("锚点失败在 bootstrap 期也保持红", async () => {
    const root = tempRoot("verify-walkthrough-anchor-");
    writeSite(root, { bootstrap: true });
    write(root, "walkthrough/files/src/demo.ts.yaml", `kind: file-page
source: src/demo.ts
summary: demo source
segments:
  - snippet: |
      anchor that does not exist
    note: |
      失效锚点。
`);
    const result = await collectWalkthrough({ root });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      "src/demo.ts: 锚点定位失败（walkthrough/files/src/demo.ts.yaml segments[0]）",
    ]);
    expect(result.warnings.some((item) => item.includes("行覆盖率低于阈值"))).toBe(true);
  });

  it("schema 封闭错误与功能登记错误直接进 errors", async () => {
    const root = tempRoot("verify-walkthrough-static-");
    writeSite(root, { bootstrap: true });
    write(root, "walkthrough/features.yaml", `features:
  - slug: demo
`);
    write(root, "walkthrough/files/src/demo.ts.yaml", `kind: file-page
source: src/demo.ts
summary: demo source
segments: []
`);
    const result = await collectWalkthrough({ root });

    expect(result.errors).toContain(
      "walkthrough/files/src/demo.ts.yaml: segments 必须是非空数组",
    );
    expect(result.errors).toContain("功能页缺失: demo");
    expect(result.ok).toBe(false);
  });

  it("叶子透传 flow issue 状态：backlog 缺 changes 页绿，in-progress 缺页红", async () => {
    const backlogRoot = tempRoot("verify-walkthrough-backlog-");
    writeSite(backlogRoot, { bootstrap: false, status: "backlog", fullCoverage: true });
    const backlog = await verifyWalkthrough({ root: backlogRoot });
    expect(backlog.ok).toBe(true);
    expect(backlog.errors).toEqual([]);

    const activeRoot = tempRoot("verify-walkthrough-active-");
    writeSite(activeRoot, { bootstrap: false, status: "in-progress", fullCoverage: true });
    const active = await verifyWalkthrough({ root: activeRoot });
    expect(active.ok).toBe(false);
    expect(active.errors).toEqual(["变更页缺失: demo"]);
  });

  it("注入 diffFiles 后同时执行改码改页与 touches 两条规则", async () => {
    const root = tempRoot("verify-walkthrough-diff-");
    writeSite(root, { bootstrap: false, fullCoverage: true });
    const result = await collectWalkthrough({
      root,
      diffFiles: ["src/demo.ts", "src/missing.ts"],
    });

    expect(result.errors).toEqual([
      "改码但 walkthrough/files/src/demo.ts.yaml 未在同一 diff 修改",
      "改码但缺少文件页: src/missing.ts",
      "changes touches 缺少 file 引用: src/demo.ts",
      "changes touches 缺少 file 引用: src/missing.ts",
    ]);
  });

  it("非 diff 模式跳过两条 diff 规则，CLI 把降级项输出到 stdout", async () => {
    const root = tempRoot("verify-walkthrough-cli-");
    writeSite(root, { bootstrap: true, status: "in-progress" });
    const output = execFileSync(process.execPath, [
      fileURLToPath(new URL("./verify-walkthrough.mjs", import.meta.url)),
    ], { cwd: root, encoding: "utf8" });

    expect(output).toContain("WARN: 文件页缺失: src/missing.ts");
    expect(output).toContain("WARN: 变更页缺失: demo");
    expect(output).toContain("WARN: 行覆盖率低于阈值: src/demo.ts");
    expect(output).toContain("verify-walkthrough: ok");
    expect(output).not.toContain("改码但缺少文件页");
    expect(output).not.toContain("changes touches 缺少 file 引用");
  });

  it("code-map 非 plain object 时输出契约错误并终止文件页对账", async () => {
    for (const badValue of [[], null, "x", 1]) {
      const root = tempRoot("verify-walkthrough-code-map-");
      writeSite(root, { bootstrap: false, fullCoverage: true });
      write(root, "scripts/code-map.manifest.json", `${JSON.stringify(badValue)}\n`);
      const result = await collectWalkthrough({ root });

      expect(result.ok).toBe(false);
      expect(result.errors).toContain(
        "scripts/code-map.manifest.json: 必须是扁平对象映射",
      );
      expect(result.errors).not.toContain("孤儿文件页: src/demo.ts");
    }
  });

  it("不突变调用方传入的 options 对象", async () => {
    const root = tempRoot("verify-walkthrough-options-");
    writeSite(root, { bootstrap: false, fullCoverage: true });
    const options = { root };
    const result = await collectWalkthrough(options);

    expect(result.ok).toBe(true);
    expect(options).toEqual({ root });
  });

  it("CLI 契约钉住缺失 walkthrough、缺失/坏 manifest 与 --diff 缺值", () => {
    const script = fileURLToPath(new URL("./verify-walkthrough.mjs", import.meta.url));
    const runCli = (root, args = []) => {
      try {
        const stdout = execFileSync(process.execPath, [script, ...args], {
          cwd: root,
          encoding: "utf8",
        });
        return { status: 0, stdout, stderr: "" };
      } catch (error) {
        return {
          status: error.status,
          stdout: String(error.stdout ?? ""),
          stderr: String(error.stderr ?? ""),
        };
      }
    };

    const missingSite = tempRoot("verify-walkthrough-missing-site-");
    const missingSiteResult = runCli(missingSite);
    expect(missingSiteResult.status).toBe(1);
    expect(missingSiteResult.stderr).toContain("verify-walkthrough: FAIL");
    expect(missingSiteResult.stderr).toContain("walkthrough/overview.yaml:");

    const missingManifest = tempRoot("verify-walkthrough-missing-manifest-");
    writeSite(missingManifest, { bootstrap: false, fullCoverage: true });
    rmSync(path.join(missingManifest, "walkthrough/manifest.json"));
    const missingManifestResult = runCli(missingManifest);
    expect(missingManifestResult.status).toBe(1);
    expect(missingManifestResult.stderr).toContain("verify-walkthrough: FAIL");
    expect(missingManifestResult.stderr).toContain("walkthrough/manifest.json:");
    expect(missingManifestResult.stderr).toContain("lineCoverage.threshold");

    const badManifest = tempRoot("verify-walkthrough-bad-manifest-");
    writeSite(badManifest, { bootstrap: false, fullCoverage: true });
    write(badManifest, "walkthrough/manifest.json", "{ not json\n");
    const badManifestResult = runCli(badManifest);
    expect(badManifestResult.status).toBe(1);
    expect(badManifestResult.stderr).toContain("verify-walkthrough: FAIL");
    expect(badManifestResult.stderr).toContain("walkthrough/manifest.json:");
    expect(badManifestResult.stderr).toContain("lineCoverage.threshold");

    const unknownArg = tempRoot("verify-walkthrough-unknown-arg-");
    writeSite(unknownArg, { bootstrap: false, fullCoverage: true });
    const unknownArgResult = runCli(unknownArg, ["--difi"]);
    expect(unknownArgResult.status).toBe(2);
    expect(unknownArgResult.stderr).toContain("未知参数: --difi");

    const noDiffValue = tempRoot("verify-walkthrough-no-diff-value-");
    writeSite(noDiffValue, { bootstrap: false, fullCoverage: true });
    const noDiffValueResult = runCli(noDiffValue, ["--diff"]);
    expect(noDiffValueResult.status).toBe(2);
    expect(noDiffValueResult.stderr).toContain(
      "verify-walkthrough --diff 需要 <base> 参数",
    );
  });

  it("mock git 输出经 readDiffFiles 端到端进入 diff 门禁", async () => {
    const root = tempRoot("verify-walkthrough-git-e2e-");
    writeSite(root, { bootstrap: false, fullCoverage: true });
    const diffFiles = readDiffFiles("origin/main", (...command) => {
      expect(command.slice(0, 2)).toEqual(["git", ["diff", "--name-only", "origin/main...HEAD"]]);
      return "src/demo.ts\n";
    });
    const result = await collectWalkthrough({ root, diffFiles });

    expect(result.errors).toEqual([
      "改码但 walkthrough/files/src/demo.ts.yaml 未在同一 diff 修改",
      "changes touches 缺少 file 引用: src/demo.ts",
    ]);
  });

  it("readDiffFiles 使用注入的 git 命令并返回非空行", () => {
    const calls = [];
    const output = readDiffFiles("origin/main", (...command) => {
      calls.push(command);
      return "src/demo.ts\nwalkthrough/files/src/demo.ts.yaml\n\n";
    });

    expect(calls).toEqual([["git", ["diff", "--name-only", "origin/main...HEAD"]]]);
    expect(output).toEqual(["src/demo.ts", "walkthrough/files/src/demo.ts.yaml"]);
  });

  it("readNumstat 使用注入的 git 命令并解析 numstat 行", () => {
    const calls = [];
    const rows = readNumstat("origin/main", (...command) => {
      calls.push(command);
      return "10\t3\tsrc/demo.ts\n-\t-\tassets/logo.png\n";
    });

    expect(calls).toEqual([["git", ["diff", "--numstat", "origin/main...HEAD"]]]);
    expect(rows).toEqual([
      { additions: 10, deletions: 3, path: "src/demo.ts" },
      { additions: 0, deletions: 0, path: "assets/logo.png" },
    ]);
  });

  it("--diff 档对本次修改的变更页做 scale 与 codeMap 对账（mock numstat）", async () => {
    const root = tempRoot("verify-walkthrough-scale-");
    writeSite(root, { bootstrap: false, fullCoverage: true });
    write(root, "walkthrough/changes/demo.yaml", `kind: change
issue: demo
title: Demo change
scale:
  files: 4
  additions: 30
  deletions: 3
feature: |
  功能变化。
userFlow:
  - 打开演示
architectural: |
  无。
codeMap:
  - group: 实现
    attention: must-read
    why: 核心
    files:
      - path: src/demo.ts
        note: 改动点
reviewGuide:
  order:
    - 先读变更地图
  risks: []
  acceptance:
    - item: 验收
      evidence: 证据
verification:
  - pnpm exec vitest
touches: [file:src/demo.ts]
`);
    const diffFiles = [
      "src/demo.ts",
      "walkthrough/files/src/demo.ts.yaml",
      "walkthrough/changes/demo.yaml",
      "pnpm-lock.yaml",
    ];
    const numstat = [
      { additions: 10, deletions: 3, path: "src/demo.ts" },
      { additions: 2, deletions: 0, path: "walkthrough/files/src/demo.ts.yaml" },
      { additions: 18, deletions: 0, path: "walkthrough/changes/demo.yaml" },
      { additions: 0, deletions: 0, path: "pnpm-lock.yaml" },
    ];

    const ok = await collectWalkthrough({ root, diffFiles, numstat });
    expect(ok.errors).toEqual([]);

    // files 数必须恰好相等：漏掉 pnpm-lock.yaml 行即红。
    const fewer = await collectWalkthrough({ root, diffFiles, numstat: numstat.slice(0, 3) });
    expect(fewer.errors).toEqual([
      "walkthrough/changes/demo.yaml: scale.files=4 与实际 diff 文件数 3 不一致（须恰好相等）",
    ]);

    // codeMap 漏覆盖语义路径即红。
    const wider = await collectWalkthrough({
      root,
      diffFiles: [...diffFiles, "src/other.ts"],
      numstat: [...numstat, { additions: 1, deletions: 1, path: "src/other.ts" }],
    });
    expect(wider.errors).toEqual([
      "改码但缺少文件页: src/other.ts",
      "changes touches 缺少 file 引用: src/other.ts",
      "walkthrough/changes/demo.yaml: scale.files=4 与实际 diff 文件数 5 不一致（须恰好相等）",
      "walkthrough/changes/demo.yaml: scale.deletions=3 超出实际 4 的 ±10% 容差",
      "变更页 codeMap 未覆盖语义路径: src/other.ts",
    ]);
  });
});
