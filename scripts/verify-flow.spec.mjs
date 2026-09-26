// 门禁自测试：verify-flow / flow-lib——yaml flow 解析、流程树状态机、优先级
// 推进资格、github 编号规则、bootstrap 豁免、glob/提交引用工具、diff 模式
// 的收口与同 PR 激活语义（被引 issue 资格优先按 base 评估）。

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createGateRunner } from "./spec-fixture.mjs";
import {
  collectRefs,
  eligibilityErrors,
  globToRegExp,
  parseFlowDocument,
  uncoveredFiles,
  validateTree,
} from "./flow-lib.mjs";

const { run, cleanup } = createGateRunner("verify-flow.mjs", "flow");
afterAll(cleanup);

// ── 夹具内容 ─────────────────────────────────────────────────────────────────

const ROADMAP = (ids = ["m0", "m1"]) => `# 路线图

[English](roadmap.en.md) | 中文

\`\`\`yaml flow
kind: roadmap
milestones:
${ids.map((id) => `  - ${id}`).join("\n")}
\`\`\`
`;

const MILESTONE = (id, status = "active") => `# M

[English](x.en.md) | 中文

\`\`\`yaml flow
kind: milestone
id: ${id}
title: ${id} 标题
status: ${status}
github:
  number: null
  url: null
\`\`\`
`;

const ISSUE = (overrides = {}) => {
  const d = {
    milestone: "m0",
    priority: "P0",
    status: "backlog",
    bootstrap: null,
    scope: ["src/**"],
    adr: [],
    number: "null",
    url: "null",
    ...overrides,
  };
  return `# T

[English](x.en.md) | 中文

\`\`\`yaml flow
kind: issue
milestone: ${d.milestone}
priority: ${d.priority}
status: ${d.status}${d.bootstrap === null ? "" : `\nbootstrap: ${d.bootstrap}`}
scope:
${d.scope.map((s) => `  - ${s}`).join("\n")}
adr: ${d.adr.length ? "" : "[]"}${d.adr.map((a) => `\n  - ${a}`).join("")}
github:
  number: ${d.number}
  url: ${d.url}
\`\`\`
`;
};

const tree = (issues = [], opts = {}) => ({
  roadmap: { file: ".agents/flow/roadmap.md", data: { kind: "roadmap", milestones: opts.order ?? ["m0", "m1"] } },
  milestones: (opts.milestones ?? [
    { file: ".agents/flow/milestones/m0-x.md", name: "m0-x", data: { kind: "milestone", id: "m0", title: "M0", status: "active", github: { number: null, url: null } } },
    { file: ".agents/flow/milestones/m1-x.md", name: "m1-x", data: { kind: "milestone", id: "m1", title: "M1", status: "planned", github: { number: null, url: null } } },
  ]),
  issues,
});

const issue = (name, data) => ({
  file: `.agents/flow/issues/${name}.md`,
  name,
  data: {
    kind: "issue",
    milestone: "m0",
    priority: "P0",
    status: "backlog",
    scope: ["src/**"],
    adr: [],
    github: { number: null, url: null },
    ...data,
  },
});

// ── 离线状态机（validateTree 纯函数）─────────────────────────────────────────

describe("validateTree 状态机", () => {
  it("合法树绿（backlog + null 编号）", () => {
    expect(validateTree(tree([issue("m0-01-a", {})]))).toEqual([]);
  });

  it("number 为 null 的非 backlog 且非 bootstrap 红", () => {
    const errors = validateTree(tree([issue("m0-01-a", { status: "ready" })]));
    expect(errors.join()).toContain("draft 只能处于 backlog");
  });

  it("bootstrap 允许无编号流转，但全库至多一个且限第一个 milestone", () => {
    expect(
      validateTree(tree([issue("m0-01-a", { status: "in-progress", bootstrap: true })])),
    ).toEqual([]);
    const two = validateTree(
      tree([issue("m0-01-a", { bootstrap: true }), issue("m0-02-b", { bootstrap: true })]),
    );
    expect(two.join()).toContain("至多一个");
    const wrongMilestone = validateTree(
      tree([issue("m1-01-a", { milestone: "m1", status: "in-progress", bootstrap: true })]),
    );
    expect(wrongMilestone.join()).toContain("第一个 milestone");
  });

  it("封闭集合：status/priority 越界即红", () => {
    expect(validateTree(tree([issue("m0-01-a", { status: "doing" })])).join()).toContain("status 必须是");
    expect(validateTree(tree([issue("m0-01-a", { priority: "P9" })])).join()).toContain("priority 必须是");
  });

  it("scope 空、编号重复、url 与 number 不一致均红", () => {
    expect(validateTree(tree([issue("m0-01-a", { scope: [] })])).join()).toContain("scope 必须是非空");
    const dup = validateTree(
      tree([
        issue("m0-01-a", { github: { number: 7, url: null } }),
        issue("m0-02-b", { github: { number: 7, url: null } }),
      ]),
    );
    expect(dup.join()).toContain("重复");
    const badUrl = validateTree(
      tree([issue("m0-01-a", { github: { number: 7, url: "https://github.com/o/r/issues/8" } })],),
      { repo: "o/r" },
    );
    expect(badUrl.join()).toContain("不一致");
  });

  it("milestone 与 issue 的 done 互检（双向）", () => {
    const t = tree([issue("m0-01-a", { status: "in-progress", github: { number: 1, url: null } })]);
    t.milestones[0].data.status = "done";
    expect(validateTree(t).join()).toContain("尚有未 done 的 issue");
    const t2 = tree([issue("m0-01-a", { status: "done", github: { number: 1, url: null } })]);
    expect(validateTree(t2).join()).toContain("milestone status 应为 done");
  });

  it("adr 必须落在 .agents/notes/ 内且存在", () => {
    const missing = validateTree(tree([issue("m0-01-a", { adr: ["../../notes/implemented/process/nope.md"] })]), {
      exists: () => false,
    });
    expect(missing.join()).toContain("adr 链接不存在");
    const outside = validateTree(tree([issue("m0-01-a", { adr: ["../../../etc/passwd"] })]), {
      exists: () => true,
    });
    expect(outside.join()).toContain("必须指向 .agents/notes/");
  });
});

