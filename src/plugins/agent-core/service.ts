import type { ContentPart, LlmService } from "../../host/llm";
import type { FilesService } from "../../host/files";
import type { WorkspaceFacade } from "../../host/workspace";
import { createApprovalGate, type ApprovalGate } from "./approval";
import { runTurn, toChatMessages, type AgentEvent } from "./loop";
import { buildSystemPrompt } from "./prompt";
import { encodeLine, effectiveMessages, parseSession, sessionTitle } from "./session";
import { executeTool, TOOL_DECLARATIONS, type ApprovalOutcome, type ApprovalRequest } from "./tools";
import type { AgentMessage, ApprovalMode, SessionHeader, SessionLine } from "./types";

/** 会话列表中的一条元数据；正文与事件由 {@link AgentSession.messages} 按需加载。 */
export interface SessionMeta {
  /** 与会话文件名和 header 一致的稳定标识。 */
  id: string;
  /** 首条用户消息生成的单行标题。 */
  title: string;
  /** 会话创建时间 ISO 字符串。 */
  createdAt: string;
}

/** 一个已打开的 agent 会话；服务层负责历史视图、审批与持久化。 */
export interface AgentSession {
  /** 与会话文件名和 header 一致的稳定标识。 */
  readonly id: string;
  /** 当前写操作审批模式。 */
  readonly mode: ApprovalMode;
  /** 当前会话运行时模型；null 表示使用 endpoint 默认，不持久化。 */
  readonly model: string | null;
  /** 会话头中的显示标题，首条用户消息会同步改写。 */
  readonly title: string;
  /** True while one `send` turn is still in progress. */
  readonly running: boolean;
  /** 会话创建库根与当前库根不一致时的原库根；一致为 null。 */
  readonly rootMismatch: string | null;
  /** 当前模型有效视图；compaction 只缩短该视图，不改全文日志。 */
  messages(): AgentMessage[];
  /** Replay log lines excluding header; the array is a defensive copy. */
  lines(): SessionLine[];
  /** Subscribe to loop lifecycle, snapshot, message, and error events. */
  on(listener: (e: AgentEvent) => void): () => void;
  /** Subscribe to human approval requests raised in `ask` mode. */
  onApproval(listener: (req: ApprovalRequest) => void): () => void;
  /** Append user input, run the next turn, and persist completed messages. */
  send(text: string, content?: ContentPart[]): Promise<void>;
  /** Stop the active stream and fail all pending human approvals closed. */
  abort(): Promise<void>;
  /** Switch the session approval mode and record the change. */
  setMode(mode: ApprovalMode): void;
  /** Set this session's runtime model; null clears back to endpoint default. */
  setModel(model: string | null): void;
  /** Resolve a pending human approval request by id. */
  respond(requestId: string, outcome: ApprovalOutcome): void;
}

/** Agent 会话注册表：列表/打开/删除与插件生命周期清理。 */
export interface AgentService {
  /** List valid session headers in the current library root. */
  listSessions(): Promise<SessionMeta[]>;
  /** Open an existing session by id, or create a new session when null. */
  openSession(id: string | null): Promise<AgentSession>;
  /** Delete the backing JSONL file and detach any open session instance. */
  deleteSession(id: string): Promise<void>;
  /** Abort every open session; used by the cordis plugin disposer. */
  dispose(): void;
}

/** Dependencies needed to assemble persistent agent sessions. */
export interface AgentServiceDeps {
  /** Host LLM facade used for agent turns and guardian/compaction calls. */
  llm: LlmService;
  /** Host file facade used for tools and JSONL persistence. */
  files: FilesService;
  /** Read-only workspace projection supplying the current library root. */
  workspace: WorkspaceFacade;
  /** Prompt-token threshold for compaction; defaults to 80,000. */
  compactionThreshold?: number;
}

/** Minimal plugin-local emitter; avoids a runtime dependency on host implementation. */
interface PluginEmitter<T> {
  on(_channel: string, listener: (value: T) => void): () => void;
  emit(_channel: string, value: T): void;
}

/** Create the tiny subscription set used for agent and approval events.
 * @returns Emitter whose `on` method returns an unsubscriber. */
