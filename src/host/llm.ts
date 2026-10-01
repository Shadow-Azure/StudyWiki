import { invoke } from "@tauri-apps/api/core";

/** Tauri binding this service wraps; injectable so tests fake exactly one seam. */
export interface LlmDeps {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

/** Real Tauri binding (the only sanctioned import site). */
export const defaultLlmDeps: LlmDeps = { invoke };

/** 归一错误（与 Rust LlmError 同一词表：传输码 + 本层 MODEL_* 路由码）。 */
export class LlmError extends Error {
  /** Stable code, e.g. UNAUTHORIZED / MODEL_AMBIGUOUS. */
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LlmError";
  }
}

/** One model entry inside an endpoint (capabilities: text / vision). */
export interface ModelEntry {
  /** Model id sent as the OpenAI-compatible `model` field. */
  id: string;
  /** Declared capabilities, e.g. ["text", "vision"]. */
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

/** Chat input: `model` is the routing key resolved by this service. */
export interface ChatInput {
  /** Model id; falls back to the configured default model when omitted. */
  model?: string;
  /** Plain-text messages (multimodal segments arrive with m2-02 streaming). */
  messages: { role: string; content: string }[];
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
    this.#deps = deps;
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

  /** 揭示 endpoint 的完整 apiKey 明文（编辑态眼睛按钮按需取用；
   * 仅内置插件面——guard 外置白名单不含本方法）。 */
  revealKey(id: string): Promise<string> {
    return this.#call<string>("llm_reveal_key", { id });
  }

  /** 探测 endpoint（GET /models），成功返回延迟 ms。 */
  probe(id: string): Promise<number> {
    return this.#call<number>("llm_probe", { id });
  }

  /** 非流式 chat：按 model 解析归属 endpoint 后交 Rust 传输。
   * @throws LlmError MODEL_UNSPECIFIED（无 model 且无默认）/ MODEL_UNKNOWN（无归属）/ MODEL_AMBIGUOUS（多归属）。 */
  async chat(req: ChatInput): Promise<ChatResult> {
    const settings = await this.listEndpoints();
    const model = req.model ?? settings.defaultModel;
    if (!model) {
      throw new LlmError("MODEL_UNSPECIFIED", "未指定 model 且未配置默认模型");
    }
    // 只路由 chat 类 endpoint：asr 配置本期无消费方，模型不得误入 chat/completions。
    const owners = settings.endpoints.filter(
      (e) => e.kind === "chat" && e.models.some((m) => m.id === model),
    );
    if (owners.length === 0) {
      throw new LlmError("MODEL_UNKNOWN", `未找到模型：${model}`);
    }
    if (owners.length > 1) {
      throw new LlmError("MODEL_AMBIGUOUS", `模型 ${model} 同时属于 ${owners.map((e) => e.id).join(", ")}`);
    }
    return this.#call<ChatResult>("llm_chat", {
      req: {
        endpointId: owners[0].id,
        model,
        messages: req.messages,
        ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      },
    });
  }
}
