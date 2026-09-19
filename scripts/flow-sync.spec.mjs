// 门禁自测试：flow-sync 的纯函数——同步计划（只挑 number 为 null 的）与
// 围栏回填（两侧同一字符串变换；已回填的拒绝重复回填）。

import { describe, expect, it } from "vitest";
import { applyGithubRef, planSync } from "./flow-sync.mjs";

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
