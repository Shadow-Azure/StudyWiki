// 门禁自测试：route-gates 的分类层——代表路径命中正确的路由组、命令并集
// 按固定顺序去重、git status 解析（重命名两侧/未跟踪/去重）、路由表里的命令
// 真实存在于 package.json（加新门禁命令不同步路由表即红）。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FALLBACK, ROUTES, classify, recommend, worktreePaths } from "./route-gates.mjs";

describe("分类与并集", () => {
  it("代表路径各命中对应组", () => {
    expect(recommend(["src/main.ts"]).commands).toEqual(["build", "verify:docs"]);
    expect(recommend(["src-tauri/src/lib.rs"]).commands).toEqual(["verify:docs"]);
    expect(recommend(["scripts/verify-x.mjs"]).commands).toEqual(["test", "verify:docs"]);
    expect(recommend(["docs/AGENTS.md"]).commands).toEqual(["verify:docs"]);
    expect(recommend(["AGENTS.md", "README.md", ".agents/notes/x.md"]).commands).toEqual(["verify:docs"]);
    expect(recommend(["package.json", ".github/workflows/ci.yml"]).commands).toEqual(["test", "verify:docs"]);
  });

  it("未命中回退快速档", () => {
    const { commands, hits } = recommend(["assets/logo.png"]);
    expect(commands).toEqual(FALLBACK.commands);
    expect(hits).toEqual([FALLBACK]);
  });

  it("混合改动面并集且按固定顺序（build → test → verify:docs）", () => {
    expect(recommend(["src/main.ts", "scripts/route-gates.mjs", "docs/README.md"]).commands).toEqual([
      "build",
      "test",
      "verify:docs",
    ]);
  });

  it("空改动面回退快速档", () => {
    expect(recommend([]).commands).toEqual(["lint:docs"]);
  });
});

describe("git status 解析", () => {
  it("去状态前缀、重命名取两侧、未跟踪计入、去重", () => {
    expect(
      worktreePaths(["M  docs/a.md", "R  old.md -> new.md", "?? untracked.ts", "M  docs/a.md"].join("\n")),
    ).toEqual(["docs/a.md", "old.md", "new.md", "untracked.ts"]);
  });
});

describe("路由表 ↔ package.json", () => {
  it("路由表与回退里建议的每个命令都真实存在（防脱钩）", () => {
    const scripts = Object.keys(JSON.parse(readFileSync("package.json", "utf8")).scripts);
    for (const command of [...ROUTES, FALLBACK].flatMap((route) => route.commands))
      expect(scripts, `路由表建议 pnpm ${command}，package.json 无此 script`).toContain(command);
  });
});