describe("优先级推进资格", () => {
  it("跨 milestone 同档串行：m1 的 P0 在 m0 的 P0 未清时不可动工", () => {
    const errors = eligibilityErrors(
      [
        issue("m0-01-a", { status: "in-progress", github: { number: 1, url: null } }),
        issue("m1-01-b", { milestone: "m1", status: "in-progress", github: { number: 2, url: null } }),
      ],
      ["m0", "m1"],
    );
    expect(errors.join()).toContain("跨 milestone 串行");
  });

  it("跨 milestone 只串同档：m0 P0 未清不挡 m1 的 P1？——挡。m1 的 P1 要求之前 milestone 的 P1 全 done", () => {
    const errors = eligibilityErrors(
      [
        issue("m0-01-a", { priority: "P1", status: "ready", github: { number: 1, url: null } }),
        issue("m1-01-b", { milestone: "m1", priority: "P1", status: "in-progress", github: { number: 2, url: null } }),
      ],
      ["m0", "m1"],
    );
    expect(errors.join()).toContain("跨 milestone 串行");
  });

  it("档内并行不限：同档多个 in-progress 合法", () => {
    expect(
      eligibilityErrors(
        [
          issue("m0-01-a", { status: "in-progress", github: { number: 1, url: null } }),
          issue("m0-02-b", { status: "in-progress", github: { number: 2, url: null } }),
        ],
        ["m0", "m1"],
      ),
    ).toEqual([]);
  });

  it("历史更高档 done 不因低档开放而失效", () => {
    expect(
      eligibilityErrors(
        [
          issue("m0-01-a", { status: "done", github: { number: 1, url: null } }),
          issue("m0-02-b", { priority: "P1", status: "backlog", github: { number: 2, url: null } }),
          issue("m0-03-c", { priority: "P2", status: "backlog", github: { number: 3, url: null } }),
        ],
        ["m0", "m1"],
      ),
    ).toEqual([]);
  });

  it("退档解锁：最高未清档仅剩 1 个时下一档可动，剩 2 个则锁", () => {
    const one = eligibilityErrors(
      [
        issue("m0-01-a", { status: "in-progress", github: { number: 1, url: null } }),
        issue("m0-02-b", { priority: "P1", status: "in-progress", github: { number: 2, url: null } }),
      ],
      ["m0", "m1"],
    );
    expect(one).toEqual([]);
    const two = eligibilityErrors(
      [
        issue("m0-01-a", { status: "in-progress", github: { number: 1, url: null } }),
        issue("m0-02-b", { status: "ready", github: { number: 2, url: null } }),
        issue("m0-03-c", { priority: "P1", status: "in-progress", github: { number: 3, url: null } }),
      ],
      ["m0", "m1"],
    );
    expect(two.join()).toContain("未解锁");
  });
});

// ── 解析与工具 ───────────────────────────────────────────────────────────────

describe("yaml flow 解析", () => {
  it("恰好一个围栏；列表/嵌套 map/行内列表/标量", () => {
    const doc = parseFlowDocument(ISSUE({ adr: ["../../notes/x.md"] }), "f.md");
    expect(doc.kind).toBe("issue");
    expect(doc.data.scope).toEqual(["src/**"]);
    expect(doc.data.adr).toEqual(["../../notes/x.md"]);
    expect(doc.data.github).toEqual({ number: null, url: null });
  });

  it("缺围栏或多围栏即抛", () => {
    expect(() => parseFlowDocument("# 无围栏\n", "f.md")).toThrow("恰好一个");
  });
});

