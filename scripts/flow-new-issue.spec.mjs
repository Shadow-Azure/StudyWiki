// 门禁自测试：flow:new-issue 脚手架——三件套生成、参数校验、生成物能过
// verify-flow 状态机（狗粮：脚手架产物不许红门禁）。

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { createIssue } from "./flow-new-issue.mjs";
import { loadFlowTree, validateTree } from "./flow-lib.mjs";
import { parsePairRecord, pairPaths } from "./translation-pairing-lib.mjs";
import { readFileSync } from "node:fs";

const dirs = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixtureRoot() {
  const dir = mkdtempSync(path.join(tmpdir(), "studywiki-new-issue-"));
  dirs.push(dir);
  const flow = path.join(dir, ".agents/flow");
  mkdirSync(path.join(flow, "milestones"), { recursive: true });
  mkdirSync(path.join(flow, "issues"), { recursive: true });
  writeFileSync(
    path.join(flow, "roadmap.md"),
    "# R\n\n```yaml flow\nkind: roadmap\nmilestones:\n  - m1\n```\n",
  );
  writeFileSync(
    path.join(flow, "milestones/m1-x.md"),
    "# M\n\n```yaml flow\nkind: milestone\nid: m1\ntitle: t\nstatus: planned\ngithub:\n  number: null\n  url: null\n```\n",
  );
  return dir;
}

const ARGS = {
  milestone: "m1",
  priority: "P1",
  slug: "excel-viewer",
  title: "中文标题",
  titleEn: "English title",
  scopes: ["src/**"],
};

describe("flow:new-issue", () => {
  it("生成三件套且生成物过 verify-flow 状态机", async () => {
    const root = fixtureRoot();
    const paths = await createIssue({ root, ...ARGS });
    const base = readFileSync(paths.base, "utf8");
    const en = readFileSync(paths.en, "utf8");
    expect(base).toContain("# 中文标题");
    expect(en).toContain("# English title");
    // 围栏两侧逐字节一致（配对门禁的前提）
    const fenceOf = (t) => t.match(/```yaml flow[\s\S]*?```/)[0];
    expect(fenceOf(base)).toBe(fenceOf(en));
    // 配对记录可解析
    expect(parsePairRecord(readFileSync(paths.meta, "utf8"), pairPaths(paths.base))).toBeDefined();
    // 生成物 + 夹具流程树过状态机（loadFlowTree 以 root 为基）
    const prev = process.cwd();
    process.chdir(root);
    try {
      const { tree, errors } = await loadFlowTree();
      expect(errors).toEqual([]);
      expect(validateTree(tree)).toEqual([]);
    } finally {
      process.chdir(prev);
    }
  });

  it("milestone 不存在 / 参数缺失 / slug 非 kebab 即拒", async () => {
    const root = fixtureRoot();
    await expect(createIssue({ root, ...ARGS, milestone: "m9" })).rejects.toThrow("不存在");
    await expect(createIssue({ root, ...ARGS, scopes: [] })).rejects.toThrow("必填");
    await expect(createIssue({ root, ...ARGS, slug: "Bad_Slug" })).rejects.toThrow("kebab");
    await expect(createIssue({ root, ...ARGS, priority: "P9" })).rejects.toThrow("priority");
  });
});
