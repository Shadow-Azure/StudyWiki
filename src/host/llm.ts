import { Channel, invoke } from "@tauri-apps/api/core";
import { ChunkQueue, StreamAssembler, type ChatStreamHandle, type StreamChunk } from "./llm-stream";

/** Tauri channel factory for streaming callbacks; injectable with the invoke seam. */
export type LlmChannel = { onmessage: ((chunk: StreamChunk) => void) | null };

/** Tauri bindings this service wraps; injectable so tests fake exactly one seam.
 * createChannel 可选：缺省回落 defaultLlmDeps 的真实 Tauri Channel（构造时统一合并，
 * 部分注入时 console.warn 提醒）——测试注入假依赖时请一并提供假工厂。 */
export interface LlmDeps {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  createChannel?: () => LlmChannel;
}

/** Real Tauri binding (the only sanctioned import site). */
export const defaultLlmDeps: LlmDeps = {
  invoke,
  createChannel: () => new Channel<StreamChunk>(),
};

/** 归一错误（与 Rust LlmError 同一词表：传输码 + 本层 MODEL_* 路由码）。 */
export class LlmError extends Error {
  /** Stable code, e.g. UNAUTHORIZED / MODEL_AMBIGUOUS. */
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LlmError";
  }
}

/** One model entry inside an endpoint (capabilities: text / vision / audio). */
export interface ModelEntry {
  /** Model id sent as the OpenAI-compatible `model` field. */
  id: string;
  /** Declared capabilities, e.g. ["text", "vision", "audio"]. */
  capabilities: string[];
}

/** Build-time vendor preset served by Rust (`llm_list_presets`). */
export interface LlmPreset {
  /** Stable vendor key, e.g. "deepseek"; "custom" never comes from Rust. */
  vendor: string;
  /** Display name for the vendor dropdown. */
  name: string;
  /** OpenAI-compatible base URL. */
  baseUrl: string;
  /** Editable template model list. */
  models: ModelEntry[];
}

/** Redacted endpoint projection — no full key ever crosses IPC. */
export interface RedactedEndpoint {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  /** Owning vendor: preset matched by baseUrl, else "custom". */
  vendor: string;
  hasKey: boolean;
  keyPreview: string;
  models: ModelEntry[];
}

/** Redacted settings root served by `llm_list_endpoints`. */
export interface RedactedSettings {
  endpoints: RedactedEndpoint[];
  defaultModel: string | null;
  /** Durable default for newly created agent sessions; existing sessions keep their own mode. */
  agentApprovalMode?: "ask" | "auto" | null;
}

/** Endpoint payload accepted by `llm_upsert_endpoint` (camelCase wire form). */
export interface EndpointInput {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  apiKey: string;
  /** 编辑态 dirty：true = apiKey 为显式值（空串 = 显式清空）；缺省 = 空 apiKey 表示保留已存 key。 */
  apiKeyDirty?: boolean;
  models: ModelEntry[];
}

/** Message content part wire shape shared with Rust. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image" | "audio"; source: MediaSource };

/** Media source accepted by Rust (path is read there; inline is base64; url is provider-fetched). */
export type MediaSource =
  | { kind: "path"; path: string }
  | { kind: "inline"; data: string; mimeType: string }
  | { kind: "url"; url: string };

/** Upstream tool declaration passed through to the selected chat model. */
export interface ToolDeclaration {
  /** Provider-visible stable tool name supplied to tool-call responses. */
  name: string;
  /** Natural-language contract used by the model when choosing the tool. */
  description: string;
  /** JSON Schema object describing the tool arguments. */
  parameters: Record<string, unknown>;
}

/** Chat message wire shape, including the assistant tool-call and tool-result forms. */
export interface ChatMessage {
  /** Provider role: user / assistant / tool / system. */
  role: string;
  /** Plain text or multimodal content parts. */
  content: string | ContentPart[];
  /** Assistant requests emitted by a prior model response, in order. */
  toolCalls?: { id: string; name: string; arguments: string }[];
  /** Identifies the assistant tool call satisfied by a tool-role message. */
  toolCallId?: string;
}