function createPluginEmitter<T>(): PluginEmitter<T> {
  const listeners = new Set<(value: T) => void>();
  return {
    on(_channel, listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(_channel, value) {
      for (const listener of [...listeners]) listener(value);
    },
  };
}

const DEFAULT_TITLE = "新会话";
const DEFAULT_COMPACTION_THRESHOLD = 80_000;

/** Internal mutable state shared by the public read-only session projection. */
interface InternalSession {
  id: string;
  path: string;
  header: SessionHeader;
  currentRoot: string;
  lines: SessionLine[];
  rootMismatch: string | null;
  mode: ApprovalMode;
  model: string | null;
  running: boolean;
  controller: AbortController;
  events: PluginEmitter<AgentEvent>;
  approvals: PluginEmitter<ApprovalRequest>;
  pendingApprovals: Map<string, (outcome: ApprovalOutcome) => void>;
  gate: ApprovalGate;
  isNew: boolean;
  persistQueue: Promise<void>;
  persisting: boolean;
}

/** Create the service whose cordis plugin publishes it as `ctx.agent`.
 * @param deps Host facades and optional compaction threshold.
 * @returns Registry-backed agent service with lifecycle cleanup.
 */
export function createAgentService(deps: AgentServiceDeps): AgentService {
  const threshold = deps.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD;
  const sessions = new Map<string, { internal: InternalSession; session: AgentSession }>();
  let disposed = false;

  const requireRoot = (): string => {
    const root = deps.workspace.root;
    if (!root) throw new Error("尚未打开学习库");
    return root;
  };

  const sessionPath = (id: string, root = requireRoot()): string =>
    `${root}/.study-wiki/sessions/${id}.jsonl`;

  function readHeader(text: string): SessionHeader | null {
    try {
      const firstLine = text.split("\n", 1)[0] ?? "";
      const value: unknown = JSON.parse(firstLine);
      if (typeof value !== "object" || value === null) return null;
      const record = value as { type?: unknown; header?: unknown };
      const header = record.header as Partial<SessionHeader> | undefined;
      if (record.type !== "header" || !header) return null;
      if (
        header.v !== 1 ||
        typeof header.id !== "string" ||
        typeof header.rootPath !== "string" ||
        typeof header.title !== "string" ||
        typeof header.createdAt !== "string"
      ) return null;
      return header as SessionHeader;
    } catch {
      return null;
    }
  }

  function enqueue(session: InternalSession, write: () => Promise<void>): Promise<void> {
    session.persisting = true;
    const task = session.persistQueue.then(write).then(() => undefined, (error: unknown) => {
      console.error("agent 会话落盘失败", error);
      session.events.emit("agent", { type: "error", message: `会话落盘失败：${describeError(error)}` });
    }).finally(() => {
      session.persisting = false;
    });
    session.persistQueue = task;
    return task;
  }

  function persist(session: InternalSession, line: SessionLine): Promise<void> {
    session.lines.push(line);
    return enqueue(session, () =>
      deps.files.appendSessionEvent(session.path, encodeLine(line)),
    );
  }

  function emit(session: InternalSession, event: AgentEvent): void {
    session.events.emit("agent", event);
  }

  function createSession(
    header: SessionHeader,
    currentRoot: string,
    lines: SessionLine[],
    path: string,
    rootMismatch: string | null,
    isNew: boolean,
    mode: ApprovalMode = "ask",
  ): { internal: InternalSession; session: AgentSession } {
    const controller = new AbortController();
    const pendingApprovals = new Map<string, (outcome: ApprovalOutcome) => void>();
    const internal: InternalSession = {
      id: header.id,
      path,
      header,
      currentRoot,
      lines,
      rootMismatch,
      mode,
      model: null,
      running: false,
      controller,
      events: createPluginEmitter<AgentEvent>(),
      approvals: createPluginEmitter<ApprovalRequest>(),
      pendingApprovals,
      gate: undefined as unknown as ApprovalGate,
      isNew,
      persistQueue: Promise.resolve(),
      persisting: false,
    };

    internal.gate = createApprovalGate({
      mode: () => internal.mode,
      askHuman: (request) => new Promise<ApprovalOutcome>((resolve) => {
        pendingApprovals.set(request.id, resolve);
        internal.approvals.emit("approval", request);
      }),
      chat: async (request) => ({ content: (await deps.llm.chat(request)).content }),
      log: (line) => void persist(internal, line),
    });
    const session: AgentSession = {
      get id() { return internal.id; },
      get mode() { return internal.mode; },
      get model() { return internal.model; },
      get title() { return internal.header.title; },
      get running() { return internal.running; },
      get rootMismatch() { return internal.rootMismatch; },
      messages() {
        return effectiveMessages(internal.lines);
      },
      lines() {
        return [...internal.lines];
      },
      on(listener) {
        return internal.events.on("agent", listener);
      },
      onApproval(listener) {
        return internal.approvals.on("approval", listener);
      },
      async send(text, content) {
        if (internal.running) throw new Error("会话正在运行");
        if (disposed || controller.signal.aborted) throw new Error("会话已停止");
        internal.running = true;
        try {
          const userContent = content ?? text;
          const message: AgentMessage = { role: "user", content: userContent };
          if (internal.isNew && internal.header.title === DEFAULT_TITLE) {
            const rawTitle = text || firstText(userContent);
            internal.header.title = sessionTitle(rawTitle);
            internal.isNew = false;
            await enqueue(internal, () =>
              deps.files.writeText(internal.path, `${encodeLine({ type: "header", header: internal.header })}\n`),
            );
          }
          await persist(internal, { type: "message", message });
          const agentsMd = await readAgentsMd(internal.currentRoot, deps.files);
          await compactIfNeeded(internal);
          await runTurn(
            effectiveMessages(internal.lines),
            {
              chatStream: (request) => deps.llm.chatStream(request),
              runTool: (call) => executeTool(call, {
                root: internal.currentRoot,
                host: {
                  readText: (path) => deps.files.readText(path),
                  grep: (request) => deps.files.grepFiles(request),
                  writeText: (path, contents) => deps.files.writeText(path, contents),
                  authorizeRead: (path) => deps.files.authorizeReadPath(path),
                },
                ask: (request) => internal.gate.ask(request),
              }),
              systemPrompt: () => buildSystemPrompt({
                root: internal.currentRoot,
                agentsMd: agentsMd,
                activeFilePath: deps.workspace.activeFile?.path ?? null,
                mode: internal.mode,
                now: new Date().toISOString(),
              }),
              tools: TOOL_DECLARATIONS,
              model: internal.model ?? undefined,
              persist: (line) => void persist(internal, line),
              emit: (event) => emit(internal, event),
            },
            controller.signal,
          );
        } finally {
          internal.running = false;
        }
      },
      async abort() {
        controller.abort();
        internal.gate.cancelAll("已停止");
      },
      setModel(next) {
        internal.model = next;
      },
      setMode(next) {
        if (internal.mode === next) return;
        internal.mode = next;
        void persist(internal, { type: "mode", mode: next });
      },
      respond(requestId, outcome) {
        const resolve = internal.pendingApprovals.get(requestId);
        if (!resolve) return;
        internal.pendingApprovals.delete(requestId);
        resolve(outcome);
      },
    };
    sessions.set(header.id, { internal, session });
    return { internal, session };
  }

  async function compactIfNeeded(session: InternalSession): Promise<void> {
    const view = effectiveMessages(session.lines);
    const lastAssistant = [...view].reverse().find((message): message is Extract<AgentMessage, { role: "assistant" }> =>
      message.role === "assistant",
    );
    if (!lastAssistant?.usage || lastAssistant.usage.promptTokens <= threshold) return;

    const covered = Math.max(1, Math.floor(view.length / 2));
    const request = {
      messages: [
        {
          role: "system",
          content: "总结前半段 agent 对话。保留用户目标、结论、写改过的文件路径、未完成待办；用简体中文输出简洁摘要。",
        },
        ...toChatMessages(view.slice(0, covered)),
      ],
    };
    const summary = (await deps.llm.chat(request)).content;
    await persist(session, {
      type: "compaction",
      summary,
      covered,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    async listSessions() {
      const root = requireRoot();
      let entries;
      try {
        entries = await deps.files.readTree(`${root}/.study-wiki/sessions`);
      } catch {
        return [];
      }
      const metas: SessionMeta[] = [];
      for (const entry of entries) {
        try {
          const header = readHeader(await deps.files.readText(entry.path));
          if (header) metas.push({ id: header.id, title: header.title, createdAt: header.createdAt });
        } catch {
          // Bad or unreadable session files are skipped so one record cannot break listing.
        }
      }
      return metas;
    },

    async openSession(id) {
      const root = requireRoot();
      if (id !== null) {
        const existing = sessions.get(id);
        if (existing) return existing.session;
        const path = sessionPath(id, root);
        const parsed = parseSession(await deps.files.readText(path));
        if (parsed.tailTruncated) {
          await deps.files.writeText(
            path,
            `${parsed.lines.map((line) => encodeLine(line)).join("\n")}\n`,
          );
        }
        return createSession(
          parsed.header,
          root,
          parsed.lines.filter((line) => line.type !== "header"),
          path,
          parsed.header.rootPath === root ? null : parsed.header.rootPath,
          false,
          lastPersistedMode(parsed.lines),
        ).session;
      }

      const sessionId = crypto.randomUUID();
      const header: SessionHeader = {
        v: 1,
        id: sessionId,
        rootPath: root,
        title: DEFAULT_TITLE,
        createdAt: new Date().toISOString(),
      };
      const path = sessionPath(sessionId, root);
      const created = createSession(header, root, [], path, null, true);
      await enqueue(created.internal, () =>
        deps.files.appendSessionEvent(path, encodeLine({ type: "header", header })),
      );
      return created.session;
    },

    async deleteSession(id) {
      const entry = sessions.get(id);
      if (entry && (entry.internal.running || entry.internal.persisting)) {
        throw new Error("会话进行中，先停止再删除");
      }
      sessions.delete(id);
      await entry?.session.abort();
      await deps.files.deleteSessionFile(sessionPath(id));
    },

    dispose() {
      disposed = true;
      for (const entry of sessions.values()) void entry.session.abort();
      sessions.clear();
    },
  };
}

function lastPersistedMode(lines: SessionLine[]): ApprovalMode {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line?.type === "mode") return line.mode;
  }
  return "ask";
}

async function readAgentsMd(root: string, files: FilesService): Promise<string | null> {
  try {
    return await files.readText(`${root}/AGENTS.md`);
  } catch {
    return null;
  }
}

function firstText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content.find((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text")?.text ?? "";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
