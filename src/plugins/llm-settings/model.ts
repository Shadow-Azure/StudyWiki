/** Endpoint 表单草稿（面板编辑态；apiKey 为明文，仅内存持有，保存即交 Rust）。 */
export interface EndpointDraft {
  id: string;
  name: string;
  kind: "chat" | "asr";
  baseUrl: string;
  apiKey: string;
  /** ASR 接线协议：缺省 = transcriptions；仅 kind=asr 可携带。 */
  protocol?: "transcriptions" | "chat";
  models: { id: string; capabilities: string[] }[];
}

/** 预设最小形状（与 ctx.llm.listPresets 的 LlmPreset 对齐；模型条目够用即可）。 */
export interface PresetLike {
  vendor: string;
  name: string;
  baseUrl: string;
  /** 预设类别：chat / asr；缺省按 chat 处理（兼容旧形状）。 */
  kind?: string;
  /** ASR 模板协议：chat = 聊天口；缺省 = transcriptions。 */
  protocol?: string | null;
  models: { id: string; capabilities: string[] }[];
}

/** 自定义 vendor key：下拉里的"自定义 OpenAI 兼容"（Rust 预设表不含此项）。 */
export const CUSTOM_VENDOR = "custom";

/** 预设 → 可编辑草稿：id/name/vendor 派生，key 留空，模型深拷贝防改坏预设表。
 * @param p ctx.llm.listPresets 返回的一条预设。
 * @returns 可直接进表单编辑的草稿。 */
export function instantiatePreset(p: PresetLike): EndpointDraft {
  return {
    id: p.vendor,
    name: p.name,
    kind: p.kind === "asr" ? "asr" : "chat",
    baseUrl: p.baseUrl,
    apiKey: "",
    ...(p.kind === "asr" && p.protocol === "chat" ? { protocol: "chat" as const } : {}),
    models: p.models.map((m) => ({ id: m.id, capabilities: [...m.capabilities] })),
  };
}

/** 空白自定义草稿（用户从零填）。
 * @returns 全空的 chat 草稿。 */
export function blankDraft(): EndpointDraft {
  return { id: "", name: "", kind: "chat", baseUrl: "", apiKey: "", models: [] };
}

/** 草稿校验：与 Rust validate_endpoint 同规则；错误消息点名字段（中文内联展示）。
 * @param d 表单当前草稿。
 * @returns null = 合法；否则返回错误消息。空 apiKey 合法（自托管/后填）。 */
export function validateDraft(d: EndpointDraft): string | null {
  if (!d.id.trim()) return "id 不能为空";
  if (!d.name.trim()) return "name 不能为空";
  if (!(d.baseUrl.startsWith("http://") || d.baseUrl.startsWith("https://"))) {
    return "baseUrl 必须以 http:// 或 https:// 开头";
  }
  if (d.protocol !== undefined && d.protocol !== "transcriptions" && d.protocol !== "chat") {
    return "protocol 只允许 transcriptions 或 chat";
  }
  if (d.kind === "chat" && d.protocol !== undefined) {
    return "protocol 只允许出现在 kind=asr 的 endpoint 上";
  }
  if (d.models.length === 0) return "至少要有一个模型";
  const seen = new Set<string>();
  for (const m of d.models) {
    if (!m.id.trim()) return "模型 id 不能为空";
    if (seen.has(m.id)) return `模型 id 重复：${m.id}`;
    seen.add(m.id);
  }
  return null;
}
