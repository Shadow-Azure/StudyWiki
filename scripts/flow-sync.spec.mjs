// 门禁自测试：flow-sync 的纯函数——同步计划（只挑 number 为 null 的）、
// 围栏回填（两侧同一字符串变换；已回填的拒绝重复回填）与一轮跑完的同步编排。

import { describe, expect, it } from "vitest";
import { applyGithubRef, planSync, runSync } from "./flow-sync.mjs";

const DOC = `# T

\`\`\`yaml flow
kind: issue
milestone: m0
github:
  number: null
  url: null
\`\`\`
`;

describe("planSync", () => {
  it("只计划 number 为 null 的 milestone 与 issue", () => {
    const tree = {
      milestones: [
        { file: "m0.md", data: { id: "m0", github: { number: null, url: null } } },
        { file: "m1.md", data: { id: "m1", github: { number: 3, url: "u" } } },
      ],
      issues: [
        { file: "a.md", data: { github: { number: null, url: null } } },
        { file: "b.md", data: { github: { number: 7, url: "u" } } },
      ],
    };
    const plan = planSync(tree);
    expect(plan.milestones.map((m) => m.file)).toEqual(["m0.md"]);
    expect(plan.issues.map((i) => i.file)).toEqual(["a.md"]);
  });
});

describe("applyGithubRef", () => {
  it("回填 number/url（两侧同样变换，围栏保持逐字节一致）", () => {
    const next = applyGithubRef(DOC, 12, "https://github.com/o/r/issues/12");
    expect(next).toContain("  number: 12");
    expect(next).toContain("  url: https://github.com/o/r/issues/12");
    expect(next).not.toContain("null");
  });

  it("已回填的拒绝重复回填", () => {
    const done = applyGithubRef(DOC, 12, "https://github.com/o/r/issues/12");
    expect(() => applyGithubRef(done, 13, "x")).toThrow("回填失败");
  });
});

describe("runSync", () => {
  const fresh = () => ({
    milestones: [
      { file: "m0.md", data: { id: "m0", title: "M0", github: { number: null, url: null } } },
      { file: "m1.md", data: { id: "m1", title: "M1", github: { number: 9, url: "u9" } } },
    ],
    issues: [
      { file: "a.md", name: "a", data: { milestone: "m0", github: { number: null, url: null } } },
      { file: "b.md", name: "b", data: { milestone: "m1", github: { number: 3, url: "u3" } } },
    ],
  });

  const io = (tree, remoteStates = { milestones: { 9: "open" }, issues: { 3: "OPEN" } }) => {
    const calls = { milestones: [], issues: [], backfilled: [], stateUpdates: [] };
    let next = 10;
    return {
      calls,
      createMilestone(m) {
        calls.milestones.push(m.data.id);
        return { number: 1, url: "https://github.com/o/r/milestone/1" };
      },
      createIssue(issue, milestone) {
        calls.issues.push([issue.name, milestone.data.id]);
        return { number: (next += 1), url: `https://github.com/o/r/issues/${next}` };
      },
      backfill(file, number) {
        calls.backfilled.push([file, number]);
      },
      readMilestoneState(m) {
        return remoteStates.milestones[m.data.github.number] ?? "open";
      },
      updateMilestoneState(m, state) {
        calls.stateUpdates.push(["milestone", m.data.github.number, state]);
        remoteStates.milestones[m.data.github.number] = state;
      },
      readIssueState(issue) {
        return remoteStates.issues[issue.data.github.number] ?? "OPEN";
      },
      updateIssueState(issue, state) {
        calls.stateUpdates.push(["issue", issue.data.github.number, state]);
        remoteStates.issues[issue.data.github.number] = state;
      },
      tree,
    };
  };

  it("milestone 编号写回内存，一轮即可新建 issue（首次同步不会被 null 卡住）", async () => {
    const tree = fresh();
    const fake = io(tree);
    const created = await runSync(tree, fake);
    expect(created).toEqual({ milestones: 1, issues: 1, stateUpdates: 0 });
    expect(fake.calls.issues).toEqual([["a", "m0"]]);
    expect(fake.calls.backfilled).toEqual([
      ["m0.md", 1],
      ["a.md", 11],
    ]);
    expect(tree.milestones[0].data.github.number).toBe(1);
    expect(tree.issues[0].data.github.url).toBe("https://github.com/o/r/issues/11");
  });

  it("已有编号的 done issue 会被同步为 CLOSED，状态一致的对象不再 PATCH", async () => {
    const tree = fresh();
    tree.issues[1].data.status = "done";
    const fake = io(tree);
    const result = await runSync(tree, fake);
    expect(result).toEqual({ milestones: 1, issues: 1, stateUpdates: 1 });
    expect(fake.calls.stateUpdates).toEqual([["issue", 3, "CLOSED"]]);
    expect(fake.remoteStates ?? undefined).toBeUndefined();
  });

  it("所属 milestone 不在树上时拒绝开工", async () => {
    const tree = { milestones: [], issues: [{ file: "a.md", name: "a", data: { milestone: "m0", github: { number: null, url: null } } }] };
    await expect(runSync(tree, io(tree))).rejects.toThrow("尚未同步");
  });
});