/** Chat input: `model` is the routing key resolved by this service. */
export interface ChatInput {
  /** Model id; falls back to the configured default model when omitted. */
  model?: string;
  /** Text, multimodal, assistant tool-call, or tool-result messages. */
  messages: ChatMessage[];
  /** Optional upstream tool declarations; requires endpoint capability `tools`. */
  tools?: ToolDeclaration[];
  /** Optional upstream max output tokens. */
  maxTokens?: number;
  /** Optional sampling temperature. */
  temperature?: number;
}

/** Non-streaming chat result (first choice only). */
export interface ChatResult {
  content: string;
  finishReason: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/** 模型路由 + 推理 facade：插件唯一合法的 LLM 通道。
 * 路由错误码（本层抛出）：MODEL_UNKNOWN / MODEL_AMBIGUOUS / MODEL_UNSPECIFIED；
 * 传输错误码原样透传 Rust LlmError。key 永不经本层（list 只见脱敏投影）。 */
export class LlmService {
  readonly #deps: LlmDeps;

  constructor(deps: LlmDeps = defaultLlmDeps) {
    if (deps !== defaultLlmDeps && !deps.createChannel) {
      console.warn(
        "[llm] deps 未提供 createChannel，回落真实 Tauri Channel——测试环境请在 deps 注入假工厂",
      );
    }
    this.#deps = { ...defaultLlmDeps, ...deps };
  }

