import type { PartialAssistant } from "../../host/llm-stream";
import { renderMarkdown } from "../../ui/markdown";

/** Callback used by an error banner to resend the latest user turn. */
export type RetryHandler = () => void;

/** Batch streaming snapshots into one paint per animation frame.
 * @param el Assistant stream container owned by the caller.
 * @param rAF Frame scheduler seam for tests and the host webview.
 * @param onRetry Invoked when the painted error banner's retry button is clicked.
 * @returns Snapshot updater for the stream loop. */
export function createStreamRenderer(
  el: HTMLElement,
  rAF: (callback: () => void) => number,
  onRetry: RetryHandler,
): { update: (snapshot: PartialAssistant) => void } {
  let pending: PartialAssistant | null = null;
  let scheduled = false;
  return {
    update(snapshot: PartialAssistant): void {
      pending = snapshot;
      if (scheduled) return;
      scheduled = true;
      rAF(() => {
        scheduled = false;
        if (pending) paint(el, pending, onRetry);
      });
    },
  };
}

/** Paint one assistant snapshot: collapsible reasoning, markdown, usage, and errors.
 * Reasoning stays open while streaming and folds when finish or error is present.
 * @param el Assistant stream container to replace.
 * @param snapshot Current immutable view of the assembled response.
 * @param onRetry Handler attached to the error banner's retry button. */
export function paint(el: HTMLElement, snapshot: PartialAssistant, onRetry: RetryHandler): void {
  el.replaceChildren();
  if (snapshot.reasoning) {
    const reason = document.createElement("details");
    reason.className = "chat-reason";
    reason.open = !snapshot.finishReason && !snapshot.error;
    const summary = document.createElement("summary");
    summary.textContent = "推理过程";
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
    usage.textContent = `tokens 输入 ${snapshot.usage.promptTokens} · 输出 ${snapshot.usage.completionTokens}` +
      (snapshot.finishReason ? ` · finish ${snapshot.finishReason}` : "");
    el.append(usage);
  }
  if (snapshot.error) {
    const error = document.createElement("div");
    error.className = "chat-error";
    const text = document.createElement("div");
    text.className = "chat-error-text";
    text.textContent = `${snapshot.error.code}: ${snapshot.error.message}`;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn btn-ghost chat-retry";
    retry.textContent = "重试";
    retry.addEventListener("click", onRetry);
    error.append(text, retry);
    el.append(error);
  }
}
