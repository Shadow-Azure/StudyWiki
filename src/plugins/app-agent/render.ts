import type { PartialAssistant } from "../../host/llm-stream";
import type { AgentToolCall } from "../agent-core/types";
import type { ApprovalOutcome, ApprovalRequest } from "../agent-core/tools";
import { renderMarkdown } from "../../ui/markdown";

/** App-agent stream renderer：把同一帧内多次 update 合并为一次重绘，
 * `finalize` 立即落最后快照，避免流结束后尾部 delta 因等待动画帧丢失。
 * @param el Assistant stream container owned by the caller.
 * @returns Snapshot updater plus a final-paint flush for the stream loop. */
export function createStreamRenderer(
  el: HTMLElement,
): { update: (snapshot: PartialAssistant) => void; finalize: () => void } {
  let pending: PartialAssistant | null = null;
  let frameId: number | null = null;
  return {
    update(snapshot: PartialAssistant): void {
      pending = snapshot;
      if (frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        if (pending) paint(el, pending);
      });
    },
    finalize(): void {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      if (pending) paint(el, pending);
      pending = null;
    },
  };
}

/** Paint one assistant snapshot: collapsible reasoning, markdown with headed code
 * blocks, a tool-call count, a model·usage footer, and errors.
 * Reasoning stays open while streaming and folds when finish or error is present.
 * @param el Assistant stream container to replace.
 * @param snapshot Current immutable view of the assembled response. */
function paint(el: HTMLElement, snapshot: PartialAssistant): void {
  el.replaceChildren();
  if (snapshot.reasoning) {
    const reason = document.createElement("details");
    reason.className = "chat-reason";
    reason.open = !snapshot.finishReason && !snapshot.error;
    const summary = document.createElement("summary");
    summary.textContent = "思考过程";
    const reasonText = document.createElement("div");
    reasonText.className = "chat-reason-text";
    reasonText.textContent = snapshot.reasoning;
    reason.append(summary, reasonText);
    el.append(reason);
  }
  if (snapshot.text) {
    const markdown = document.createElement("div");
    markdown.className = "chat-md";
    markdown.innerHTML = renderMarkdown(snapshot.text);
    wrapCodeBlocks(markdown);
    el.append(markdown);
  }
  if (snapshot.toolCalls.length > 0) {
    const tools = document.createElement("div");
    tools.className = "chat-tools";
    tools.textContent = `工具调用 ${snapshot.toolCalls.length}`;
    el.append(tools);
  }
  if (snapshot.usage) {
    const usage = document.createElement("div");
    usage.className = "chat-usage";
    const model = el.closest(".chat-message")?.getAttribute("data-model") ?? "assistant";
    const fmt = (count: number): string => count.toLocaleString("en-US");
    usage.textContent = `${model} · ${fmt(snapshot.usage.promptTokens)} → ${fmt(snapshot.usage.completionTokens)} tokens` +
      (snapshot.finishReason ? ` · finish ${snapshot.finishReason}` : "");
    el.append(usage);
  }
  if (snapshot.error) {
    const error = document.createElement("div");
    error.className = "chat-error";
    const text = document.createElement("div");
    text.className = "chat-error-text";
    text.textContent = `${snapshot.error.code}: ${snapshot.error.message}`;
    error.append(text);
    el.append(error);
  }
}

/** Render one completed/pending tool invocation as a compact card whose result is
 * folded in a `<details>` element. Invalid or non-object argument JSON falls back
 * to the provider's raw `argumentsText`; failures additionally get the `error`
 * class for visual state.
 * @param call Provider tool-call identity and raw argument text.
 * @param result Tool execution output; omitted means the result is still pending.
 * @returns Stateless card root owned by the caller. */
