import type { PartialAssistant } from "../../host/llm-stream";
import type { AgentToolCall } from "../agent-core/types";
import type { ApprovalOutcome, ApprovalRequest } from "../agent-core/tools";
import { renderMarkdown } from "../../ui/markdown";

/** Pending or persisted decision shown by an approval card. */
type ApprovalCardState =
  | "pending"
  | { decision: ApprovalOutcome["decision"]; decider: "human" | "guardian"; reason?: string };

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

/** Render an approval request in exactly one interactive or read-only state.
 * Pending write/edit cards expose `[data-approve]` and `[data-deny]`; pending
 * read-outside cards expose grant choices `[data-grant-file]` / `[data-grant-dir]`
 * plus `[data-deny]`. Decided cards contain no controls and preserve decision
 * source and denial reason. The renderer does not mutate its own state after a
 * click; the host must replace the card with its decided rendering.
 * @param req Approval payload to display.
 * @param state Whether approval is pending, or the persisted decision record.
 * @param onRespond Optional sink for pending-card decisions.
 * @returns Approval card root owned by the caller. */
export function renderApprovalCard(
  req: ApprovalRequest,
  state: ApprovalCardState,
  onRespond?: (outcome: ApprovalOutcome) => void,
): HTMLElement {
  const card = document.createElement("article");
  card.className = "agent-approval-card";
  card.dataset.approvalId = req.id;
  card.dataset.state = typeof state === "string" ? "pending" : "decided";

  const heading = document.createElement("div");
  heading.className = "agent-approval-card-title";
  const action = document.createElement("strong");
  action.textContent = req.summary;
  const target = document.createElement("span");
  target.textContent = req.path;
  heading.append(action, target);

  const kind = document.createElement("div");
  kind.className = "agent-approval-card-kind";
  kind.textContent = `工具 ${req.tool} · ${req.kind}`;

  card.append(heading, kind);
  appendApprovalBody(card, req);

  if (state === "pending") {
    card.append(approvalActions(req, onRespond));
    return card;
  }

  const record = document.createElement("div");
  record.className = "agent-approval-card-record";
  const source = document.createElement("span");
  source.className = "agent-approval-card-source";
  source.textContent = state.decider === "guardian" ? "审查模型" : "用户";
  const decision = document.createElement("span");
  decision.textContent = state.decision === "allow" ? "已批准" : "已拒绝";
  record.append(source, decision);
  card.append(record);
  if (state.reason) {
    const reason = document.createElement("div");
    reason.className = "agent-approval-card-reason";
    reason.textContent = state.reason;
    card.append(reason);
  }
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

/** Add the kind-specific pending payload: write preview or explicit edit diff. */
function appendApprovalBody(card: HTMLElement, req: ApprovalRequest): void {
  if (req.kind === "edit") {
    card.append(
      approvalText("旧内容", req.oldText ?? ""),
      approvalText("新内容", req.newText ?? ""),
    );
    return;
  }
  if (req.kind === "write" && req.newText) {
    card.append(approvalText("写入内容", req.newText));
  }
}

/** Create a labelled, overflow-safe text block for write/edit previews. */
function approvalText(label: string, value: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "agent-approval-card-text";
  const name = document.createElement("span");
  name.textContent = label;
  const pre = document.createElement("pre");
  pre.textContent = value;
  box.append(name, pre);
  return box;
}

/** Build pending controls. Read-outside approval intentionally names its grant
 * scope on the allowing button instead of offering an unscooped approve. */
function approvalActions(
  req: ApprovalRequest,
  onRespond?: (outcome: ApprovalOutcome) => void,
): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "agent-approval-card-actions";
  const respond = (outcome: ApprovalOutcome) => onRespond?.(outcome);
  if (req.kind === "read-outside") {
    actions.append(
      actionButton("仅此文件", "grant-file", () => respond({ decision: "allow", grant: "file" })),
      actionButton("所在目录", "grant-dir", () => respond({ decision: "allow", grant: "dir" })),
    );
  } else {
    actions.append(actionButton("批准", "approve", () => respond({ decision: "allow" })));
  }
  actions.append(actionButton("拒绝", "deny", () => respond({ decision: "deny" })));
  return actions;
}

/** Create one pending-card action with its stable data hook. */
function actionButton(
  label: string,
  action: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset[action.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())] = "";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
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
