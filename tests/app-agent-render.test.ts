// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderApprovalPrompt, renderToolCard, renderCompactionDivider, createProcessGroup, renderDecisionLine } from "../src/plugins/app-agent/render";

describe("app-agent render", () => {
  it("审批 prompt：批准/拒绝回传，详情含 diff 文本", () => {
    const outcomes: string[] = [];
    const h = renderApprovalPrompt(
      { id: "a1", kind: "write", tool: "write", path: "/lib/n.md", summary: "写入笔记", newText: "# 笔记" },
      (o) => outcomes.push(o.decision),
    );
    expect(h.root.textContent).toContain("/lib/n.md");
    expect(h.detail.textContent).toContain("# 笔记");
    h.root.querySelector<HTMLButtonElement>("[data-approve]")!.click();
    h.root.querySelector<HTMLButtonElement>("[data-deny]")!.click();
    expect(outcomes).toEqual(["allow", "deny"]);
  });

  it("read-outside prompt 带粒度选择", () => {
    const outcomes: { grant?: string }[] = [];
    const h = renderApprovalPrompt(
      { id: "a2", kind: "read-outside", tool: "read", path: "/out/a.md", summary: "读取库外文件" },
      (o) => outcomes.push(o),
    );
    h.root.querySelector<HTMLButtonElement>("[data-grant-dir]")!.click();
    expect(outcomes[0]).toMatchObject({ decision: "allow", grant: "dir" });
  });

  it("详情浮层 toggle 状态由 handle 暴露", () => {
    const h = renderApprovalPrompt(
      { id: "a4", kind: "write", tool: "write", path: "/lib/b.md", summary: "写", newText: "x" },
      () => {},
    );
    expect(h.detail.classList.contains("open")).toBe(false);
    h.toggle.click();
    expect(h.detail.classList.contains("open")).toBe(true);
    h.toggle.click();
    expect(h.detail.classList.contains("open")).toBe(false);
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

describe("agent-ui v2 过程组", () => {
  it("运行中显示当前动作，settle 后折叠并可展开", () => {
    const g = createProcessGroup();
    g.setRunning("正在读取 01.md");
    expect(g.root.className).toContain("agent-process");
    expect(g.root.textContent).toContain("正在读取 01.md");
    g.addStep(renderToolCard({ id: "c1", name: "read", argumentsText: "{}" }));
    g.settle("已读取 1 个文件", 1200);
    expect(g.root.classList.contains("open")).toBe(false);
    expect(g.root.textContent).toContain("已读取 1 个文件");
    expect(g.root.textContent).toContain("1.2s");
    g.root.querySelector<HTMLElement>(".agent-process-summary")!.click();
    expect(g.root.classList.contains("open")).toBe(true);
    expect(g.body.children.length).toBe(1);
  });

  it("焦点在组内时 settle 不收起", () => {
    document.body.append(document.createElement("div")); // jsdom host
    const host = document.body.lastElementChild!;
    const g = createProcessGroup();
    host.append(g.root);
    const summaryEl = g.root.querySelector<HTMLElement>(".agent-process-summary")!;
    summaryEl.click(); // 手动展开
    summaryEl.focus();
    expect(document.activeElement).toBe(summaryEl);
    g.settle("已完成 2 个动作", 300);
    expect(g.root.classList.contains("open")).toBe(true);
    host.remove();
  });

  it("决策行只读且带决策者", () => {
    const el = renderDecisionLine("allow", "已批准写入 summary.md", "用户");
    expect(el.className).toBe("agent-decision-line");
    expect(el.textContent).toContain("已批准写入 summary.md");
    expect(el.textContent).toContain("用户");
    expect(el.querySelector("button")).toBeNull();
  });
});
