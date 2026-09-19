// 门禁自测试：verify-flow-online 的纯校验——状态映射（done ↔ CLOSED）、
// milestone 归属与 title 匹配、url 一致性由 CLI 层薄壳组合、PR 关联要求。

import { describe, expect, it } from "vitest";
import {
  checkIssueMilestone,
  checkIssueRemote,
  checkMilestoneRemote,
  checkPrRemote,
} from "./verify-flow-online.mjs";

describe("issue 远端一致性", () => {
  it("done ↔ CLOSED，其余 ↔ OPEN", () => {
    expect(checkIssueRemote("f", "done", { state: "CLOSED" })).toEqual([]);
    expect(checkIssueRemote("f", "ready", { state: "OPEN" })).toEqual([]);
    expect(checkIssueRemote("f", "done", { state: "OPEN" }).join()).toContain("CLOSED");
    expect(checkIssueRemote("f", "in-progress", { state: "CLOSED" }).join()).toContain("OPEN");
  });

  it("归属 milestone 的 title 匹配", () => {
    expect(checkIssueMilestone("f", "M1", { milestone: { title: "M1" } })).toEqual([]);
    expect(checkIssueMilestone("f", "M1", { milestone: null }).join()).toContain("未归属");
    expect(checkIssueMilestone("f", "M1", { milestone: { title: "M2" } }).join()).toContain("M2");
  });
});

describe("milestone 远端一致性", () => {
  it("title 匹配且 done ↔ closed", () => {
    expect(
      checkMilestoneRemote("f", { title: "M1", status: "done" }, { title: "M1", state: "closed" }),
    ).toEqual([]);
    expect(
      checkMilestoneRemote("f", { title: "M1", status: "active" }, { title: "M1", state: "closed" }).join(),
    ).toContain("open");
    expect(
      checkMilestoneRemote("f", { title: "M1", status: "done" }, { title: "X", state: "closed" }).join(),
    ).toContain("title");
  });
});

describe("PR 关联", () => {
  it("必须挂 milestone 与 project（gh 的数组形状与 GraphQL 的 nodes 形状都认）", () => {
    expect(checkPrRemote({ milestone: { title: "M1" }, projectItems: [{}] })).toEqual([]);
    expect(checkPrRemote({ milestone: { title: "M1" }, projectItems: { nodes: [{}] } })).toEqual([]);
    expect(checkPrRemote({ milestone: null, projectItems: [{}] }).join()).toContain("milestone");
    expect(checkPrRemote({ milestone: { title: "M1" }, projectItems: [] }).join()).toContain("project");
    expect(checkPrRemote({ milestone: { title: "M1" }, projectItems: { nodes: [] } }).join()).toContain("project");
  });

  it("token 读不到 Projects v2 时（projectCheck 关）只查 milestone", () => {
    expect(checkPrRemote({ milestone: { title: "M1" }, projectItems: [] }, { projectCheck: false })).toEqual([]);
    expect(
      checkPrRemote({ milestone: null, projectItems: [] }, { projectCheck: false }).join(),
    ).toContain("milestone");
  });
});
