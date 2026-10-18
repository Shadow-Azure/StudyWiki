// 门禁自测试：pre-push 检视元数据保鲜。git fixture 真实提交三段变化；
// gh 与（可覆盖的）YAML 读取缝注入，网络和远端不参与测试。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { assessFreshness } from "./check-review-freshness.mjs";

const dirs = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function write(root, relativePath, text) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function git(root, argv) {
  return execFileSync("git", argv, { cwd: root, encoding: "utf8" });
}

function commitAll(root, message) {
  git(root, ["add", "."]);
  git(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message]);
  return git(root, ["rev-parse", "HEAD"]).trim();
}

function changeYaml({ id, note = "第一版元数据。" } = {}) {
  return `kind: change
issue: demo
title: Demo change
scale:
  files: 1
  additions: 2
  deletions: 1
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
        changes:
          - snippet: |
              export const first = 1;
            note: |
              ${note}
reviewGuide:
  order:
    - 先读实现
  risks: []
  acceptance:
    - item: 验收
      evidence: 测试
verification:
  - 测试
touches: [file:src/demo.ts]
${id === undefined ? "" : `skill_gen_commit_id: ${id}\n`}`;
}

/** base（origin/main）→ 源码提交 → 纯 yaml 对账 → 源码提交 → 缺字段 yaml。 */
async function freshFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "review-freshness-"));
  dirs.push(root);
  git(root, ["init", "-q", "-b", "main"]);
  write(root, "src/demo.ts", "export const first = 1;\n");
  write(root, "walkthrough/overview.yaml", "kind: overview\nsections:\n  - heading: Demo\n    body: |\n      Demo.\n");
  write(root, "walkthrough/architecture.yaml", "kind: architecture\nsections:\n  - heading: Demo\n    body: |\n      Demo.\n");
  write(root, "walkthrough/features.yaml", "features: []\n");
  write(root, "walkthrough/changes/demo.yaml", changeYaml());
  const base = commitAll(root, "base");
  write(root, "src/demo.ts", "export const first = 1;\nexport const second = 2;\n");
  write(root, "walkthrough/changes/demo.yaml", changeYaml({ id: base, note: "源码提交同步。" }));
  const source = commitAll(root, "source");
  write(root, "walkthrough/changes/demo.yaml", changeYaml({ id: source, note: "元数据对账。" }));
  const aligned = commitAll(root, "align metadata");
  write(root, "src/demo.ts", "export const first = 1;\nexport const second = 2;\nexport const third = 3;\n");
  const sourceAgain = commitAll(root, "source again");
  write(root, "walkthrough/changes/demo.yaml", changeYaml({ note: "字段被移除。" }));
  const missing = commitAll(root, "remove freshness id");
  git(root, ["update-ref", "refs/remotes/origin/main", base]);
  return { root, base, source, aligned, sourceAgain, missing };
}

function deps({ pr = true, ghError = false, readText } = {}) {
  return {
    gh: (argv) => {
      if (argv[0] !== "pr" || argv[1] !== "view") throw new Error("unsupported gh command");
      if (ghError) throw new Error("gh: network unavailable");
      if (!pr) throw new Error("no pull requests found for demo");
      return JSON.stringify({ number: 7 });
    },
    git: (root, argv) => execFileSync("git", argv, { cwd: root, encoding: "utf8" }),
    readText,
  };
}

function input(root, localSha) {
  return {
    root,
    local_ref: "refs/heads/demo",
    local_sha: localSha,
    remote_ref: "refs/heads/demo",
    remote_sha: "0000000000000000000000000000000000000000",
  };
}

describe("check-review-freshness", () => {
  it("分支无关联 PR 时放行并提示", async () => {
    const fixture = await freshFixture();
    const result = await assessFreshness(input(fixture.root, fixture.missing), deps({ pr: false }));
    expect(result.status).toBe("pass");
    expect(result.messages).toContain("无关联 PR，跳过保鲜检查");
    expect(result.errors).toEqual([]);
  });

  it("gh 探测失败时容错放行并给出 stderr 提醒", async () => {
    const fixture = await freshFixture();
    const result = await assessFreshness(input(fixture.root, fixture.missing), deps({ ghError: true }));
    expect(result.status).toBe("pass");
    expect(result.stderrMessages.join("\n")).toContain("gh 探测失败，跳过保鲜检查");
    expect(result.errors).toEqual([]);
  });

  it("skill_gen_commit_id 归一后等于 local_sha 时放行", async () => {
    const fixture = await freshFixture();
    // local_sha 可指向真实历史提交；读取缝模拟该 tip 的 YAML 已被 skill 对齐为同一 hash。
    const readText = (root, file, sha) => sha === fixture.aligned
      ? changeYaml({ id: fixture.aligned })
      : execFileSync("git", ["show", `${sha}:${file}`], { cwd: root, encoding: "utf8" });
    const result = await assessFreshness(input(fixture.root, fixture.aligned), deps({ readText }));
    expect(result.status).toBe("pass");
    expect(result.errors).toEqual([]);
  });

  it("落后且中间有源码提交时红，文案精确", async () => {
    const fixture = await freshFixture();
    const result = await assessFreshness(input(fixture.root, fixture.sourceAgain), deps());
    expect(result.status).toBe("fail");
    expect(result.errors).toEqual([
      "变更页元数据落后于最新提交（调用 walkthrough-change-metadata-gen skill 增量更新）",
    ]);
  });

  it("落后但自 id 起只触碰 changes YAML 时容错放行", async () => {
    const fixture = await freshFixture();
    const result = await assessFreshness(input(fixture.root, fixture.aligned), deps());
    expect(result.status).toBe("pass");
    expect(result.errors).toEqual([]);
  });

  it("待检页缺少 skill_gen_commit_id 时红，文案精确", async () => {
    const fixture = await freshFixture();
    const result = await assessFreshness(input(fixture.root, fixture.missing), deps());
    expect(result.status).toBe("fail");
    expect(result.errors).toEqual([
      "变更页缺少 skill_gen_commit_id（调用 walkthrough-change-metadata-gen skill 生成/更新）",
    ]);
  });
});