export function renderToolCard(
  call: AgentToolCall,
  result?: { content: string; isError: boolean },
): HTMLElement {
  const card = document.createElement("article");
  card.className = result?.isError ? "agent-tool-card error" : "agent-tool-card";
  card.dataset.callId = call.id;

  const title = document.createElement("div");
  title.className = "agent-tool-card-title";
  const name = document.createElement("strong");
  name.textContent = call.name;
  const args = document.createElement("span");
  args.className = "agent-tool-card-args";
  args.textContent = summarizeArguments(call.argumentsText);
  title.append(name, args);

  const details = document.createElement("details");
  const resultSummary = document.createElement("summary");
  resultSummary.textContent = result ? "结果" : "等待结果";
  const resultText = document.createElement("pre");
  resultText.className = "agent-tool-card-result";
  resultText.textContent = result?.content ?? "尚未返回";
  details.append(resultSummary, resultText);

  card.append(title, details);
  return card;
}

/** Render a persisted compaction boundary as an expandable divider. The summary
 * remains out of the collapsed row, while expanding the `<details>` reveals it.
 * @param summary Human-readable summary of the compacted earlier conversation.
 * @returns Divider root owned by the caller. */
export function renderCompactionDivider(summary: string): HTMLElement {
  const card = document.createElement("section");
  card.className = "agent-compaction";
  const details = document.createElement("details");
  const label = document.createElement("summary");
  label.textContent = "压缩上下文";
  const text = document.createElement("div");
  text.className = "agent-compaction-summary";
  text.textContent = summary;
  details.append(label, text);
  card.append(details);
  return card;
}

/** Turn provider argument JSON into a one-line human summary without ever
 * throwing on provider-supplied malformed JSON. */
function summarizeArguments(argumentsText: string): string {
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return truncateText(argumentsText);
    }
    const parts = Object.entries(parsed as Record<string, unknown>).map(([key, value]) => {
      const valueText = typeof value === "string" ? value : JSON.stringify(value) ?? "";
      return `${key}=${valueText}`;
    });
    return truncateText(parts.join(" · "));
  } catch {
    return truncateText(argumentsText);
  }
}

/** Bound rendered argument text while preserving whole UTF-16 code units. */
function truncateText(value: string, maxLength = 180): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}

/** 把 markdown 渲染出的裸 pre 包进带语言头与复制钮的代码容器。
 * 语言名取自围栏 info string（language-* 类），无标注时显示「代码」。 */
function wrapCodeBlocks(container: HTMLElement): void {
  for (const pre of [...container.querySelectorAll("pre")]) {
    const code = pre.querySelector("code");
    const lang = /language-([\w-]+)/.exec(code?.className ?? "")?.[1] ?? "代码";
    const box = document.createElement("div");
    box.className = "chat-code";
    const bar = document.createElement("div");
    bar.className = "chat-code-bar";
    const name = document.createElement("span");
    name.textContent = lang;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "chat-code-copy";
    copy.textContent = "复制";
    copy.addEventListener("click", () => {
      void copyText(code?.textContent ?? "", copy);
    });
    bar.append(name, copy);
    const next = pre.nextSibling;
    box.append(bar, pre); // append 即移动：pre 离开原容器
    if (next) container.insertBefore(box, next);
    else container.append(box);
  }
}

/** 复制文本到剪贴板：优先 Clipboard API，降级隐藏 textarea + execCommand；
 * 无权限环境静默失败（按钮不反馈成功）。 */
async function copyText(text: string, button: HTMLButtonElement): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const helper = document.createElement("textarea");
      helper.value = text;
      document.body.append(helper);
      helper.select();
      document.execCommand?.("copy");
      helper.remove();
    }
    button.textContent = "已复制";
    setTimeout(() => { button.textContent = "复制"; }, 1200);
  } catch {
    // 剪贴板不可用：保持原样，不打断对话
  }
}

/** One collapsible turn process group: live tool steps stay hidden until the
 * user expands the summary; settling hides the body again unless focus is
 * inside, so keyboard users never lose their place.
 * @returns Group facade owned by the caller; steps appended via addStep. */
