import type { Context } from "cordis";
import type { ContentPart, RedactedSettings } from "../../host/llm";
import type { ChatStreamHandle, PartialAssistant } from "../../host/llm-stream";
import { fileToAttachment, type PendingAttachment } from "./attachments";
import { createStreamRenderer } from "./render";

/** Plugin id in the manifest and static module table. */
export const name = "app-chat";
/** Service keys awaited before apply runs. */
export const inject = ["llm", "workspace", "slots"];

/** DOM/rAF seams needed by the chat panel; injected by tests. */
export interface ChatDeps {
  /** Frame scheduler used to coalesce streaming paints. */
  raf: (callback: () => void) => number;
  /** Optional host file-picker seam; the current host has no dialog service. */
  pickFile: () => Promise<string | null>;
}

/** Real browser scheduling; file picking is unavailable until a host dialog seam lands. */
export const defaultChatDeps: ChatDeps = {
  raf: (callback: () => void) => requestAnimationFrame(callback),
  pickFile: async () => null,
};

/** One turn in the in-memory conversation sent to the model. */
interface ChatMessage {
  role: string;
  content: string | ContentPart[];
}

/** An in-flight assistant response and its DOM target. */
interface ActiveChat {
  /** Set once chatStream resolves; null only in the invocation startup gap. */
  handle: ChatStreamHandle | null;
  /** Latest read-only view returned by the host-owned stream assembler. */
  snapshot: PartialAssistant;
  wrapper: HTMLElement;
  stream: HTMLElement;
  finishing: boolean;
  /** Retained when Stop is clicked before the stream handle exists. */
  stopRequested: boolean;
}

/** Shape of the workspace facade consumed by this UI plugin. */
interface ChatWorkspace {
  activeFile: { name: string } | null;
  events: { on: (event: string, listener: (file?: { name: string } | null) => void) => () => void };
}

/** Extract a stable UI-facing code/message pair from service and chunk failures. */
function toChatError(error: unknown): { code: string; message: string } {
  const shape = error as { code?: unknown; message?: unknown };
  return {
    code: typeof shape?.code === "string" ? shape.code : "CHAT_FAILED",
    message: typeof shape?.message === "string" ? shape.message : String(error),
  };
}

/** Build a text-or-multimodal chat content value from a draft and staged media. */
function composeContent(text: string, attachments: PendingAttachment[]): string | ContentPart[] {
  if (attachments.length === 0) return text;
  const parts: ContentPart[] = [];
  if (text.trim()) parts.push({ type: "text", text });
  parts.push(...attachments.map((attachment) => attachment.part));
  return parts;
}

/** Add capability suffixes to a model option without mutating the id. */
function modelLabel(id: string, capabilities: string[]): string {
  const marks = [
    ...(capabilities.includes("vision") ? ["vision"] : []),
    ...(capabilities.includes("audio") ? ["audio"] : []),
  ];
  return marks.length > 0 ? `${id} · ${marks.join(" · ")}` : id;
}

/** 在右侧栏提供内存态 chat：流式渲染、多模态粘贴/拖拽、中止与失败重试。
 * 会话仅存于当前插件实例；模型下拉来自 chat endpoint 的脱敏配置。
 * @param ctx Host context（llm/workspace/slots injected）。
 * @param _config Reserved for future chat defaults.
 * @param deps Testable DOM scheduling/file seams.
 * @returns Teardown that aborts the active stream and removes all listeners. */