describe("diff 模式工具", () => {
  it("glob 匹配：**/ 跨段、* 段内", () => {
    expect(globToRegExp("scripts/**").test("scripts/a/b.mjs")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/a/b.ts")).toBe(false);
    expect(globToRegExp("docs/architecture.*").test("docs/architecture.en.md")).toBe(true);
  });

  it("提交引用：(#12) 与 [#3]，裸 #12 不算", () => {
    expect(collectRefs("实现 (#12)")).toEqual([12]);
    expect(collectRefs("fix [#3]")).toEqual([3]);
    expect(collectRefs("裸 #12 不算")).toEqual([]);
  });

  it("scope 覆盖：并集之外的文件被点名", () => {
    expect(uncoveredFiles(["src/a.ts", "etc/b.md"], ["src/**"])).toEqual(["etc/b.md"]);
    expect(uncoveredFiles(["src/a.ts"], ["src/**", "docs/**"])).toEqual([]);
  });
});

// ── 端到端（临时仓库夹具，走 verifyFlow 默认导出）────────────────────────────

describe("verifyFlow 端到端", () => {
  it("合法流程树绿", async () => {
    const result = await run({
      ".agents/flow/roadmap.md": ROADMAP(),
      ".agents/flow/milestones/m0-x.md": MILESTONE("m0"),
      ".agents/flow/milestones/m1-x.md": MILESTONE("m1", "planned"),
      ".agents/flow/issues/m0-01-a.md": ISSUE({ status: "in-progress", bootstrap: true }),
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("缺 roadmap 红；坏行一次报全", async () => {
    expect((await run({})).ok).toBe(false);
    const result = await run({
      ".agents/flow/roadmap.md": ROADMAP(["m0", "m9"]),
      ".agents/flow/milestones/m0-x.md": MILESTONE("m0"),
      ".agents/flow/issues/m9-01-a.md": ISSUE({ milestone: "m9" }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("m9");
  });
});

// ── verifyFlowDiff 端到端（真实 git 夹具：base/HEAD 两提交）────────────────

describe("verifyFlowDiff 端到端", () => {
  const dirs = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  /** 造两提交仓库：base 上 issue 为 baseStatus，HEAD 提交把它翻成 headStatus 并引用 (#7)。 */
  const repoWithStatusFlip = (baseStatus, headStatus) => {
    const dir = mkdtempSync(path.join(tmpdir(), "studywiki-flow-diff-"));
    dirs.push(dir);
    const write = (files) => {
      for (const [rel, content] of Object.entries(files)) {
        const full = path.join(dir, rel);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
    };
    const issue = (status) =>
      ISSUE({ status, number: 7, url: '"https://github.com/x/y/issues/7"', scope: [".agents/flow/**"] });
    const milestone = (status) => MILESTONE("m0", status);
    write({
      ".agents/flow/roadmap.md": ROADMAP(["m0"]),
      ".agents/flow/milestones/m0-x.md": milestone("active"),
      ".agents/flow/issues/m0-01-a.md": issue(baseStatus),
    });
    const git = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    git(["init", "-q"]);
    git(["add", "."]);
    git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "开工 (#7)"]);
    write({
      ".agents/flow/milestones/m0-x.md": milestone(headStatus === "done" ? "done" : "active"),
      ".agents/flow/issues/m0-01-a.md": issue(headStatus) + (headStatus === baseStatus ? "\nReview note.\n" : ""),
    });
    git(["add", "."]);
    git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "收口 (#7)"]);
    return dir;
  };

  const runDiff = async (dir) => {
    const prev = process.cwd();
    const savedTitle = process.env.PR_TITLE;
    delete process.env.PR_TITLE;
    process.chdir(dir);
    try {
      const gate = await import(
        // @vite-ignore：绕开 vite 的动态导入分析，走原生 ESM。
        new URL(`./verify-flow.mjs?fixture=diff-${dirs.length}`, import.meta.url).href
      );
      return await gate.verifyFlowDiff("HEAD~1");
    } finally {
      process.chdir(prev);
      if (savedTitle !== undefined) process.env.PR_TITLE = savedTitle;
    }
  };

  it("收口提交：base 上 in-progress 的 issue 在 HEAD 翻 done 仍可挂引用", async () => {
    const result = await runDiff(repoWithStatusFlip("in-progress", "done"));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("同一 PR 激活：base backlog 在 HEAD 推进 done 可挂引用", async () => {
    const result = await runDiff(repoWithStatusFlip("backlog", "done"));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("同一 PR 未激活：base backlog 在 HEAD 仍 backlog 仍红", async () => {
    const result = await runDiff(repoWithStatusFlip("backlog", "backlog"));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("backlog 激活除外");
  });

  it("base 上已 done 的 issue 挂引用仍红", async () => {
    const result = await runDiff(repoWithStatusFlip("done", "done"));
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("ready / in-progress");
  });
});