export function createProcessGroup(): {
  root: HTMLElement;
  body: HTMLElement;
  addStep(step: HTMLElement): void;
  settle(label: string, durationMs: number): void;
  setRunning(text: string): void;
} {
  const root = document.createElement("section");
  root.className = "agent-process";
  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "agent-process-summary";
  summary.setAttribute("aria-expanded", "false");
  const chev = document.createElement("span");
  chev.className = "agent-process-chevron";
  chev.textContent = "▸";
  const state = document.createElement("span");
  state.className = "agent-process-state";
  state.textContent = "●";
  const text = document.createElement("span");
  text.className = "agent-process-text";
  const time = document.createElement("span");
  time.className = "agent-process-time";
  summary.append(chev, state, text, time);
  summary.addEventListener("click", () => {
    const open = root.classList.toggle("open");
    summary.setAttribute("aria-expanded", String(open));
  });
  const body = document.createElement("div");
  body.className = "agent-process-body";
  root.append(summary, body);
  return {
    root,
    body,
    addStep(step: HTMLElement): void {
      body.append(step);
    },
    setRunning(value: string): void {
      text.textContent = value;
      root.classList.add("running");
    },
    settle(label: string, durationMs: number): void {
      text.textContent = label;
      time.textContent = `${(durationMs / 1000).toFixed(1)}s`;
      root.classList.remove("running");
      root.classList.add("done");
      if (!root.contains(document.activeElement)) root.classList.remove("open");
    },
  };
}

/** Compact read-only record of one settled approval; replaces the legacy bulky
 * decided card in the transcript.
 * @param decision Final decision recorded for the request.
 * @param label Human summary of the approved or denied action.
 * @param decider Who decided: “用户” or “审查模型”.
 * @returns Decision line root owned by the caller. */
export function renderDecisionLine(decision: "allow" | "deny", label: string, decider: string): HTMLElement {
  const line = document.createElement("div");
  line.className = "agent-decision-line";
  line.dataset.decision = decision;
  const dot = document.createElement("span");
  dot.className = "agent-decision-line-dot";
  dot.textContent = decision === "allow" ? "✓" : "✕";
  const text = document.createElement("span");
  text.textContent = label;
  const source = document.createElement("span");
  source.className = "agent-decision-line-source";
  source.textContent = decider;
  line.append(dot, text, source);
  return line;
}

/** Human summary of one pending approval request used by the composer prompt. */
function approvalVerb(req: ApprovalRequest): string {
  if (req.kind === "read-outside") return "读取库外文件";
  if (req.kind === "edit") return "修改文件";
  return "写入文件";
}

/** Build the composer takeover UI for one pending approval: a compact summary,
 * a detail popover anchored above the composer, and decision controls. The
 * renderer is stateless apart from the popover open class.
 * @param req Approval payload to display.
 * @param onRespond Sink for the user's decision.
 * @returns Prompt handle: composer body, detail popover, and toggle button. */
