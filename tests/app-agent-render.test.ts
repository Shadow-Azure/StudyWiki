// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderApprovalCard, renderToolCard, renderCompactionDivider } from "../src/plugins/app-agent/render";

describe("app-agent render", () => {
  it("write 审批卡 pending：批准/拒绝回传", () => {
    const outcomes: string[] = [];
    const card = renderApprovalCard(
      { id: "a1", kind: "write", tool: "write", path: "/lib/n.md", summary: "写入笔记", newText: "# 笔记" },
      "pending",
      (o) => outcomes.push(o.decision),
    );
    expect(card.textContent).toContain("/lib/n.md");
    card.querySelector<HTMLButtonElement>("[data-approve]")!.click();
    card.querySelector<HTMLButtonElement>("[data-deny]")!.click();
    expect(outcomes).toEqual(["allow", "deny"]);
  });

  it("read-outside 卡带粒度选择", () => {
    const outcomes: { grant?: string }[] = [];
    const card = renderApprovalCard(
      { id: "a2", kind: "read-outside", tool: "read", path: "/out/a.md", summary: "读取库外文件" },
      "pending",
      (o) => outcomes.push(o),
    );
    card.querySelector<HTMLButtonElement>("[data-grant-dir]")!.click();
    expect(outcomes[0]).toMatchObject({ decision: "allow", grant: "dir" });
  });

  it("decided 卡只读且 guardian 标注", () => {
    const card = renderApprovalCard(
      { id: "a3", kind: "edit", tool: "edit", path: "/lib/a.md", summary: "替换", oldText: "甲", newText: "乙" },
      { decision: "deny", decider: "guardian", reason: "可疑" },
    );
    expect(card.textContent).toContain("审查模型");
    expect(card.textContent).toContain("可疑");
    expect(card.querySelector("button")).toBeNull();
    expect(card.textContent).toContain("甲").and.toContain("乙");
  });

  it("工具卡结果折叠与错误样式", () => {
    const card = renderToolCard({ id: "c1", name: "grep", argumentsText: "{\"pattern\":\"x\"}" },
      { content: "无命中", isError: true });
    expect(card.querySelector("details")).not.toBeNull();
    expect(card.className).toContain("error");
  });

  it("compaction 分隔条可展开摘要", () => {
    const el = renderCompactionDivider("早前讨论了线代");
    expect(el.textContent).toContain("压缩");
    expect(el.querySelector("details")?.textContent).toContain("线代");
  });
});
