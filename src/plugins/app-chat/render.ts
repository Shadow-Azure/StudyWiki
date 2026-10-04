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

/** Paint one assistant snapshot: collapsible reasoning, markdown with headed code
 * blocks, a model·usage footer, and errors.
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
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn btn-ghost chat-retry";
    retry.textContent = "重试";
    retry.addEventListener("click", onRetry);
    error.append(text, retry);
    el.append(error);
  }
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
