// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createStreamRenderer,
  renderApprovalCard,
  renderToolCard,
  renderCompactionDivider,
} from "../src/plugins/app-agent/render";
import type { PartialAssistant } from "../src/host/llm-stream";

const snapshot = (patch: Partial<PartialAssistant> = {}): PartialAssistant => ({
  reasoning: "",
  text: "",
  toolCalls: [],
  ...patch,
});
const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

describe("app-agent render", () => {
  it("write 审批卡 pending：批准/拒绝回传", () => {
    const outcomes: string[] = [];
    const card = renderApprovalCard(
      {
        id: "a1", kind: "write", tool: "write", path: "/lib/n.md", summary: "写入笔记",
        preview: { text: "# 笔记", omitted: false, totalCharacters: 4, totalLines: 1 },
      },
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
      {
        id: "a3", kind: "edit", tool: "edit", path: "/lib/a.md", summary: "替换",
        preview: { text: "-甲\n+乙", omitted: false, totalCharacters: 2, totalLines: 2 },
      },
      { decision: "deny", decider: "guardian", reason: "可疑" },
    );
    expect(card.textContent).toContain("审查模型");
    expect(card.textContent).toContain("可疑");
    expect(card.querySelector("button")).toBeNull();
    expect(card.textContent).toContain("甲").and.toContain("乙");
  });

  it("审批卡只渲染有界 preview，不泄漏完整载荷", () => {
    const fullTail = "机密尾部".repeat(100);
    const card = renderApprovalCard(
      {
        id: "a4", kind: "write", tool: "write", path: "/lib/n.md", summary: "写入超长笔记",
        preview: { text: "机密头部…（已省略 100 字符）…", omitted: true, totalCharacters: 400, totalLines: 1 },
      },
      "pending",
    );
    expect(card.textContent).toContain("机密头部");
    expect(card.textContent).toContain("已省略");
    expect(card.textContent).not.toContain(fullTail);
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

  it("流式渲染：reasoning 流式展开、finish 折叠、代码围栏包装、usage 落行", async () => {
    const el = document.createElement("div");
    const renderer = createStreamRenderer(el);
    renderer.update(snapshot({
      reasoning: "先整理公式",
      text: "### 答案\n\n```ts\nconst answer = 42\n```",
      usage: { promptTokens: 3, completionTokens: 5 },
    }));
    await nextFrame();

    expect(el.querySelector<HTMLElement>(".chat-reason")?.open).toBe(true);
    expect(el.querySelector<HTMLElement>(".chat-md")?.innerHTML).toContain("<h3>");
    const code = el.querySelector<HTMLElement>(".chat-code");
    expect(code?.textContent).toContain("ts");
    expect(code?.querySelector(".chat-code-copy")).not.toBeNull();
    expect(el.querySelector<HTMLElement>(".chat-usage")?.textContent).toContain("3 → 5 tokens");

    renderer.update(snapshot({
      reasoning: "先整理公式",
      text: "### 答案",
      usage: { promptTokens: 3, completionTokens: 5 },
      finishReason: "stop",
    }));
    await nextFrame();
    expect(el.querySelector<HTMLElement>(".chat-reason")?.open).toBe(false);
    expect(el.querySelector<HTMLElement>(".chat-usage")?.textContent).toContain("finish stop");
  });

  it("流式 error chunk 渲染横幅并折叠 reasoning", async () => {
    const el = document.createElement("div");
    const renderer = createStreamRenderer(el);
    renderer.update(snapshot({
      reasoning: "半截思考",
      error: { code: "BAD_RESPONSE", message: "响应中断" },
    }));
    await nextFrame();

    expect(el.querySelector<HTMLElement>(".chat-reason")?.open).toBe(false);
    expect(el.querySelector<HTMLElement>(".chat-error-text")?.textContent).toBe("BAD_RESPONSE: 响应中断");
  });
});