export function renderApprovalPrompt(
  req: ApprovalRequest,
  onRespond: (outcome: ApprovalOutcome) => void,
): { root: HTMLElement; detail: HTMLElement; toggle: HTMLButtonElement } {
  const root = document.createElement("div");
  root.className = "agent-approval-prompt";
  root.dataset.approvalId = req.id;

  const summary = document.createElement("div");
  summary.className = "agent-approval-summary";
  const warn = document.createElement("span");
  warn.className = "agent-approval-warn";
  warn.textContent = "⚠";
  const body = document.createElement("div");
  body.className = "agent-approval-summary-body";
  const question = document.createElement("div");
  question.className = "agent-approval-question";
  question.textContent = `Agent 请求${approvalVerb(req)}`;
  const sub = document.createElement("div");
  sub.className = "agent-approval-sub";
  const path = document.createElement("span");
  path.className = "agent-approval-path";
  path.textContent = req.path;
  sub.append(path);
  if (req.newText) {
    const size = document.createElement("span");
    size.textContent = ` · ${[...req.newText].length} 字符`;
    sub.append(size);
  }
  body.append(question, sub);
  summary.append(warn, body);

  const detail = renderApprovalDetail(req);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "agent-detail-toggle";
  toggle.dataset.detailToggle = "";
  toggle.setAttribute("aria-expanded", "false");
  toggle.textContent = "查看详情 ▾";
  toggle.addEventListener("click", () => {
    const open = detail.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  const actions = document.createElement("div");
  actions.className = "agent-approval-actions";
  const respond = (outcome: ApprovalOutcome): void => onRespond(outcome);
  const actionButton = (label: string, action: string, cls: string, onClick: () => void): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = cls;
    button.dataset[action.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())] = "";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  };
  if (req.kind === "read-outside") {
    actions.append(
      actionButton("仅此文件", "grant-file", "btn", () => respond({ decision: "allow", grant: "file" })),
      actionButton("所在目录", "grant-dir", "btn", () => respond({ decision: "allow", grant: "dir" })),
    );
  } else {
    actions.append(actionButton("批准", "approve", "btn approve", () => respond({ decision: "allow" })));
  }
  actions.append(actionButton("拒绝", "deny", "btn ghost", () => respond({ decision: "deny" })));

  const row = document.createElement("div");
  row.className = "agent-approval-row";
  row.append(toggle, actions);
  root.append(summary, row);
  return { root, detail, toggle };
}

/** Detail popover for one approval request: target path, change size, tool
 * signature, diff preview, and the grant-scope rule note. Read-only.
 * @param req Approval payload to explain.
 * @returns Popover root owned by the caller. */
export function renderApprovalDetail(req: ApprovalRequest): HTMLElement {
  const detail = document.createElement("div");
  detail.className = "agent-approval-detail";
  detail.dataset.approvalId = req.id;

  const head = document.createElement("div");
  head.className = "agent-approval-detail-head";
  const title = document.createElement("div");
  title.className = "agent-approval-detail-title";
  const dot = document.createElement("span");
  dot.className = "agent-approval-detail-dot";
  title.append(dot, document.createTextNode(`${approvalVerb(req)} · 等待批准`));
  head.append(title);
  detail.append(head);

  const rows = document.createElement("div");
  rows.className = "agent-approval-detail-body";
  const addRow = (key: string, value: string, mono = false): void => {
    const row = document.createElement("div");
    row.className = "agent-approval-detail-row";
    const k = document.createElement("span");
    k.className = "agent-approval-detail-key";
    k.textContent = key;
    const v = document.createElement("span");
    v.className = mono ? "agent-approval-detail-value mono" : "agent-approval-detail-value";
    v.textContent = value;
    row.append(k, v);
    rows.append(row);
  };
  addRow("目标", req.path, true);
  if (req.newText) {
    addRow("变更", `+${[...req.newText].length} 字符${req.oldText ? ` · 替换 ${[...req.oldText].length} 字符` : ""}`);
  }
  addRow("工具", `${req.tool}(${req.kind})`, true);
  if (req.newText || req.oldText) {
    const diff = document.createElement("pre");
    diff.className = "agent-approval-diff";
    if (req.oldText) {
      for (const lineText of req.oldText.split("\n")) {
        const line = document.createElement("span");
        line.className = "del";
        line.textContent = `-${lineText}`;
        diff.append(line);
      }
    }
    if (req.newText) {
      for (const lineText of req.newText.split("\n")) {
        const line = document.createElement("span");
        line.className = "add";
        line.textContent = `+${lineText}`;
        diff.append(line);
      }
    }
    rows.append(diff);
  }
  const note = document.createElement("div");
  note.className = "agent-approval-note";
  note.textContent = req.kind === "read-outside"
    ? "本次批准仅作用于该次读取；“所在目录”授予会级目录读取。默认模式可在模型设置修改。"
    : "本次批准仅作用于这一次写入；拒绝后 Agent 收到拒绝原因并可继续对话。默认模式可在模型设置修改。";
  rows.append(note);
  detail.append(rows);
  return detail;
}
