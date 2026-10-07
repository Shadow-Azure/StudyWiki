import type { Context } from "cordis";
import type { ContentPart, LlmService, RedactedSettings } from "../../host/llm";
import type { PartialAssistant } from "../../host/llm-stream";
import type { AgentEvent } from "../agent-core/loop";
import type { AgentSession, SessionMeta } from "../agent-core/service";
import type { ApprovalOutcome, ApprovalRequest } from "../agent-core/tools";
import type { AgentMessage } from "../agent-core/types";
import { fileToAttachment, type PendingAttachment } from "./attachments";
import {
  createProcessGroup,
  createStreamRenderer,
  renderApprovalCard,
  renderCompactionDivider,
  renderToolCard,
} from "./render";

/** Plugin id in the manifest and static module table. */
export const name = "app-agent";
/** Service keys awaited before apply runs; llm is optional for model choices. */
export const inject = ["agent", "slots", "workspace"];

/** Shape of the workspace projection used by the panel chrome. */
interface AgentWorkspace {
  activeFile: { name: string } | null;
  events: {
    on(event: "file-opened", listener: (file?: { name: string } | null) => void): () => void;
    on(event: "root-changed", listener: (root: string | null) => void): () => void;
    on(event: string, listener: (value?: unknown) => void): () => void;
  };
}

/** One pending tool card tracked until its result event arrives. */
interface ActiveToolCard {
  card: HTMLElement;
  callId: string;
}

/** Extract a stable UI-facing code/message pair from optional facade failures. */
function toPanelError(error: unknown): { code: string; message: string } {
  const shape = error as { code?: unknown; message?: unknown };
  return {
    code: typeof shape?.code === "string" ? shape.code : "CHAT_FAILED",
    message: typeof shape?.message === "string" ? shape.message : String(error),
  };
}

/** Build text-or-multimodal agent input from a draft and staged media. */
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

/** Project a persisted assistant message into the stream renderer snapshot. */
function assistantSnapshot(message: Extract<AgentMessage, { role: "assistant" }>): PartialAssistant {
  return {
    reasoning: message.reasoning,
    text: message.text,
    toolCalls: message.toolCalls.map((call, index) => ({ index, ...call })),
    usage: message.usage,
    finishReason: message.finishReason,
  };
}

/** Provide the right-rail persistent agent panel: sessions, approvals, modes,
 * model choice, streaming turns, and multimodal composer attachments.
 * @param ctx Host context（agent/workspace/slots injected; llm read only if present）。
 * @param _config Reserved for future panel defaults.
 * @returns Teardown that unsubscribes and aborts the open session without disposing agent-core.
 */