  /** Single IPC seam; rejections normalize into LlmError(code). */
  async #call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return (await this.#deps.invoke(cmd, args)) as T;
    } catch (e) {
      const shape = e as { code?: unknown; message?: unknown };
      if (shape && typeof shape.code === "string") {
        throw new LlmError(shape.code, typeof shape.message === "string" ? shape.message : shape.code);
      }
      throw new LlmError("BAD_RESPONSE", e instanceof Error ? e.message : String(e));
    }
  }

  /** 厂商预设表（baseUrl 只在 Rust 侧定义）。 */
  listPresets(): Promise<LlmPreset[]> {
    return this.#call<LlmPreset[]>("llm_list_presets");
  }

  /** 脱敏 endpoint 列表 + 默认模型。 */
  listEndpoints(): Promise<RedactedSettings> {
    return this.#call<RedactedSettings>("llm_list_endpoints");
  }

  /** 新增或按 id 覆盖 endpoint（仅内置插件面；校验失败 INVALID_CONFIG）。 */
  upsertEndpoint(endpoint: EndpointInput): Promise<void> {
    return this.#call<void>("llm_upsert_endpoint", { endpoint });
  }

  /** 按 id 删除 endpoint（缺席 ENDPOINT_UNKNOWN）。 */
  removeEndpoint(id: string): Promise<void> {
    return this.#call<void>("llm_remove_endpoint", { id });
  }

  /** 设置/清除默认模型（写面：仅内置插件经宿主 facade 可达；未知模型 INVALID_CONFIG）。 */
  setDefaultModel(model: string | null): Promise<void> {
    return this.#call<void>("llm_set_default_model", { model });
  }

  /** 设置新建 agent 会话的 durable 审批模式；当前会话不跟随改写。 */
  setDefaultAgentApprovalMode(mode: "ask" | "auto"): Promise<void> {
    return this.#call<void>("agent_set_default_approval_mode", { mode });
  }

  /** 揭示 endpoint 的完整 apiKey 明文（编辑态眼睛按钮按需取用；
   * 仅内置插件面——guard 外置白名单不含本方法）。 */
  revealKey(id: string): Promise<string> {
    return this.#call<string>("llm_reveal_key", { id });
  }

  /** 探测 endpoint（GET /models），成功返回延迟 ms。 */
  probe(id: string): Promise<number> {
    return this.#call<number>("llm_probe", { id });
  }

  /** 解析模型归属 endpoint：只路由 chat 类 endpoint，asr 配置不得误入推理命令。
   * @throws LlmError MODEL_UNSPECIFIED（无 model 且无默认）/ MODEL_UNKNOWN（无归属）/ MODEL_AMBIGUOUS（多归属）。 */
  async #route(model?: string): Promise<{ endpointId: string; model: string; entry: ModelEntry }> {
    const settings = await this.listEndpoints();
    const resolved = model ?? settings.defaultModel;
    if (!resolved) {
      throw new LlmError("MODEL_UNSPECIFIED", "未指定 model 且未配置默认模型");
    }
    const owners = settings.endpoints.filter(
      (e) => e.kind === "chat" && e.models.some((m) => m.id === resolved),
    );
    if (owners.length === 0) {
      throw new LlmError("MODEL_UNKNOWN", `未找到模型：${resolved}`);
    }
    if (owners.length > 1) {
      throw new LlmError("MODEL_AMBIGUOUS", `模型 ${resolved} 同时属于 ${owners.map((e) => e.id).join(", ")}`);
    }
    const entry = owners[0].models.find((m) => m.id === resolved)!;
    return { endpointId: owners[0].id, model: resolved, entry };
  }

  /** 非流式 chat：按 model 解析归属 endpoint，tools 能力门禁在本层后交 Rust 传输。
   * @throws LlmError MODEL_UNSPECIFIED（无 model 且无默认）/ MODEL_UNKNOWN（无归属）/ MODEL_AMBIGUOUS（多归属）/
   *   tools 不满足 UNSUPPORTED_CONTENT，其余传输码原样透传。 */
  async chat(req: ChatInput): Promise<ChatResult> {
    const { endpointId, model, entry } = await this.#route(req.model);
    if (req.tools?.length && !entry.capabilities.includes("tools")) {
      throw new LlmError("UNSUPPORTED_CONTENT", "当前模型不支持工具调用");
    }
    return this.#call<ChatResult>("llm_chat", {
      req: {
        endpointId,
        model,
        messages: req.messages,
        ...(req.tools?.length ? { tools: req.tools } : {}),
        ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      },
    });
  }

  /** 流式 chat：模型路由与 tools/媒体能力门禁在本层，chunk 经 Tauri Channel 逐个交付。
   * settled 在正常终结 resolve；传输失败或 error chunk 终结时以 LlmError 拒绝。
   * @throws LlmError 路由 MODEL_*、tools 或媒体不满足 UNSUPPORTED_CONTENT，其余传输码原样透传。 */
  async chatStream(req: ChatInput): Promise<ChatStreamHandle> {
    const { endpointId, model, entry } = await this.#route(req.model);
    if (req.tools?.length && !entry.capabilities.includes("tools")) {
      throw new LlmError("UNSUPPORTED_CONTENT", "当前模型不支持工具调用");
    }
    const needsVision = req.messages.some(
      (message) => Array.isArray(message.content) &&
        message.content.some((part) => part.type === "image"),
    );
    const needsAudio = req.messages.some(
      (message) => Array.isArray(message.content) &&
        message.content.some((part) => part.type === "audio"),
    );
    if ((needsVision && !entry.capabilities.includes("vision")) ||
      (needsAudio && !entry.capabilities.includes("audio"))) {
      throw new LlmError("UNSUPPORTED_CONTENT", "当前模型不支持请求中的媒体内容");
    }

    const streamId = crypto.randomUUID();
    const channel = this.#deps.createChannel!();
    const queue = new ChunkQueue();
    const assembler = new StreamAssembler();
    let seenError: Extract<StreamChunk, { type: "error" }> | null = null;
    channel.onmessage = (chunk) => {
      assembler.push(chunk);
      if (chunk.type === "error") seenError = chunk;
      queue.push(chunk);
    };

    const transport = this.#call<void>("llm_chat_stream", {
      req: {
        endpointId,
        model,
        messages: req.messages,
        streamId,
        ...(req.tools?.length ? { tools: req.tools } : {}),
        ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      },
      onChunk: channel,
    });
    const settle = async (): Promise<void> => {
      try {
        await transport;
      } catch (error) {
        const normalized = error instanceof LlmError
          ? error
          : new LlmError("BAD_RESPONSE", String(error));
        queue.fail(normalized);
        throw normalized;
      }
      if (seenError) {
        const failure = new LlmError(seenError.code, seenError.message);
        queue.fail(failure);
        throw failure;
      }
      queue.close();
    };
    return {
      events: queue,
      snapshot: () => assembler.snapshot(),
      settled: settle(),
      abort: () => this.#call<void>("llm_chat_abort", { id: streamId }),
    };
  }
}
