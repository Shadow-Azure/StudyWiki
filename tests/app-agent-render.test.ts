// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createStreamRenderer, renderApprovalPrompt, renderToolCard, renderCompactionDivider, createProcessGroup, renderDecisionLine } from "../src/plugins/app-agent/render";
import type { PartialAssistant } from "../src/host/llm-stream";

const snapshot = (patch: Partial<PartialAssistant> = {}): PartialAssistant => ({
  reasoning: "",
  text: "",
  toolCalls: [],
  ...patch,
});
const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

describe("app-agent render", () => {
  it("transcribe 审批卡：动词与上传说明", () => {
    const h = renderApprovalPrompt(
      {
        id: "t1", kind: "transcribe", tool: "transcribe", path: "/lib/a.mp4",
        summary: "上传转录 a.mp4（200.0 MB）",
        preview: {
          text: "文件：/lib/a.mp4\n大小：200.0 MB\n产物：/lib/.study-wiki/raw/a/transcript.md",
          omitted: false, totalCharacters: 80, totalLines: 4,
        },
      },
      () => {},
    );
    expect(h.root.textContent).toContain("上传音视频做语音识别");
    expect(h.detail.textContent).toContain("上传到所选 ASR endpoint");
    expect(h.detail.textContent).toContain("/lib/.study-wiki/raw/a/transcript.md");
  });

  it("审批 prompt：批准/拒绝回传，详情含 diff 文本", () => {
    const outcomes: string[] = [];
    const h = renderApprovalPrompt(
      {
        id: "a1", kind: "write", tool: "write", path: "/lib/n.md", summary: "写入笔记",
        preview: { text: "# 笔记", omitted: false, totalCharacters: 4, totalLines: 1 },
      },
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
      {
        id: "a4", kind: "write", tool: "write", path: "/lib/b.md", summary: "写",
        preview: { text: "x", omitted: false, totalCharacters: 1, totalLines: 1 },
      },
      () => {},
    );
    expect(h.detail.classList.contains("open")).toBe(false);
    h.toggle.click();
    expect(h.detail.classList.contains("open")).toBe(true);
    h.toggle.click();
    expect(h.detail.classList.contains("open")).toBe(false);
  });

  it("审批详情指向 Agent 默认设置而非模型设置", () => {
    const h = renderApprovalPrompt(
      { id: "a6", kind: "write", tool: "write", path: "/lib/n.md", summary: "写" },
      () => {},
    );
    expect(h.detail.textContent).toContain("Agent 面板 ⋯ → 默认设置");
    expect(h.detail.textContent).not.toContain("模型设置");
  });

  it("审批详情只渲染有界 preview，不泄漏完整载荷", () => {
    const fullTail = "机密尾部".repeat(100);
    const h = renderApprovalPrompt(
      {
        id: "a5", kind: "write", tool: "write", path: "/lib/n.md", summary: "写入超长笔记",
        preview: { text: "机密头部…（已省略 100 字符）…", omitted: true, totalCharacters: 400, totalLines: 1 },
      },
      () => {},
    );
    expect(h.detail.textContent).toContain("机密头部");
    expect(h.detail.textContent).toContain("已省略");
    expect(h.detail.textContent).not.toContain(fullTail);
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