export function apply(ctx: Context, _config: Record<string, unknown> = {}): () => void {
  const workspace = ctx.workspace as unknown as AgentWorkspace;
  const llm = (ctx as Context & { llm?: LlmService }).llm;
  let disposed = false;
  let session: AgentSession | null = null;
  let offSession: (() => void) | null = null;
  let offApprovals: (() => void) | null = null;
  let offRootChanged: (() => void) | null = null;
  let rootGeneration = 0;
  let renderer: ReturnType<typeof createStreamRenderer> | null = null;
  let activeStream: HTMLElement | null = null;
  let activeWrapper: HTMLElement | null = null;
  let activeTools = new Map<string, ActiveToolCard>();
  let processGroup: ReturnType<typeof createProcessGroup> | null = null;
  let turnStartedAt = 0;
  let turnStepCount = 0;
  let selectedModel: string | null = null;
  let endpointDefault: string | null = null;
  let durableApprovalMode: "ask" | "auto" = "ask";
  let attachments: PendingAttachment[] = [];
  let sessionTitle = "新会话";
  let sessions: SessionMeta[] = [];
  let pendingSend = false;

  let panel: HTMLElement | null = null;
  let titleEl: HTMLElement | null = null;
  let sessionSelect: HTMLSelectElement | null = null;
  let modelSelect: HTMLSelectElement | null = null;
  let defaultModeElement: HTMLSelectElement | null = null;
  let rootNotice: HTMLElement | null = null;
  let contextRow: HTMLElement | null = null;
  let transcript: HTMLElement | null = null;
  let chips: HTMLElement | null = null;
  let notice: HTMLElement | null = null;
  let input: HTMLTextAreaElement | null = null;
  let sendButton: HTMLButtonElement | null = null;
  let stopButton: HTMLButtonElement | null = null;
  let modeAsk: HTMLButtonElement | null = null;
  let modeAuto: HTMLButtonElement | null = null;

  const offWorkspace = workspace.events.on("file-opened", (file) => {
    if (contextRow) paintContext(contextRow, file === null || file === undefined ? null : file.name);
  });
  offRootChanged = workspace.events.on("root-changed", (root) => {
    void handleRootChanged(root);
  });

  const paintButtons = (): void => {
    const running = session?.running === true;
    if (sendButton) sendButton.disabled = running;
    if (stopButton) stopButton.disabled = false;
  };

  const paintModes = (): void => {
    const mode = session?.mode ?? "ask";
    modeAsk?.classList.toggle("active", mode === "ask");
    modeAuto?.classList.toggle("active", mode === "auto");
  };

  const paintTitle = (): void => {
    if (titleEl) titleEl.textContent = sessionTitle;
  };

  const paintModel = (): void => {
    if (modelSelect && selectedModel) modelSelect.value = selectedModel;
  };

  const paintSessionOptions = (): void => {
    if (!sessionSelect) return;
    sessionSelect.replaceChildren();
    const current = document.createElement("option");
    current.value = session?.id ?? "";
    current.textContent = sessionTitle;
    sessionSelect.append(current);
    for (const meta of sessions) {
      if (meta.id === session?.id) {
        current.value = meta.id;
        continue;
      }
      const option = document.createElement("option");
      option.value = meta.id;
      option.dataset.sessionId = meta.id;
      option.textContent = meta.title;
      sessionSelect.append(option);
    }
  };

  const refreshSessions = async (): Promise<void> => {
    if (disposed) return;
    try {
      sessions = await ctx.agent.listSessions();
      paintSessionOptions();
    } catch {
      // Listing is auxiliary; the open session and composer remain usable.
    }
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

  const beginAssistant = (): void => {
    if (!transcript) return;
    const wrapper = document.createElement("div");
    wrapper.className = "chat-message chat-assistant";
    wrapper.dataset.model = session?.model ?? endpointDefault ?? selectedModel ?? "assistant";
    const stream = document.createElement("div");
    stream.className = "chat-stream";
    wrapper.append(stream);
    transcript.append(wrapper);
    transcript.scrollTop = transcript.scrollHeight;
    activeWrapper = wrapper;
    activeStream = stream;
    renderer = createStreamRenderer(stream);
  };

  const finishActive = (): void => {
    renderer?.finalize();
    renderer = null;
    activeStream = null;
    activeWrapper = null;
    activeTools = new Map();
  };

  const appendInterrupted = (): void => {
    if (!transcript) return;
    const marker = document.createElement("div");
    marker.className = "chat-interrupted";
    marker.textContent = "已中断 · 仅保留在界面";
    if (activeWrapper) activeWrapper.append(marker);
    else transcript.append(marker);
    transcript.scrollTop = transcript.scrollHeight;
  };

  const appendError = (message: string): void => {
    if (!transcript) return;
    const error = document.createElement("div");
    error.className = "chat-error";
    const text = document.createElement("div");
    text.className = "chat-error-text";
    text.textContent = message;
    error.append(text);
    transcript.append(error);
    transcript.scrollTop = transcript.scrollHeight;
  };

  const renderHistory = (): void => {
    if (!transcript || !session) return;
    const historyCalls = new Map<string, { id: string; name: string; argumentsText: string }>();

    const appendMessage = (message: AgentMessage, target: HTMLElement[]): void => {
      if (message.role === "user") {
        const row = document.createElement("div");
        row.className = "chat-message chat-user";
        const bubble = document.createElement("div");
        bubble.className = "chat-bubble";
        bubble.textContent = typeof message.content === "string"
          ? message.content
          : message.content.map((part) =>
            part.type === "text" ? part.text : `[${part.type === "image" ? "图片" : "音频"}]`,
          ).join(" ");
        row.append(bubble);
        target.push(row);
        return;
      }
      if (message.role === "assistant") {
        for (const call of message.toolCalls) historyCalls.set(call.id, call);
        const wrapper = document.createElement("div");
        wrapper.className = "chat-message chat-assistant";
        const stream = document.createElement("div");
        stream.className = "chat-stream";
        wrapper.append(stream);
        target.push(wrapper);
        const historyRenderer = createStreamRenderer(stream);
        historyRenderer.update(assistantSnapshot(message));
        historyRenderer.finalize();
        return;
      }
      const call = historyCalls.get(message.callId) ??
        { id: message.callId, name: message.name, argumentsText: "" };
      target.push(renderToolCard(
        call,
        { content: message.content, isError: message.isError === true },
      ));
    }

    const nodes: HTMLElement[] = [];
    let historyGroup: ReturnType<typeof createProcessGroup> | null = null;
    let historySteps = 0;
    const flushHistoryGroup = (): void => {
      if (!historyGroup) return;
      historyGroup.settle(`已执行 ${historySteps} 个工具动作`, 0);
      nodes.push(historyGroup.root);
      historyGroup = null;
      historySteps = 0;
    };
    for (const line of session.lines()) {
      if (line.type === "message") {
        flushHistoryGroup();
        appendMessage(line.message, nodes);
        continue;
      }
      if (line.type === "compaction") {
        flushHistoryGroup();
        nodes.length = 0;
        nodes.push(renderCompactionDivider(line.summary));
        continue;
      }
      if (line.type === "approval") {
        flushHistoryGroup();
        const request = {
          id: line.id,
          kind: line.kind,
          tool: line.tool,
          path: line.path,
          summary: "历史审批",
        };
        const state = {
          decision: line.decision === "allow" ? "allow" as const : "deny" as const,
          decider: line.decider,
          reason: line.reason ?? (line.decision === "unavailable" ? "审批不可用" : undefined),
        };
        nodes.push(renderApprovalCard(request, state));
        continue;
      }
      if (line.type !== "tool") continue;
      if (!historyGroup) historyGroup = createProcessGroup();
      historySteps += 1;
      const call = historyCalls.get(line.callId) ??
        { id: line.callId, name: line.name, argumentsText: line.argumentsText };
      historyGroup.addStep(renderToolCard(
        call,
        { content: line.content, isError: line.isError === true },
      ));
    }
    flushHistoryGroup();
    transcript.replaceChildren(...nodes);
    transcript.scrollTop = transcript.scrollHeight;
  };

  const handleEvent = (event: AgentEvent): void => {
    if (disposed || !transcript) return;
    paintButtons();
    switch (event.type) {
      case "turn-start":
        activeTools = new Map();
        if (transcript) {
          processGroup = createProcessGroup();
          transcript.append(processGroup.root);
        }
        turnStartedAt = Date.now();
        turnStepCount = 0;
        beginAssistant();
        break;
      case "snapshot":
        if (!renderer && !activeStream) beginAssistant();
        renderer?.update(event.snapshot);
        break;
      case "tool-start": {
        const card = renderToolCard(event.call);
        activeTools.set(event.call.id, { card, callId: event.call.id });
        turnStepCount += 1;
        processGroup?.addStep(card);
        processGroup?.setRunning(`正在执行 ${event.call.name}`);
        if (transcript) transcript.scrollTop = transcript.scrollHeight;
        break;
      }
      case "tool-end": {
        const pending = activeTools.get(event.call.id);
        const card = renderToolCard(event.call, { content: event.content, isError: event.isError });
        if (pending) pending.card.replaceWith(card);
        else processGroup?.addStep(card);
        activeTools.delete(event.call.id);
        processGroup?.setRunning(activeTools.size === 0 ? `已执行 ${turnStepCount} 个动作` : `正在执行下一动作`);
        break;
      }
      case "message":
        if (event.message.role === "assistant") renderer?.update(assistantSnapshot(event.message));
        break;
      case "turn-end":
        processGroup?.settle(`已完成 ${turnStepCount} 个动作`, Date.now() - turnStartedAt);
        processGroup = null;
        finishActive();
        paintButtons();
        break;
      case "aborted":
        processGroup?.settle("回合已中断", Date.now() - turnStartedAt);
        processGroup = null;
        appendInterrupted();
        finishActive();
        paintButtons();
        break;
      case "error":
        processGroup?.settle("回合出错", Date.now() - turnStartedAt);
        processGroup = null;
        appendError(event.message);
        finishActive();
        paintButtons();
        break;
    }
  };

  const detachSession = (abortOld: boolean): void => {
    offSession?.();
    offApprovals?.();
    offSession = null;
    offApprovals = null;
    processGroup = null;
    finishActive();
    if (abortOld) void session?.abort().catch(() => {});
    session = null;
    sessionTitle = "新会话";
    sessions = [];
    pendingSend = false;
    if (transcript) transcript.replaceChildren();
    paintTitle();
    paintSessionOptions();
    paintButtons();
  };

  const handleRootChanged = async (root: string | null): Promise<void> => {
    if (disposed) return;
    const generation = ++rootGeneration;
    detachSession(true);
    if (rootNotice) {
      rootNotice.hidden = true;
      rootNotice.textContent = "";
    }
    if (notice) {
      notice.hidden = true;
      notice.textContent = "";
    }
    if (contextRow) paintContext(contextRow, null);
    if (root === null) {
      if (notice) {
        notice.textContent = "打开学习库后可使用 Agent";
        notice.hidden = false;
      }
      return;
    }
    await openSession(null);
    if (disposed || generation !== rootGeneration) return;
    await refreshSessions();
  };

  const attachSession = (next: AgentSession): void => {
    offSession?.();
    offApprovals?.();
    finishActive();
    session = next;
    sessionTitle = next.title;
    selectedModel = next.model ?? endpointDefault;
    paintTitle();
    paintModel();
    paintModes();
    paintButtons();
    paintSessionOptions();
    if (rootNotice) {
      rootNotice.hidden = next.rootMismatch === null;
      rootNotice.textContent = next.rootMismatch === null
        ? ""
        : `会话原库根不可用：${next.rootMismatch}（仅提示，不影响查看）`;
    }
    if (transcript) transcript.replaceChildren();
    renderHistory();
    offSession = next.on(handleEvent);
    offApprovals = next.onApproval((request) => showApproval(next, request));
    if (pendingSend) {
      pendingSend = false;
      sendDraft();
    }
  };

  const showApproval = (target: AgentSession, request: ApprovalRequest): void => {
    if (!transcript || disposed) return;
    const pending = renderApprovalCard(request, "pending", (outcome: ApprovalOutcome) => {
      const decided = renderApprovalCard(request, { decision: outcome.decision, decider: "human", reason: outcome.reason });
      pending.replaceWith(decided);
      target.respond(request.id, outcome);
    });
    transcript.append(pending);
    transcript.scrollTop = transcript.scrollHeight;
  };

  const openSession = async (
    id: string | null,
    title?: string,
    defaultMode: "ask" | "auto" = durableApprovalMode,
  ): Promise<void> => {
    if (disposed) return;
    try {
      const generation = rootGeneration;
      const next = await ctx.agent.openSession(id, id === null ? defaultMode : undefined);
      if (disposed || generation !== rootGeneration) return;
      if (title) sessionTitle = title;
      attachSession(next);
      await refreshSessions();
    } catch (error) {
      if (!disposed && notice) {
        notice.textContent = `会话打开失败：${toPanelError(error).message}`;
        notice.hidden = false;
      }
    }
  };

  const sendDraft = (): void => {
    if (disposed || !input || session?.running) return;
    if (!session) {
      pendingSend = true;
      return;
    }
    const text = input.value.trim();
    if (!text && attachments.length === 0) return;
    if (modelSelect?.value) selectedModel = modelSelect.value;
    if (session && session.model !== selectedModel) session.setModel(selectedModel);
    const content = composeContent(text, attachments);
    addUserMessage(content);
    input.value = "";
    const outgoingContent = attachments.length > 0 ? content as ContentPart[] : undefined;
    attachments = [];
    renderChips();
    if (notice) notice.hidden = true;
    paintButtons();
    const activeSession = session;
    void activeSession.send(text, outgoingContent)
      .then(async () => {
        sessionTitle = activeSession.title;
        paintTitle();
        paintSessionOptions();
        await refreshSessions();
      })
      .catch((error: unknown) => {
        if (disposed && notice) return;
        if (notice) {
          notice.textContent = `${toPanelError(error).code}: ${toPanelError(error).message}`;
          notice.hidden = false;
        }
      })
      .finally(() => {
        paintButtons();
      });
  };

  const stopSession = (): void => {
    if (!session) return;
    void session.abort().catch((error: unknown) => {
      if (!disposed && notice) {
        notice.textContent = `停止失败：${toPanelError(error).message}`;
        notice.hidden = false;
      }
    });
  };

  const renderChips = (): void => {
    const chipHost = chips;
    if (!chipHost) return;
    chipHost.replaceChildren();
    chipHost.hidden = attachments.length === 0;
    attachments.forEach((attachment, index) => {
      const chip = document.createElement("div");
      chip.className = "chat-chip";
      const label = document.createElement("span");
      label.className = "chat-chip-label";
      label.textContent = attachment.label;
      label.title = attachment.label;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "chat-chip-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `移除附件 ${attachment.label}`);
      remove.addEventListener("click", () => {
        attachments.splice(index, 1);
        renderChips();
      });
      chip.append(label, remove);
      chipHost.append(chip);
    });
  };

  const addFiles = async (files: FileList | File[]): Promise<void> => {
    const results = await Promise.all([...files].map(fileToAttachment));
    if (disposed) return;
    const accepted: PendingAttachment[] = [];
    const failures: string[] = [];
    for (const result of results) {
      if (result.ok) accepted.push(result.attachment);
      else failures.push(result.message);
    }
    attachments.push(...accepted);
    renderChips();
    if (notice) {
      if (failures.length > 0) {
        notice.textContent = failures.join("；");
        notice.hidden = false;
      } else {
        notice.hidden = true;
      }
    }
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
    panel = document.createElement("section");
    panel.className = "agent-panel";
    const head = document.createElement("header");
    head.className = "agent-head";
    const titleRow = document.createElement("div");
    titleRow.className = "agent-head-row";
    titleEl = document.createElement("h2");
    titleEl.className = "agent-title";
    titleEl.textContent = sessionTitle;
    sessionSelect = document.createElement("select");
    sessionSelect.className = "agent-session-select";
    sessionSelect.setAttribute("aria-label", "历史会话");
    sessionSelect.addEventListener("change", () => {
      const id = sessionSelect?.value;
      if (id) void openSession(id);
    });
    const newButton = document.createElement("button");
    newButton.type = "button";
    newButton.className = "agent-new";
    newButton.textContent = "新建";
    newButton.setAttribute("aria-label", "新建会话");
    newButton.dataset.newSession = "";
    newButton.addEventListener("click", () => void openSession(null, "新会话"));
    titleRow.append(titleEl, sessionSelect, newButton);

    const controls = document.createElement("div");
    controls.className = "agent-controls";
    const modeGroup = document.createElement("div");
    modeGroup.className = "agent-mode-group";
    modeGroup.setAttribute("role", "group");
    modeGroup.setAttribute("aria-label", "写操作批准模式");
    modeAsk = document.createElement("button");
    modeAsk.type = "button";
    modeAsk.className = "agent-mode";
    modeAsk.dataset.modeAsk = "";
    modeAsk.textContent = "请求批准";
    modeAsk.addEventListener("click", () => {
      session?.setMode("ask");
      paintModes();
    });
    modeAuto = document.createElement("button");
    modeAuto.type = "button";
    modeAuto.className = "agent-mode";
    modeAuto.dataset.modeAuto = "";
    modeAuto.textContent = "帮我批准";
    modeAuto.addEventListener("click", () => {
      session?.setMode("auto");
      paintModes();
    });
    modeGroup.append(modeAsk, modeAuto);
    modelSelect = document.createElement("select");
    modelSelect.className = "agent-model-select";
    modelSelect.setAttribute("aria-label", "Agent 模型");
    modelSelect.addEventListener("change", () => {
      selectedModel = modelSelect?.value || null;
      session?.setModel(selectedModel);
    });
    defaultModeElement = document.createElement("select");
    defaultModeElement.className = "agent-default-mode";
    defaultModeElement.setAttribute("aria-label", "新会话默认审批模式");
    for (const [value, label] of [["ask", "新会话：请求批准"], ["auto", "新会话：帮我批准"]] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      defaultModeElement.append(option);
    }
    defaultModeElement.addEventListener("change", () => {
      const mode = defaultModeElement?.value === "auto" ? "auto" : "ask";
      durableApprovalMode = mode;
      if (llm) void llm.setDefaultAgentApprovalMode(mode).catch((error: unknown) => {
        if (!disposed && notice) {
          notice.textContent = `${toPanelError(error).code}: ${toPanelError(error).message}`;
          notice.hidden = false;
        }
      });
    });
    controls.append(modeGroup, defaultModeElement, modelSelect);

    rootNotice = document.createElement("div");
    rootNotice.className = "agent-root-mismatch";
    rootNotice.hidden = true;
    contextRow = document.createElement("div");
    contextRow.className = "agent-context";
    paintContext(contextRow, workspace.activeFile?.name ?? null);
    transcript = document.createElement("div");
    transcript.className = "agent-transcript";
    chips = document.createElement("div");
    chips.className = "chat-chips";
    chips.hidden = true;
    notice = document.createElement("div");
    notice.className = "chat-notice";
    notice.hidden = true;
    const composer = document.createElement("div");
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
    input.placeholder = "让 Agent 读取、检索或修改当前库…";
    sendButton = document.createElement("button");
    sendButton.type = "button";
    sendButton.className = "chat-send";
    sendButton.dataset.send = "";
    sendButton.textContent = "发送";
    sendButton.addEventListener("click", sendDraft);
    stopButton = document.createElement("button");
    stopButton.type = "button";
    stopButton.className = "chat-send chat-stopping";
    stopButton.dataset.stop = "";
    stopButton.textContent = "停止";
    stopButton.addEventListener("click", stopSession);
    input.addEventListener("keydown", onKeyDown);
    input.addEventListener("paste", onPaste);
    const row = document.createElement("div");
    row.className = "chat-composer-row";
    const hint = document.createElement("span");
    hint.className = "chat-hint";
    hint.textContent = "Enter 发送 · Shift+Enter 换行";
    row.append(attach, hint, sendButton, stopButton);
    composer.append(input, row);
    head.append(titleRow, controls);
    panel.append(head, rootNotice, contextRow, transcript, chips, notice, composer);
    panel.addEventListener("dragover", onDragOver);
    panel.addEventListener("drop", onDrop);
    el.append(panel);
    paintModes();
    paintButtons();
    paintSessionOptions();
  });

  const loadModels = async (): Promise<void> => {
    if (!llm || !modelSelect) return;
    await llm.listEndpoints().then(async (settings: RedactedSettings) => {
      if (disposed || !modelSelect) return;
      const models = settings.endpoints
        .filter((endpoint) => endpoint.kind === "chat")
        .flatMap((endpoint) => endpoint.models);
      const unique = new Map(models.map((model) => [model.id, model]));
      modelSelect.replaceChildren();
      endpointDefault = settings.defaultModel;
      durableApprovalMode = settings.agentApprovalMode === "auto" ? "auto" : "ask";
      if (defaultModeElement) defaultModeElement.value = durableApprovalMode;
      const requested = session?.model ?? settings.defaultModel;
      selectedModel = requested && unique.has(requested)
        ? requested
        : modelSelect.options[0]?.value ?? null;
      for (const model of unique.values()) {
        const option = document.createElement("option");
        option.value = model.id;
        option.textContent = modelLabel(model.id, model.capabilities);
        modelSelect.append(option);
      }
      paintModel();
    }).catch((error: unknown) => {
      if (disposed || !contextRow) return;
      contextRow.textContent = `模型配置不可用：${toPanelError(error).code}`;
    });
  };

  queueMicrotask(() => {
    void (async () => {
      await loadModels();
      await openSession(null, "新会话");
      await refreshSessions();
    })();
  });

  return () => {
    disposed = true;
    offSession?.();
    offApprovals?.();
    finishActive();
    void session?.abort().catch(() => {});
    offWorkspace();
    offRootChanged?.();
    offSlot();
  };
}

/** Render the active-file context row; no selection gets quiet guidance. */
function paintContext(row: HTMLElement, name: string | null): void {
  if (!name) {
    row.textContent = "未选择文件";
    return;
  }
  const dot = document.createElement("span");
  dot.className = "agent-ctx-dot";
  dot.textContent = "●";
  const label = document.createElement("span");
  label.textContent = name;
  row.replaceChildren(dot, label);
}