export function apply(ctx: Context, _config: Record<string, unknown> = {}, deps: ChatDeps = defaultChatDeps): () => void {
  const workspace = ctx.workspace as unknown as ChatWorkspace;
  const messages: ChatMessage[] = [];
  let attachments: PendingAttachment[] = [];
  let current: ActiveChat | null = null;
  let selectedModel: string | null = null;
  let disposed = false;
  let chatRoot: HTMLElement | null = null;
  let composer: HTMLElement | null = null;
  let transcript: HTMLElement | null = null;
  let chips: HTMLElement | null = null;
  let input: HTMLTextAreaElement | null = null;
  let sendButton: HTMLButtonElement | null = null;
  let contextRow: HTMLElement | null = null;
  let modelSelect: HTMLSelectElement | null = null;
  const offWorkspace = workspace.events.on("file-opened", (file) => {
    if (contextRow) paintContext(contextRow, file?.name ?? null);
  });

  const paintSendButton = (): void => {
    if (!sendButton) return;
    sendButton.textContent = current ? "■ 停止" : "发送";
    sendButton.classList.toggle("chat-stopping", Boolean(current));
  };

  const renderChips = (): void => {
    const chipHost = chips;
    if (!chipHost) return;
    chipHost.replaceChildren();
    if (chips) chips.hidden = attachments.length === 0;
    attachments.forEach((attachment, index) => {
      const chip = document.createElement("div");
      chip.className = "chat-chip";
      const label = document.createElement("span");
      label.className = "chat-chip-label";
      label.textContent = attachment.label;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chat-chip-remove";
      remove.setAttribute("aria-label", `移除附件 ${attachment.label}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        attachments.splice(index, 1);
        renderChips();
      });
      chip.append(label, remove);
      chipHost.append(chip);
    });
  };

  const addUserMessage = (content: string | ContentPart[]): void => {
    if (!transcript) return;
    const row = document.createElement("div");
    row.className = "chat-message chat-user";
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = typeof content === "string"
      ? content
      : content.map((part) => part.type === "text" ? part.text : `[${part.type === "image" ? "图片" : "音频"}]`).join(" ");
    row.append(bubble);
    transcript.append(row);
    transcript.scrollTop = transcript.scrollHeight;
  };

  const beginAssistant = (): ActiveChat | null => {
    if (!transcript || !modelSelect) return null;
    const wrapper = document.createElement("div");
    wrapper.className = "chat-message chat-assistant";
    wrapper.dataset.model = modelSelect.value || "assistant";
    const stream = document.createElement("div");
    stream.className = "chat-stream";
    wrapper.append(stream);
    transcript.append(wrapper);
    transcript.scrollTop = transcript.scrollHeight;
    return {
      handle: null,
      snapshot: { reasoning: "", text: "", toolCalls: [] },
      stream,
      wrapper,
      finishing: false,
      stopRequested: false,
    };
  };

  const finishComplete = (active: ActiveChat): void => {
    if (disposed) return;
    messages.push({ role: "assistant", content: active.snapshot.text });
    current = null;
    paintSendButton();
  };

  const finishError = (active: ActiveChat, error: { code: string; message: string }): void => {
    if (disposed) return;
    if (!active.snapshot.error) active.snapshot = { ...active.snapshot, error };
    if (active.snapshot.text) messages.push({ role: "assistant", content: active.snapshot.text });
    current = null;
    paintSendButton();
  };

  const finishNeutralEnd = (active: ActiveChat): void => {
    if (disposed || active.finishing) return;
    active.finishing = true;
    if (active.snapshot.text) messages.push({ role: "assistant", content: active.snapshot.text });
    const marker = document.createElement("div");
    marker.className = "chat-interrupted";
    marker.textContent = "已结束";
    active.wrapper.append(marker);
    current = null;
    paintSendButton();
  };

  const markInterrupted = (active: ActiveChat): void => {
    if (disposed || active.finishing) return;
    active.finishing = true;
    if (active.snapshot.text) messages.push({ role: "assistant", content: active.snapshot.text });
    const marker = document.createElement("div");
    marker.className = "chat-interrupted";
    marker.textContent = "已中断 · 已保留以上内容";
    active.wrapper.append(marker);
    current = null;
    paintSendButton();
  };

  const stop = (): void => {
    if (!current) return;
    const active = current;
    active.stopRequested = true;
    void active.handle?.abort().then(() => markInterrupted(active)).catch(() => markInterrupted(active));
  };

  const retryLastUser = (): void => {
    if (current) return;
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (!lastUser) return;
    void startStream(lastUser.content);
  };

  async function startStream(content: string | ContentPart[], remember = false): Promise<void> {
    if (current) return;
    if (remember) messages.push({ role: "user", content });
    const active = beginAssistant();
    if (!active) return;
    current = active;
    paintSendButton();
    const renderer = createStreamRenderer(active.stream, (callback) => deps.raf(() => {
      if (disposed) return;
      callback();
    }), retryLastUser);
    try {
      const handle = await ctx.llm.chatStream({
        ...(selectedModel ? { model: selectedModel } : {}),
        messages: [...messages],
      });
      active.handle = handle;
      if (active.stopRequested) {
        void handle.abort().then(() => markInterrupted(active)).catch(() => markInterrupted(active));
      }
      const settled = handle.settled.catch((error: unknown) => {
        if (disposed) return;
        if (!active.snapshot.error) {
          active.snapshot = { ...active.snapshot, error: toChatError(error) };
        }
        throw error;
      });
      for await (const _chunk of handle.events) {
        if (disposed) return;
        active.snapshot = handle.snapshot();
        renderer.update(active.snapshot);
      }
      await settled;
      if (disposed) return;
      active.snapshot = handle.snapshot();
      renderer.update(active.snapshot);
      if (active.snapshot.finishReason) finishComplete(active);
      else if (active.snapshot.error) finishError(active, active.snapshot.error);
      else finishNeutralEnd(active);
    } catch (error) {
      if (disposed || current !== active) return;
      if (current === active) {
        finishError(active, toChatError(error));
        renderer.update(active.snapshot);
      }
    }
  }

  const sendDraft = (): void => {
    if (current || !input || !modelSelect) return;
    const text = input.value.trim();
    if (!text && attachments.length === 0) return;
    selectedModel = modelSelect.value || null;
    const content = composeContent(text, attachments);
    addUserMessage(content);
    input.value = "";
    attachments = [];
    renderChips();
    void startStream(content, true);
  };

  const addFiles = async (files: FileList | File[]): Promise<void> => {
    const converted = await Promise.all([...files].map(fileToAttachment));
    if (disposed) return;
    attachments.push(...converted.filter((item): item is PendingAttachment => item !== null));
    renderChips();
  };

  const onPaste = (event: Event): void => {
    const data = (event as Event & { clipboardData?: { files?: FileList } }).clipboardData;
    if (data?.files && data.files.length > 0) {
      event.preventDefault();
      void addFiles(data.files);
    }
  };

  const onDragOver = (event: DragEvent): void => {
    event.preventDefault();
  };

  const onDrop = (event: DragEvent): void => {
    if (event.dataTransfer?.files.length) {
      event.preventDefault();
      void addFiles(event.dataTransfer.files);
    }
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    sendDraft();
  };

  const offSlot = ctx.slots.register("sidebar.right", (el) => {
    chatRoot = document.createElement("section");
    chatRoot.className = "chat";
    const header = document.createElement("header");
    header.className = "chat-head";
    const title = document.createElement("h2");
    title.className = "chat-title";
    title.textContent = "对话";
    modelSelect = document.createElement("select");
    modelSelect.className = "chat-model-select";
    modelSelect.setAttribute("aria-label", "对话模型");
    contextRow = document.createElement("div");
    contextRow.className = "chat-context";
    paintContext(contextRow, workspace.activeFile?.name ?? null);
    header.append(title, modelSelect);
    transcript = document.createElement("div");
    transcript.className = "chat-transcript";
    chips = document.createElement("div");
    chips.className = "chat-chips";
    chips.hidden = true;
    composer = document.createElement("div");
    composer.className = "chat-composer";
    const attach = document.createElement("button");
    attach.type = "button";
    attach.className = "chat-attach";
    attach.textContent = "📎";
    attach.title = "本版不支持系统文件选择；请直接粘贴或拖入图片/音频。";
    attach.disabled = true;
    attach.setAttribute("aria-label", "添加附件（暂不可用）");
    input = document.createElement("textarea");
    input.className = "chat-input";
    input.rows = 3;
    input.placeholder = "就当前文档提问…";
    sendButton = document.createElement("button");
    sendButton.type = "button";
    sendButton.className = "chat-send";
    sendButton.textContent = "发送";
    sendButton.addEventListener("click", () => {
      if (current) stop();
      else sendDraft();
    });
    input.addEventListener("keydown", onKeyDown);
    input.addEventListener("paste", onPaste);
    const row = document.createElement("div");
    row.className = "chat-composer-row";
    const hint = document.createElement("span");
    hint.className = "chat-hint";
    hint.textContent = "Enter 发送 · Shift+Enter 换行";
    row.append(attach, hint, sendButton);
    composer.append(input, row);
    chatRoot.append(header, contextRow, transcript, chips, composer);
    chatRoot.addEventListener("dragover", onDragOver);
    chatRoot.addEventListener("drop", onDrop);
    el.append(chatRoot);
    paintSendButton();
    void ctx.llm.listEndpoints().then((settings: RedactedSettings) => {
      if (disposed || !modelSelect) return;
      const models = settings.endpoints
        .filter((endpoint) => endpoint.kind === "chat")
        .flatMap((endpoint) => endpoint.models);
      const unique = new Map(models.map((model) => [model.id, model]));
      modelSelect.replaceChildren();
      for (const model of unique.values()) {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = modelLabel(model.id, model.capabilities);
        if (model.id === settings.defaultModel) selectedModel = model.id;
        modelSelect.append(option);
      }
      if (!selectedModel) selectedModel = modelSelect.options[0]?.value ?? null;
      if (selectedModel) modelSelect.value = selectedModel;
    }).catch((error: unknown) => {
      if (disposed) return;
      if (contextRow) contextRow.textContent = `模型配置不可用：${toChatError(error).code}`;
    });
  });

  return () => {
    disposed = true;
    void current?.handle?.abort().catch(() => {});
    offWorkspace();
    offSlot();
  };
}

/** 渲染上下文行：azurite 圆点 + 活动文件名；未选择时只留弱化文案。 */
function paintContext(row: HTMLElement, name: string | null): void {
  if (!name) {
    row.textContent = "未选择文件";
    return;
  }
  const dot = document.createElement("span");
  dot.className = "chat-ctx-dot";
  dot.textContent = "●";
  const label = document.createElement("span");
  label.textContent = name;
  row.replaceChildren(dot, label);
}
