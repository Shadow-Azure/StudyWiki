//! LLM 推理薄能力层：厂商预设、endpoint CRUD、探测与流式/非流式 chat 出口。

use crate::config::{self, Endpoint, ModelEntry, Settings};
use crate::llm_stream::{parse_sse_lines, StreamChunk};
use base64::Engine as _;
use serde::Serialize;
use std::io::BufReader;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::AppHandle;

/// 探测超时：OpenAI 兼容 /models 是轻调用，10s 足够。
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
/// chat 超时：大模型生成可达数分钟，给满 300s。
const CHAT_TIMEOUT: Duration = Duration::from_secs(300);
/// 流式 chat 超时：长回答持续出字，给 600s。
const STREAM_TIMEOUT: Duration = Duration::from_secs(600);
/// 单个附件解码字节上限：硬上限 + 明确报错，不做压缩/归一化——pi/dsh 式压缩是 provider
/// 5 MB 级硬上限的产物；OpenAI 兼容图片 base64 上限 20 MB，音频同限，超限提示压缩或分段。
const MAX_ATTACHMENT_BYTES: u64 = 20 * 1024 * 1024;
/// 单请求附件聚合解码字节上限：与响应侧 DEFAULT_STREAM_EVENT_LIMIT_BYTES（100 MiB）对称。
const MAX_REQUEST_ATTACHMENT_BYTES: u64 = 100 * 1024 * 1024;

/// 归一错误：code 为全链路共享词表（前端路由层另有 MODEL_* 三码；
/// INTERNAL 仅由 async 命令的后台任务 JoinError 产生，正常路径不可达）。
#[derive(Debug, Serialize)]
pub struct LlmError {
    pub code: String,
    pub message: String,
}

impl LlmError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

/// 消息内容：纯文本或多模态 part 数组。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Parts(Vec<ContentPart>),
}

/// 多模态 part：文本，或 image/audio 媒体（source 三源联合）。
/// 媒体类别就是 wire tag 本身（image/audio），不用可伪造的自由字符串 kind。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ContentPart {
    Text {
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    Image {
        source: MediaSource,
    },
    #[serde(rename_all = "camelCase")]
    Audio {
        source: MediaSource,
    },
}

/// 媒体来源：path = 本地文件（Rust 出口读盘）；inline = 剪贴板/拖拽 base64；url = 透传。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MediaSource {
    Path {
        path: String,
    },
    #[serde(rename_all = "camelCase")]
    Inline {
        data: String,
        mime_type: String,
    },
    Url {
        url: String,
    },
}

/// OpenAI function tool 声明：name/description/parameters 原样透传给上游。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDecl {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

/// 前端侧工具调用：arguments 保留 JSON 字符串，出线时包成 OpenAI function call。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

/// 一条对话消息：content 是纯文本或多模态 part 数组；工具协议字段按需携带。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: MessageContent,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

/// chat 请求：前端已路由好归属 endpoint（endpointId），Rust 只做传输。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub endpoint_id: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<ToolDecl>>,
}

/// chat 响应：拼好首个 choice 的纯文本 + 结束原因 + 可选用量（camelCase 对齐 TS ChatResult）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub content: String,
    pub finish_reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
}

/// token 用量（上游缺席时为 None；出线 camelCase，入线吃上游 snake_case）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    #[serde(default, alias = "prompt_tokens")]
    pub prompt_tokens: u64,
    #[serde(default, alias = "completion_tokens")]
    pub completion_tokens: u64,
}

/// 流式请求：ChatRequest + streamId（中止寻址）。
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamRequest {
    #[serde(flatten)]
    pub base: ChatRequest,
    pub stream_id: String,
}

/// 中止登记表：streamId 置位即停读（进程级单例）。
pub type AbortRegistry = Arc<Mutex<std::collections::HashSet<String>>>;

/// 进程级流式中止登记表唯一入口。
pub fn abort_registry() -> &'static AbortRegistry {
    static R: OnceLock<AbortRegistry> = OnceLock::new();
    R.get_or_init(|| Arc::new(Mutex::new(std::collections::HashSet::new())))
}

/// 流式 chat 专用 Agent：读循环可长时持续出字。
fn stream_agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(STREAM_TIMEOUT).build()
}

/// wire tag 已判别的媒体类别；分类不走自由字符串。
#[derive(Debug, Clone, Copy)]
enum MediaKind {
    Image,
    Audio,
}

/// 按扩展名出 mime：image → png/jpg/jpeg/webp/gif；audio → mp3/wav。
fn mime_of_path(path: &str, kind: MediaKind) -> Result<String, LlmError> {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    let mime = match (kind, ext.as_str()) {
        (MediaKind::Image, "png") => "image/png",
        (MediaKind::Image, "jpg" | "jpeg") => "image/jpeg",
        (MediaKind::Image, "webp") => "image/webp",
        (MediaKind::Image, "gif") => "image/gif",
        (MediaKind::Audio, "mp3") => "audio/mpeg",
        (MediaKind::Audio, "wav") => "audio/wav",
        _ => {
            return Err(LlmError::new(
                "UNSUPPORTED_CONTENT",
                format!("不支持的附件类型：{path}"),
            ))
        }
    };
    Ok(mime.to_string())
}

/// input_audio 的 format 字段只认 wav/mp3。
fn audio_format(mime: &str) -> Result<&'static str, LlmError> {
    match mime {
        "audio/wav" | "audio/x-wav" => Ok("wav"),
        "audio/mpeg" | "audio/mp3" => Ok("mp3"),
        _ => Err(LlmError::new(
            "UNSUPPORTED_CONTENT",
            format!("音频格式不受支持：{mime}（仅 wav/mp3）"),
        )),
    }
}

/// 媒体 source 归一：path canonicalize 一次后授权并读取为 inline；url 只做协议门禁。
fn resolve_media_source(
    source: &MediaSource,
    kind: MediaKind,
    root_check: &dyn Fn(&str) -> bool,
) -> Result<MediaSource, LlmError> {
    match source {
        MediaSource::Inline { mime_type, .. } => {
            if matches!(kind, MediaKind::Audio) {
                audio_format(mime_type)?;
            }
            Ok(source.clone())
        }
        MediaSource::Path { path } => {
            let original = path;
            let canonical = std::fs::canonicalize(path).map_err(|_| {
                LlmError::new(
                    "UNSUPPORTED_CONTENT",
                    format!("附件路径不在工作区内：{original}"),
                )
            })?;
            let canonical = canonical.to_string_lossy().to_string();
            if !root_check(&canonical) {
                return Err(LlmError::new(
                    "UNSUPPORTED_CONTENT",
                    format!("附件路径不在工作区内：{original}"),
                ));
            }
            let bytes = std::fs::read(&canonical)
                .map_err(|e| LlmError::new("UNSUPPORTED_CONTENT", format!("附件读取失败：{e}")))?;
            let mime = mime_of_path(&canonical, kind)?;
            Ok(MediaSource::Inline {
                data: base64::engine::general_purpose::STANDARD.encode(&bytes),
                mime_type: mime,
            })
        }
        MediaSource::Url { .. } => {
            if matches!(kind, MediaKind::Audio) {
                return Err(LlmError::new("UNSUPPORTED_CONTENT", "音频不支持 url 来源"));
            }
            Ok(source.clone())
        }
    }
}

/// 上游 content part：inline/path 已归一为 OpenAI image_url 或 input_audio。
fn upstream_content_part(part: &ContentPart) -> serde_json::Value {
    let media = |source: &MediaSource| match source {
        MediaSource::Inline { data, mime_type } => Some(format!("data:{mime_type};base64,{data}")),
        MediaSource::Url { url } => Some(url.clone()),
        MediaSource::Path { .. } => None,
    };
    match part {
        ContentPart::Text { text } => serde_json::json!({"type": "text", "text": text}),
        ContentPart::Image { source } => {
            let url = media(source).unwrap_or_else(|| {
                unreachable!("path 附件必须先经 upstream_request 归一为 inline")
            });
            serde_json::json!({
                "type": "image_url",
                "image_url": {"url": url}
            })
        }
        ContentPart::Audio { source } => match source {
            MediaSource::Inline { data, mime_type } => serde_json::json!({
                "type": "input_audio",
                "input_audio": {
                    "data": data,
                    "format": audio_format(mime_type).unwrap_or_else(|_| {
                        unreachable!("音频 mime 已在附件归一时校验")
                    })
                }
            }),
            _ => unreachable!("audio 只接受归一 inline；url/path 已在附件归一时门禁"),
        },
    }
}

/// 单条消息 → OpenAI wire；assistant tool_calls 的 content 固定为空字符串。
fn upstream_message(message: &ChatMessage) -> serde_json::Value {
    let content = match &message.content {
        MessageContent::Text(text) => serde_json::json!(text),
        MessageContent::Parts(parts) => {
            serde_json::json!(parts.iter().map(upstream_content_part).collect::<Vec<_>>())
        }
    };
    let mut wire = serde_json::json!({"role": message.role, "content": content});
    if message.role == "assistant" {
        if let Some(tool_calls) = &message.tool_calls {
            wire["content"] = serde_json::json!("");
            wire["tool_calls"] = serde_json::json!(tool_calls
                .iter()
                .map(|call| {
                    serde_json::json!({
                        "id": call.id,
                        "type": "function",
                        "function": {"name": call.name, "arguments": call.arguments}
                    })
                })
                .collect::<Vec<_>>());
        }
    }
    if let Some(tool_call_id) = &message.tool_call_id {
        wire["tool_call_id"] = serde_json::json!(tool_call_id);
    }
    wire
}

/// 上游请求体唯一组装点：OpenAI tools 声明、工具消息、stream 与采样参数在此成形。
/// 入参 messages 必须先经 `upstream_request`；path 附件已归一 inline。
pub fn upstream_body(req: &ChatRequest, stream: bool) -> serde_json::Value {
    let messages = req
        .messages
        .iter()
        .map(upstream_message)
        .collect::<Vec<_>>();
    let mut body = serde_json::json!({
        "model": req.model,
        "messages": messages,
        "stream": stream,
    });
    if stream {
        body["stream_options"] = serde_json::json!({"include_usage": true});
    }
    if let Some(max) = req.max_tokens {
        body["max_tokens"] = serde_json::json!(max);
    }
    if let Some(temperature) = req.temperature {
        body["temperature"] = serde_json::json!(temperature);
    }
    if let Some(tools) = &req.tools {
        body["tools"] = serde_json::json!(tools
            .iter()
            .map(|tool| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.parameters
                    }
                })
            })
            .collect::<Vec<_>>());
    }
    body
}

/// 请求侧媒体归一：保证 upstream_body 是不落盘、不执行授权的纯组装函数。
fn upstream_request(
    req: &ChatRequest,
    root_check: &dyn Fn(&str) -> bool,
) -> Result<ChatRequest, LlmError> {
    let mut messages = Vec::with_capacity(req.messages.len());
    for message in &req.messages {
        let content = match &message.content {
            MessageContent::Text(text) => MessageContent::Text(text.clone()),
            MessageContent::Parts(parts) => {
                let mut normalized = Vec::with_capacity(parts.len());
                for part in parts {
                    normalized.push(match part {
                        ContentPart::Text { text } => ContentPart::Text { text: text.clone() },
                        ContentPart::Image { source } => ContentPart::Image {
                            source: resolve_media_source(source, MediaKind::Image, root_check)?,
                        },
                        ContentPart::Audio { source } => ContentPart::Audio {
                            source: resolve_media_source(source, MediaKind::Audio, root_check)?,
                        },
                    });
                }
                MessageContent::Parts(normalized)
            }
        };
        messages.push(ChatMessage {
            role: message.role.clone(),
            content,
            tool_calls: message.tool_calls.clone(),
            tool_call_id: message.tool_call_id.clone(),
        });
    }
    Ok(ChatRequest {
        endpoint_id: req.endpoint_id.clone(),
        model: req.model.clone(),
        messages,
        max_tokens: req.max_tokens,
        temperature: req.temperature,
        tools: req.tools.clone(),
    })
}

/// 请求体构建（非流式/流式共用）：先归一媒体，再交给唯一组装点。
fn build_chat_body(
    req: &ChatRequest,
    stream: bool,
    root_check: &dyn Fn(&str) -> bool,
) -> Result<serde_json::Value, LlmError> {
    let prepared = upstream_request(req, root_check)?;
    Ok(upstream_body(&prepared, stream))
}

/// OpenAI 兼容 chat/completions 回包的只取所需子集。
#[derive(Debug, serde::Deserialize)]
struct WireChat {
    choices: Vec<WireChoice>,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Debug, serde::Deserialize)]
struct WireChoice {
    message: WireMessage,
    #[serde(rename = "finish_reason", default)]
    finish_reason: String,
}

#[derive(Debug, serde::Deserialize)]
struct WireMessage {
    content: serde_json::Value,
}

/// 构建期厂商预设（模板：用户实例化后可改模型清单；baseUrl 只存在于本文件）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmPreset {
    pub vendor: String,
    pub name: String,
    pub base_url: String,
    pub models: Vec<ModelEntry>,
}

/// 预设表：GLM/DeepSeek/Kimi/MiniMax 的 OpenAI 兼容端点（模型名是可编辑模板）。
fn presets() -> Vec<LlmPreset> {
    let m = |id: &str, caps: &[&str]| ModelEntry {
        id: id.into(),
        capabilities: caps.iter().map(|s| s.to_string()).collect(),
    };
    vec![
        LlmPreset {
            vendor: "zhipu".into(),
            name: "智谱 GLM".into(),
            base_url: "https://open.bigmodel.cn/api/paas/v4".into(),
            models: vec![
                m("glm-5.3", &["text", "vision"]),
                m("glm-5.3-flash", &["text"]),
            ],
        },
        LlmPreset {
            vendor: "deepseek".into(),
            name: "DeepSeek".into(),
            base_url: "https://api.deepseek.com/v1".into(),
            models: vec![
                m("deepseek-v4-pro", &["text"]),
                m("deepseek-v4-flash", &["text"]),
            ],
        },
        LlmPreset {
            vendor: "moonshot".into(),
            name: "Kimi（月之暗面）".into(),
            base_url: "https://api.moonshot.cn/v1".into(),
            models: vec![m("kimi-k3", &["text"])],
        },
        LlmPreset {
            vendor: "minimax".into(),
            name: "MiniMax".into(),
            base_url: "https://api.minimaxi.com/v1".into(),
            models: vec![m("minimax-m3", &["text"])],
        },
    ]
}

/// URL 拼接：容忍 baseUrl 尾斜杠（/v1/ 与 /v1 等价）。
fn join_url(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path)
}

/// 空 apiKey（自托管）不带 Authorization；有 key 才加 Bearer。
fn with_auth(req: ureq::Request, ep: &Endpoint) -> ureq::Request {
    if ep.api_key.is_empty() {
        req
    } else {
        req.set("Authorization", &format!("Bearer {}", ep.api_key))
    }
}

/// 传输错误 → 归一码：401/403 → UNAUTHORIZED；429 → RATE_LIMITED；其它 HTTP → BAD_RESPONSE；
/// 超时 → TIMEOUT；其余网络错 → UNREACHABLE。
fn map_transport(e: ureq::Error) -> LlmError {
    match e {
        ureq::Error::Status(status, _) => {
            let code = match status {
                401 | 403 => "UNAUTHORIZED",
                429 => "RATE_LIMITED",
                _ => "BAD_RESPONSE",
            };
            LlmError::new(code, format!("HTTP {status}"))
        }
        ureq::Error::Transport(t) => {
            let msg = t.to_string();
            // ureq 2 无独立 Timeout 变体：整体超时落为 Io 类，按消息文本判别。
            if matches!(t.kind(), ureq::ErrorKind::Io) && msg.to_lowercase().contains("timed out") {
                LlmError::new("TIMEOUT", msg)
            } else {
                LlmError::new("UNREACHABLE", msg)
            }
        }
    }
}

/// 联网共用 Agent（探测用短超时）。
fn probe_agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(PROBE_TIMEOUT).build()
}

/// 联网共用 Agent（chat 用长超时）。
fn chat_agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(CHAT_TIMEOUT).build()
}

/// 探测：OpenAI 兼容 GET /models，成功返回耗时 ms。
fn probe_with(agent: &ureq::Agent, ep: &Endpoint) -> Result<u64, LlmError> {
    let url = join_url(&ep.base_url, "models");
    let start = Instant::now();
    with_auth(agent.get(&url), ep)
        .call()
        .map_err(map_transport)?;
    Ok(start.elapsed().as_millis() as u64)
}

/// base64 数据的解码字节估算（向下取整，仅用于大小门禁）。
fn decoded_base64_len(data: &str) -> u64 {
    data.len() as u64 * 3 / 4
}

/// 附件大小硬上限：单件与聚合（inline 按解码估算 / path 读 metadata），超限
/// UNSUPPORTED_CONTENT 明确报错；url 来源不计（由 provider 端拉取，客户端不下载）。
fn ensure_attachment_size(
    req: &ChatRequest,
    max_per_item: u64,
    max_total: u64,
) -> Result<(), LlmError> {
    let mut total: u64 = 0;
    for message in &req.messages {
        let MessageContent::Parts(parts) = &message.content else {
            continue;
        };
        for part in parts {
            let size = match part {
                ContentPart::Text { .. } => continue,
                ContentPart::Image { source } | ContentPart::Audio { source } => match source {
                    MediaSource::Inline { data, .. } => decoded_base64_len(data),
                    MediaSource::Path { path } => {
                        std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0)
                    }
                    MediaSource::Url { .. } => 0,
                },
            };
            if size > max_per_item {
                return Err(LlmError::new(
                    "UNSUPPORTED_CONTENT",
                    format!("附件超过大小上限 {max_per_item} 字节（不做压缩，请压缩或分段后再试）"),
                ));
            }
            total += size;
            if total > max_total {
                return Err(LlmError::new(
                    "UNSUPPORTED_CONTENT",
                    format!("单请求附件总量超过上限 {max_total} 字节"),
                ));
            }
        }
    }
    Ok(())
}

/// 模型能力守门：消息里的媒体类 part 必须有对应模型能力；纯文本不受影响。
/// TS 侧同类门禁保留，本函数是 Rust 出口的最后防线。
fn ensure_media_caps(req: &ChatRequest, ep: &Endpoint) -> Result<(), LlmError> {
    let has_cap = |wanted: &str| {
        ep.models.iter().any(|model| {
            model.id == req.model && model.capabilities.iter().any(|cap| cap == wanted)
        })
    };
    for message in &req.messages {
        let MessageContent::Parts(parts) = &message.content else {
            continue;
        };
        for part in parts {
            let (kind, capability) = match part {
                ContentPart::Image { .. } => ("图片", "vision"),
                ContentPart::Audio { .. } => ("音频", "audio"),
                ContentPart::Text { .. } => continue,
            };
            if !has_cap(capability) {
                return Err(LlmError::new(
                    "UNSUPPORTED_CONTENT",
                    format!("当前模型缺少 {capability} 能力，不支持{kind}内容"),
                ));
            }
        }
    }
    Ok(())
}

/// 能力门禁后的非流式 chat：供命令与集成测试共用，确保媒体被拒时不建立请求。
fn chat_checked(
    agent: &ureq::Agent,
    ep: &Endpoint,
    req: &ChatRequest,
    root_check: &dyn Fn(&str) -> bool,
) -> Result<ChatResponse, LlmError> {
    ensure_attachment_size(req, MAX_ATTACHMENT_BYTES, MAX_REQUEST_ATTACHMENT_BYTES)?;
    ensure_media_caps(req, ep)?;
    chat_with(agent, ep, req, root_check)
}

/// 非流式 chat：POST chat/completions，解析 choices[0].message.content（必须是字符串）。
fn chat_with(
    agent: &ureq::Agent,
    ep: &Endpoint,
    req: &ChatRequest,
    root_check: &dyn Fn(&str) -> bool,
) -> Result<ChatResponse, LlmError> {
    let url = join_url(&ep.base_url, "chat/completions");
    let body = build_chat_body(req, false, root_check)?;
    // ureq 未开 json feature（依赖白名单零新增）：手工序列化 + Content-Type 头。
    let resp = with_auth(agent.post(&url), ep)
        .set("Content-Type", "application/json")
        .send_bytes(body.to_string().as_bytes())
        .map_err(map_transport)?;
    let wire: WireChat = serde_json::from_reader(resp.into_reader()).map_err(|e| {
        LlmError::new(
            "BAD_RESPONSE",
            format!("响应不是合法 chat/completions 回包：{e}"),
        )
    })?;
    let choice = wire
        .choices
        .first()
        .ok_or_else(|| LlmError::new("BAD_RESPONSE", "choices 为空"))?;
    let content = choice
        .message
        .content
        .as_str()
        .ok_or_else(|| LlmError::new("BAD_RESPONSE", "content 不是字符串（多模态分段暂不支持）"))?
        .to_string();
    Ok(ChatResponse {
        content,
        finish_reason: choice.finish_reason.clone(),
        usage: wire.usage,
    })
}

/// 按 id 找 endpoint；缺席 → ENDPOINT_UNKNOWN。
fn find_endpoint(s: &Settings, id: &str) -> Result<Endpoint, LlmError> {
    s.endpoints
        .iter()
        .find(|e| e.id == id)
        .cloned()
        .ok_or_else(|| LlmError::new("ENDPOINT_UNKNOWN", format!("endpoint 不存在：{id}")))
}

/// upsert 本体：先校验（INVALID_CONFIG），再按 id 替换或追加。
/// key 语义由 dirty 标记区分（编辑表单回填掩码，\“没动\”与\“删空\”在 wire 上
/// 曾无法区分）：apiKeyDirty false/缺省且空 apiKey = 保留已存 key（安全默认，
/// 避免"改个名字顺手清掉密钥"）；dirty true = 按传入值更新，空即显式清空。
fn upsert_into(s: &mut Settings, mut e: Endpoint) -> Result<(), LlmError> {
    config::validate_endpoint(&e).map_err(|m| LlmError::new("INVALID_CONFIG", m))?;
    if let Some(slot) = s.endpoints.iter_mut().find(|x| x.id == e.id) {
        if !e.api_key_dirty && e.api_key.is_empty() {
            e.api_key = slot.api_key.clone();
        }
        *slot = e;
    } else {
        s.endpoints.push(e);
    }
    Ok(())
}

/// 按 id 返回完整 apiKey 明文（编辑态眼睛揭示用；纯函数便于测试）。
fn reveal_key(s: &Settings, id: &str) -> Result<String, LlmError> {
    Ok(find_endpoint(s, id)?.api_key)
}

/// 默认模型本体：Some(id) 须是任一 endpoint 已声明模型（INVALID_CONFIG）；None 清除。
fn set_default_into(s: &mut Settings, model: Option<String>) -> Result<(), LlmError> {
    if let Some(id) = &model {
        let known = s
            .endpoints
            .iter()
            .any(|e| e.models.iter().any(|m| &m.id == id));
        if !known {
            return Err(LlmError::new("INVALID_CONFIG", format!("未知模型：{id}")));
        }
    }
    s.default_model = model;
    Ok(())
}

/// 返回厂商预设表（前端唯一拿 baseUrl 的通道）。
#[tauri::command]
pub fn llm_list_presets() -> Vec<LlmPreset> {
    presets()
}

/// baseUrl → vendor：匹配预设 baseUrl（容忍尾斜杠差异）；未匹配 → custom。
fn vendor_of(base_url: &str, presets: &[LlmPreset]) -> String {
    let normalized = base_url.trim_end_matches('/');
    presets
        .iter()
        .find(|p| p.base_url.trim_end_matches('/') == normalized)
        .map(|p| p.vendor.clone())
        .unwrap_or_else(|| "custom".into())
}

/// 返回全部 endpoint 的脱敏投影 + 默认模型（完整 key 永不出 Rust）。
#[tauri::command]
pub fn llm_list_endpoints(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = config::app_studywiki_dir(&app)?;
    let s = config::load_settings(&dir)?;
    let presets = presets();
    Ok(serde_json::json!({
        "endpoints": s
            .endpoints
            .iter()
            .map(|e| {
                let mut r = config::redact(e);
                r.vendor = vendor_of(&e.base_url, &presets);
                r
            })
            .collect::<Vec<_>>(),
        "defaultModel": s.default_model,
    }))
}

/// 新增或按 id 覆盖一条 endpoint（校验失败 → INVALID_CONFIG）。
#[tauri::command]
pub fn llm_upsert_endpoint(app: AppHandle, endpoint: Endpoint) -> Result<(), LlmError> {
    let dir = config::app_studywiki_dir(&app).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
    let mut s = config::load_settings(&dir).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
    upsert_into(&mut s, endpoint)?;
    config::save_settings(&dir, &s).map_err(|e| LlmError::new("INVALID_CONFIG", e))
}

/// 按 id 删除 endpoint；缺席 → ENDPOINT_UNKNOWN。
#[tauri::command]
pub fn llm_remove_endpoint(app: AppHandle, id: String) -> Result<(), LlmError> {
    let dir = config::app_studywiki_dir(&app).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
    let mut s = config::load_settings(&dir).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
    if s.endpoints.iter().any(|e| e.id == id) {
        s.endpoints.retain(|e| e.id != id);
        config::save_settings(&dir, &s).map_err(|e| LlmError::new("INVALID_CONFIG", e))
    } else {
        Err(LlmError::new(
            "ENDPOINT_UNKNOWN",
            format!("endpoint 不存在：{id}"),
        ))
    }
}

/// 揭示 endpoint 的完整 apiKey 明文（编辑态眼睛按钮按需取用；
/// 命令面仅内置插件可达——guard.ts 外置白名单不含本命令）。
#[tauri::command]
pub fn llm_reveal_key(app: AppHandle, id: String) -> Result<String, LlmError> {
    let dir = config::app_studywiki_dir(&app).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
    let s = config::load_settings(&dir).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
    reveal_key(&s, &id)
}

/// 探测：GET /models，成功返回延迟 ms。async 命令 + spawn_blocking：
/// ureq 是阻塞调用，留在同步命令里会随 tauri-macros 的 body_blocking
/// 在主线程执行，探测卡住（最长 10s）期间全窗口冻结。
#[tauri::command]
pub async fn llm_probe(app: AppHandle, id: String) -> Result<u64, LlmError> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir =
            config::app_studywiki_dir(&app).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
        let s = config::load_settings(&dir).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
        let ep = find_endpoint(&s, &id)?;
        probe_with(&probe_agent(), &ep)
    })
    .await
    .map_err(|e| LlmError::new("INTERNAL", format!("探测后台任务异常终止：{e}")))?
}

/// 设置/清除默认模型（写面：仅内置插件经宿主 facade 可达）。
#[tauri::command]
pub fn llm_set_default_model(app: AppHandle, model: Option<String>) -> Result<(), LlmError> {
    let dir = config::app_studywiki_dir(&app).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
    let mut s = config::load_settings(&dir).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
    set_default_into(&mut s, model)?;
    config::save_settings(&dir, &s).map_err(|e| LlmError::new("INVALID_CONFIG", e))
}

/// 非流式 chat：endpointId + model 由前端路由，Rust 纯传输。async 命令 +
/// spawn_blocking：大模型生成可达数分钟，同步命令会让主线程冻结整个事件循环
/// （所有窗口 UI 与关窗守卫失效），必须下放 worker 线程。
#[tauri::command]
pub async fn llm_chat(
    app: AppHandle,
    reg: tauri::State<'_, Mutex<crate::windows::WindowRegistry>>,
    req: ChatRequest,
) -> Result<ChatResponse, LlmError> {
    let roots_ok = {
        let reg = reg.lock().unwrap();
        reg.roots()
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<_>>()
    };
    tauri::async_runtime::spawn_blocking(move || {
        let dir =
            config::app_studywiki_dir(&app).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
        let s = config::load_settings(&dir).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
        let ep = find_endpoint(&s, &req.endpoint_id)?;
        let root_check = |p: &str| crate::windows::path_under_roots(&roots_ok, p);
        chat_checked(&chat_agent(), &ep, &req, &root_check)
    })
    .await
    .map_err(|e| LlmError::new("INTERNAL", format!("chat 后台任务异常终止：{e}")))?
}

/// RAII 清理一条流的中止登记：HTTP 构建或发送失败也会在 drop 时移除 id。
struct AbortGuard<'a>(&'a AbortRegistry, String);

impl<'a> AbortGuard<'a> {
    fn new(aborts: &'a AbortRegistry, stream_id: &str) -> Self {
        Self(aborts, stream_id.to_string())
    }
}

impl Drop for AbortGuard<'_> {
    fn drop(&mut self) {
        self.0.lock().unwrap().remove(&self.1);
    }
}

/// 流式读循环的运行参数包：收敛参数个数（clippy too_many_arguments）。
struct StreamCtx<'a> {
    stream_id: &'a str,
    aborts: &'a AbortRegistry,
    event_limit: u64,
    root_check: &'a dyn Fn(&str) -> bool,
}

/// 流式读循环（纯缝：sink 可测）：abort 置位或 sink 返回 false 即停；结束或失败都清理登记。
fn run_chat_stream(
    agent: &ureq::Agent,
    ep: &Endpoint,
    req: &ChatRequest,
    sink: &mut dyn FnMut(StreamChunk) -> bool,
    ctx: &StreamCtx<'_>,
) -> Result<(), LlmError> {
    let _guard = AbortGuard::new(ctx.aborts, ctx.stream_id);
    let url = join_url(&ep.base_url, "chat/completions");
    let body = build_chat_body(req, true, ctx.root_check)?;
    let resp = with_auth(agent.post(&url), ep)
        .set("Content-Type", "application/json")
        .send_bytes(body.to_string().as_bytes())
        .map_err(map_transport)?;
    let reader = BufReader::new(resp.into_reader());
    let result = parse_sse_lines(reader, ctx.event_limit, &mut |chunk| {
        if ctx.aborts.lock().unwrap().contains(ctx.stream_id) {
            return false;
        }
        sink(chunk)
    });
    result
}

/// 能力门禁后的流式 chat：供命令与集成测试共用，确保媒体被拒时不建立请求。
fn run_chat_stream_checked(
    agent: &ureq::Agent,
    ep: &Endpoint,
    req: &ChatRequest,
    sink: &mut dyn FnMut(StreamChunk) -> bool,
    ctx: &StreamCtx<'_>,
) -> Result<(), LlmError> {
    ensure_attachment_size(req, MAX_ATTACHMENT_BYTES, MAX_REQUEST_ATTACHMENT_BYTES)?;
    ensure_media_caps(req, ep)?;
    run_chat_stream(agent, ep, req, sink, ctx)
}

/// 流式 chat：chunk 经 Channel 增量投递，Promise 在流终结时 resolve。
/// 中止经 llm_chat_abort 置位；前端 webview 消失（send 失败）自停。
#[tauri::command]
pub async fn llm_chat_stream(
    app: AppHandle,
    reg: tauri::State<'_, Mutex<crate::windows::WindowRegistry>>,
    req: ChatStreamRequest,
    on_chunk: Channel<StreamChunk>,
) -> Result<(), LlmError> {
    let roots_ok = {
        let reg = reg.lock().unwrap();
        reg.roots()
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<_>>()
    };
    tauri::async_runtime::spawn_blocking(move || {
        let dir =
            config::app_studywiki_dir(&app).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
        let s = config::load_settings(&dir).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
        let ep = find_endpoint(&s, &req.base.endpoint_id)?;
        let event_limit = config::stream_event_limit(&s);
        let sid = req.stream_id.clone();
        let root_check = |p: &str| crate::windows::path_under_roots(&roots_ok, p);
        let ctx = StreamCtx {
            stream_id: &sid,
            aborts: abort_registry(),
            event_limit,
            root_check: &root_check,
        };
        run_chat_stream_checked(
            &stream_agent(),
            &ep,
            &req.base,
            &mut |chunk| on_chunk.send(chunk).is_ok(),
            &ctx,
        )
    })
    .await
    .map_err(|e| LlmError::new("INTERNAL", format!("流式后台任务异常终止：{e}")))?
}

/// 中止在途流式 chat（幂等：未知 id 视为已结束）。
#[tauri::command]
pub fn llm_chat_abort(id: String) -> Result<(), LlmError> {
    abort_registry().lock().unwrap().insert(id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Endpoint, ModelEntry, Settings};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::Duration;

    /// 起 mock：读完整请求（按 Content-Length），回固定响应；把收到的请求原文发回通道。
    fn mock_server(status: u16, body: &'static str) -> (String, std::sync::mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = Vec::new();
            let mut tmp = [0u8; 4096];
            loop {
                let n = stream.read(&mut tmp).unwrap_or(0);
                buf.extend_from_slice(&tmp[..n]);
                if let Some(pos) = find_header_end(&buf) {
                    let head = String::from_utf8_lossy(&buf[..pos]).to_string();
                    let len: usize = head
                        .lines()
                        .find_map(|l| {
                            l.strip_prefix("Content-Length: ")
                                .or_else(|| l.strip_prefix("content-length: "))
                        })
                        .and_then(|v| v.trim().parse().ok())
                        .unwrap_or(0);
                    if buf.len() >= pos + len {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            tx.send(String::from_utf8_lossy(&buf).to_string()).unwrap();
            write!(
                stream,
                "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        });
        (format!("http://127.0.0.1:{port}/v1"), rx)
    }

    fn find_header_end(buf: &[u8]) -> Option<usize> {
        buf.windows(4).position(|w| w == b"\r\n\r\n").map(|p| p + 4)
    }

    fn agent() -> ureq::Agent {
        ureq::AgentBuilder::new()
            .timeout(Duration::from_millis(1500))
            .build()
    }

    fn ep(base_url: &str, key: &str) -> Endpoint {
        Endpoint {
            id: "e1".into(),
            name: "E1".into(),
            kind: "chat".into(),
            base_url: base_url.into(),
            api_key: key.into(),
            api_key_dirty: false,
            models: vec![ModelEntry {
                id: "m1".into(),
                capabilities: vec!["text".into()],
            }],
        }
    }

    #[test]
    fn vendor_of_matches_presets_and_falls_back_to_custom() {
        let ps = presets();
        assert_eq!(vendor_of("https://api.deepseek.com/v1", &ps), "deepseek");
        assert_eq!(
            vendor_of("https://open.bigmodel.cn/api/paas/v4/", &ps),
            "zhipu"
        );
        assert_eq!(vendor_of("http://127.0.0.1:18042/v1", &ps), "custom");
    }

    #[test]
    fn join_url_trims_trailing_slash() {
        assert_eq!(join_url("https://h/v1/", "models"), "https://h/v1/models");
        assert_eq!(join_url("https://h/v1", "models"), "https://h/v1/models");
    }

    #[test]
    fn probe_succeeds_without_key_and_sends_no_auth_header() {
        let (base, rx) = mock_server(200, r#"{"data":[]}"#);
        let ms = probe_with(&agent(), &ep(&format!("{base}/"), "")).unwrap();
        assert!(ms < 1500);
        let req = rx.recv().unwrap();
        assert!(req.starts_with("GET /v1/models HTTP/1.1"));
        assert!(!req.to_lowercase().contains("authorization"));
    }

    #[test]
    fn probe_maps_401_429_and_unreachable() {
        let (base, _rx) = mock_server(401, "{}");
        assert_eq!(
            probe_with(&agent(), &ep(&base, "k")).unwrap_err().code,
            "UNAUTHORIZED"
        );
        let (base2, _rx2) = mock_server(429, "{}");
        assert_eq!(
            probe_with(&agent(), &ep(&base2, "k")).unwrap_err().code,
            "RATE_LIMITED"
        );
        let closed = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = closed.local_addr().unwrap().port();
        drop(closed);
        assert_eq!(
            probe_with(&agent(), &ep(&format!("http://127.0.0.1:{port}"), "k"))
                .unwrap_err()
                .code,
            "UNREACHABLE"
        );
    }

    #[test]
    fn chat_posts_messages_and_parses_reply() {
        let body = r#"{"choices":[{"message":{"role":"assistant","content":"你好"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}"#;
        let (base, rx) = mock_server(200, body);
        let req = ChatRequest {
            endpoint_id: "x".into(),
            model: "m1".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: MessageContent::Text("hi".into()),
                tool_calls: None,
                tool_call_id: None,
            }],
            max_tokens: None,
            temperature: None,
            tools: None,
        };
        let resp = chat_with(&agent(), &ep(&base, "secret-key"), &req, &|_| false).unwrap();
        assert_eq!(resp.content, "你好");
        assert_eq!(resp.finish_reason, "stop");
        let sent = rx.recv().unwrap();
        assert!(sent.starts_with("POST /v1/chat/completions HTTP/1.1"));
        assert!(sent
            .to_lowercase()
            .contains("authorization: bearer secret-key"));
        assert!(sent.contains(r#""model":"m1""#));
    }

    #[test]
    fn chat_maps_bad_json_to_bad_response() {
        let (base, _rx) = mock_server(200, "not json");
        let req = ChatRequest {
            endpoint_id: "x".into(),
            model: "m1".into(),
            messages: vec![],
            max_tokens: None,
            temperature: None,
            tools: None,
        };
        assert_eq!(
            chat_with(&agent(), &ep(&base, ""), &req, &|_| false)
                .unwrap_err()
                .code,
            "BAD_RESPONSE"
        );
    }

    #[test]
    fn chat_response_serializes_camel_case_for_ts() {
        let resp = ChatResponse {
            content: "ok".into(),
            finish_reason: "stop".into(),
            usage: Some(Usage {
                prompt_tokens: 3,
                completion_tokens: 2,
            }),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["finishReason"], "stop");
        assert_eq!(json["usage"]["promptTokens"], 3);
        assert_eq!(json["usage"]["completionTokens"], 2);
    }

    #[test]
    fn upsert_dirty_empty_clears_existing_key() {
        let mut s = Settings {
            version: 1,
            endpoints: vec![ep("https://h", "secret")],
            default_model: None,
            stream_event_limit_bytes: None,
        };
        let mut incoming = ep("https://h", "");
        incoming.id = "e1".into();
        incoming.api_key_dirty = true;
        upsert_into(&mut s, incoming).unwrap();
        assert_eq!(s.endpoints[0].api_key, "");
    }

    #[test]
    fn upsert_dirty_new_key_replaces() {
        let mut s = Settings {
            version: 1,
            endpoints: vec![ep("https://h", "secret")],
            default_model: None,
            stream_event_limit_bytes: None,
        };
        let mut incoming = ep("https://h", "new-key");
        incoming.id = "e1".into();
        incoming.api_key_dirty = true;
        upsert_into(&mut s, incoming).unwrap();
        assert_eq!(s.endpoints[0].api_key, "new-key");
    }

    #[test]
    fn reveal_key_returns_full_secret_and_unknown_fails() {
        let s = Settings {
            version: 1,
            endpoints: vec![ep("https://h", "secret")],
            default_model: None,
            stream_event_limit_bytes: None,
        };
        assert_eq!(reveal_key(&s, "e1").unwrap(), "secret");
        assert_eq!(reveal_key(&s, "nope").unwrap_err().code, "ENDPOINT_UNKNOWN");
    }

    #[test]
    fn upsert_preserves_existing_key_when_incoming_empty() {
        let mut s = Settings {
            version: 1,
            endpoints: vec![ep("https://h", "secret")],
            default_model: None,
            stream_event_limit_bytes: None,
        };
        let mut incoming = ep("https://h", "");
        incoming.id = "e1".into();
        upsert_into(&mut s, incoming).unwrap();
        assert_eq!(s.endpoints[0].api_key, "secret");
    }

    #[test]
    fn set_default_into_validates_known_model() {
        let mut s = Settings {
            version: 1,
            endpoints: vec![ep("https://h", "")],
            default_model: None,
            stream_event_limit_bytes: None,
        };
        set_default_into(&mut s, Some("m1".into())).unwrap();
        assert_eq!(s.default_model.as_deref(), Some("m1"));
        assert_eq!(
            set_default_into(&mut s, Some("nope".into()))
                .unwrap_err()
                .code,
            "INVALID_CONFIG"
        );
        set_default_into(&mut s, None).unwrap();
        assert!(s.default_model.is_none());
    }

    fn read_full_request(stream: &mut std::net::TcpStream) -> String {
        let mut buf = Vec::new();
        let mut tmp = [0u8; 4096];
        loop {
            let n = stream.read(&mut tmp).unwrap_or(0);
            buf.extend_from_slice(&tmp[..n]);
            if let Some(pos) = find_header_end(&buf) {
                let head = String::from_utf8_lossy(&buf[..pos]).to_string();
                let len: usize = head
                    .lines()
                    .find_map(|l| {
                        l.strip_prefix("Content-Length: ")
                            .or_else(|| l.strip_prefix("content-length: "))
                    })
                    .and_then(|v| v.trim().parse().ok())
                    .unwrap_or(0);
                if buf.len() >= pos + len {
                    break;
                }
            }
            if n == 0 {
                break;
            }
        }
        String::from_utf8_lossy(&buf).to_string()
    }

    /// 流式 mock：分片写出 SSE（模拟网络分段），最后 [DONE]。
    fn mock_stream_server(fragments: Vec<String>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            read_full_request(&mut stream);
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
            for frag in fragments {
                stream.write_all(frag.as_bytes()).unwrap();
                stream.flush().unwrap();
                std::thread::sleep(Duration::from_millis(5));
            }
        });
        format!("http://127.0.0.1:{port}/v1")
    }

    fn test_endpoint(base: &str) -> Endpoint {
        ep(base, "")
    }

    fn text_request() -> ChatRequest {
        ChatRequest {
            endpoint_id: "e".into(),
            model: "m".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: MessageContent::Text("你好".into()),
                tool_calls: None,
                tool_call_id: None,
            }],
            max_tokens: None,
            temperature: None,
            tools: None,
        }
    }

    fn new_abort_registry() -> AbortRegistry {
        std::sync::Arc::new(std::sync::Mutex::new(std::collections::HashSet::new()))
    }

    #[test]
    fn stream_loop_delivers_chunks_and_finishes() {
        let base = mock_stream_server(vec![
            "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\n".into(),
            "data: {\"choices\":[{\"delta\":{\"content\":\"好\"},\"finish_reason\":\"stop\"}]}\n\n"
                .into(),
            "data: [DONE]\n\n".into(),
        ]);
        let ep = test_endpoint(&base);
        let aborts = new_abort_registry();
        let mut got: Vec<StreamChunk> = Vec::new();
        let r = run_chat_stream(
            &stream_agent(),
            &ep,
            &text_request(),
            &mut |c| {
                got.push(c);
                true
            },
            &StreamCtx {
                stream_id: "s1",
                aborts: &aborts,
                event_limit: u64::MAX,
                root_check: &|_| false,
            },
        );
        assert!(r.is_ok());
        assert!(got
            .iter()
            .any(|c| matches!(c, StreamChunk::TextDelta { text, .. } if text == "好")));
    }

    #[test]
    fn stream_abort_flag_stops_reading() {
        let base = mock_stream_server(vec![
            "data: {\"choices\":[{\"delta\":{\"content\":\"一\"}}]}\n\n".into(),
            "data: {\"choices\":[{\"delta\":{\"content\":\"二\"}}]}\n\n".into(),
            "data: [DONE]\n\n".into(),
        ]);
        let ep = test_endpoint(&base);
        let aborts = new_abort_registry();
        let mut n = 0;
        let r = run_chat_stream(
            &stream_agent(),
            &ep,
            &text_request(),
            &mut |_c| {
                n += 1;
                if n == 1 {
                    aborts.lock().unwrap().insert("s2".to_string());
                }
                n == 0 // 恒 false：模拟中止后停止。
            },
            &StreamCtx {
                stream_id: "s2",
                aborts: &aborts,
                event_limit: u64::MAX,
                root_check: &|_c| false,
            },
        );
        assert!(r.is_ok());
        assert_eq!(n, 1, "回调停止后不得再投递 chunk");
    }

    #[test]
    fn upstream_body_emits_openai_tools_shape() {
        let req = ChatRequest {
            endpoint_id: "e1".into(),
            model: "m1".into(),
            messages: vec![],
            max_tokens: None,
            temperature: None,
            tools: Some(vec![ToolDecl {
                name: "read".into(),
                description: "读文件".into(),
                parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}),
            }]),
        };
        let body = upstream_body(&req, false);
        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(body["tools"][0]["function"]["name"], "read");
        assert!(body["tools"][0]["function"]["parameters"]["properties"]["path"].is_object());
    }

    #[test]
    fn upstream_body_emits_tool_calls_and_tool_role() {
        let req = ChatRequest {
            endpoint_id: "e1".into(),
            model: "m1".into(),
            max_tokens: None,
            temperature: None,
            tools: None,
            messages: vec![
                ChatMessage {
                    role: "assistant".into(),
                    content: MessageContent::Text(String::new()),
                    tool_calls: Some(vec![ToolCall {
                        id: "c1".into(),
                        name: "read".into(),
                        arguments: "{\"path\":\"/a.md\"}".into(),
                    }]),
                    tool_call_id: None,
                },
                ChatMessage {
                    role: "tool".into(),
                    content: MessageContent::Text("内容".into()),
                    tool_calls: None,
                    tool_call_id: Some("c1".into()),
                },
            ],
        };
        let body = upstream_body(&req, false);
        assert_eq!(body["messages"][0]["tool_calls"][0]["type"], "function");
        assert_eq!(
            body["messages"][0]["tool_calls"][0]["function"]["name"],
            "read"
        );
        assert_eq!(
            body["messages"][0]["tool_calls"][0]["function"]["arguments"],
            "{\"path\":\"/a.md\"}"
        );
        assert_eq!(body["messages"][1]["role"], "tool");
        assert_eq!(body["messages"][1]["tool_call_id"], "c1");
    }

    #[test]
    fn upstream_body_omits_tools_when_absent() {
        let req = ChatRequest {
            endpoint_id: "e1".into(),
            model: "m1".into(),
            messages: vec![],
            max_tokens: None,
            temperature: None,
            tools: None,
        };
        let body = upstream_body(&req, true);
        assert!(body.get("tools").is_none());
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn image_path_part_becomes_data_url() {
        let dir = std::env::temp_dir().join(format!("sw-att-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.png"), b"\x89PNG").unwrap();
        let p = dir.join("a.png").to_string_lossy().to_string();
        let req = ChatRequest {
            endpoint_id: "e".into(),
            model: "m".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: MessageContent::Parts(vec![
                    ContentPart::Text {
                        text: "看图".into(),
                    },
                    ContentPart::Image {
                        source: MediaSource::Path { path: p },
                    },
                ]),
                tool_calls: None,
                tool_call_id: None,
            }],
            max_tokens: None,
            temperature: None,
            tools: None,
        };
        let body = build_chat_body(&req, false, &|_p| true).unwrap();
        let parts = body["messages"][0]["content"].as_array().unwrap();
        assert_eq!(parts[0]["type"], "text");
        assert!(parts[1]["image_url"]["url"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert_eq!(body["stream"], serde_json::json!(false));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn image_wire_part_deserializes_to_structural_image_variant() {
        let wire = serde_json::json!({
            "type": "image",
            "source": {"kind": "path", "path": "/w/a.png"}
        });
        let part: ContentPart = serde_json::from_value(wire).unwrap();
        assert!(matches!(
            part,
            ContentPart::Image {
                source: MediaSource::Path { .. }
            }
        ));
    }

    #[test]
    fn audio_part_serializes_audio_tag_and_camel_case_mime_type() {
        let part = ContentPart::Audio {
            source: MediaSource::Inline {
                data: "ZA".into(),
                mime_type: "audio/wav".into(),
            },
        };
        let wire = serde_json::to_value(&part).unwrap();
        assert_eq!(wire["type"], "audio");
        assert_eq!(wire["source"]["kind"], "inline");
        assert_eq!(wire["source"]["mimeType"], "audio/wav");
    }

    #[test]
    fn path_attachment_authorizes_and_reads_canonical_path() {
        let base = std::env::temp_dir().join(format!("sw-attach-canonical-{}", std::process::id()));
        let root = base.join("workspace");
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("a.png");
        std::fs::write(&file, b"\x89PNG").unwrap();
        // macOS exposes /var as a symlink to /private/var; compare canonical forms.
        let canonical_file = std::fs::canonicalize(&file).unwrap();
        // A non-canonical request path proves authorization and read use one resolution.
        std::fs::create_dir_all(root.join("sub")).unwrap();
        let link = root.join("sub").join("..").join("a.png");

        let checked_path = std::cell::RefCell::new(String::new());
        let req = ChatRequest {
            endpoint_id: "e".into(),
            model: "m".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: MessageContent::Parts(vec![ContentPart::Image {
                    source: MediaSource::Path {
                        path: link.to_string_lossy().to_string(),
                    },
                }]),
                tool_calls: None,
                tool_call_id: None,
            }],
            max_tokens: None,
            temperature: None,
            tools: None,
        };
        let body = build_chat_body(&req, false, &|p| {
            *checked_path.borrow_mut() = p.to_string();
            p == canonical_file.to_string_lossy()
        })
        .unwrap();
        assert!(body["messages"][0]["content"][0]["image_url"]["url"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert_eq!(checked_path.into_inner(), canonical_file.to_string_lossy());
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn root_outside_path_rejected() {
        let req = ChatRequest {
            endpoint_id: "e".into(),
            model: "m".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: MessageContent::Parts(vec![ContentPart::Image {
                    source: MediaSource::Path {
                        path: "/etc/passwd".into(),
                    },
                }]),
                tool_calls: None,
                tool_call_id: None,
            }],
            max_tokens: None,
            temperature: None,
            tools: None,
        };
        let r = build_chat_body(&req, true, &|_p| false);
        assert_eq!(r.unwrap_err().code, "UNSUPPORTED_CONTENT");
    }

    #[test]
    fn attachment_size_constants_match_contract() {
        assert_eq!(MAX_ATTACHMENT_BYTES, 20 * 1024 * 1024);
        assert_eq!(MAX_REQUEST_ATTACHMENT_BYTES, 100 * 1024 * 1024);
    }

    #[test]
    fn inline_attachment_over_per_item_cap_rejected() {
        // 12 base64 字符 ≈ 9 解码字节，超过 8 字节单件上限；超限必须明确报错而非静默收下。
        let req = media_request(ContentPart::Audio {
            source: MediaSource::Inline {
                data: "AAAAAAAAAAAA".into(),
                mime_type: "audio/wav".into(),
            },
        });
        let err = ensure_attachment_size(&req, 8, 100).unwrap_err();
        assert_eq!(err.code, "UNSUPPORTED_CONTENT");
        assert!(err.message.contains("8 字节"));
    }

    #[test]
    fn path_attachment_size_cap_uses_metadata() {
        let dir = std::env::temp_dir().join(format!("sw-att-size-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.wav");
        std::fs::write(&file, [0u8; 10]).unwrap();
        let req = media_request(ContentPart::Audio {
            source: MediaSource::Path {
                path: file.to_string_lossy().to_string(),
            },
        });
        assert_eq!(
            ensure_attachment_size(&req, 5, 1000).unwrap_err().code,
            "UNSUPPORTED_CONTENT"
        );
        assert!(ensure_attachment_size(&req, 100, 1000).is_ok());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn attachments_over_aggregate_cap_rejected() {
        // 两个各 6 解码字节的附件，单件限 10 都过，聚合限 10 必炸。
        let part = || ContentPart::Audio {
            source: MediaSource::Inline {
                data: "AAAAAAAA".into(),
                mime_type: "audio/wav".into(),
            },
        };
        let req = ChatRequest {
            endpoint_id: "e".into(),
            model: "m".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: MessageContent::Parts(vec![part(), part()]),
                tool_calls: None,
                tool_call_id: None,
            }],
            max_tokens: None,
            temperature: None,
            tools: None,
        };
        assert!(ensure_attachment_size(&req, 10, 12).is_ok());
        let err = ensure_attachment_size(&req, 10, 10).unwrap_err();
        assert_eq!(err.code, "UNSUPPORTED_CONTENT");
        assert!(err.message.contains("总量"));
    }

    #[test]
    fn url_and_text_parts_do_not_count_toward_size_caps() {
        let req = ChatRequest {
            endpoint_id: "e".into(),
            model: "m".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: MessageContent::Parts(vec![
                    ContentPart::Text {
                        text: "看图".into(),
                    },
                    ContentPart::Image {
                        source: MediaSource::Url {
                            url: "https://x/a.png".into(),
                        },
                    },
                ]),
                tool_calls: None,
                tool_call_id: None,
            }],
            max_tokens: None,
            temperature: None,
            tools: None,
        };
        assert!(ensure_attachment_size(&req, 0, 0).is_ok());
    }

    #[test]
    fn stream_body_carries_stream_options_usage() {
        let body = build_chat_body(&text_request(), true, &|_| true).unwrap();
        assert_eq!(body["stream"], serde_json::json!(true));
        assert_eq!(
            body["stream_options"],
            serde_json::json!({"include_usage": true})
        );
    }

    #[test]
    fn inline_audio_unsupported_mime_rejected() {
        let req = media_request(ContentPart::Audio {
            source: MediaSource::Inline {
                data: "ZA".into(),
                mime_type: "audio/flac".into(),
            },
        });
        let r = build_chat_body(&req, true, &|_| true);
        assert_eq!(r.unwrap_err().code, "UNSUPPORTED_CONTENT");
    }

    #[test]
    fn audio_url_source_rejected() {
        let req = ChatRequest {
            endpoint_id: "e".into(),
            model: "m".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: MessageContent::Parts(vec![ContentPart::Audio {
                    source: MediaSource::Url {
                        url: "https://x/a.mp3".into(),
                    },
                }]),
                tool_calls: None,
                tool_call_id: None,
            }],
            max_tokens: None,
            temperature: None,
            tools: None,
        };
        let r = build_chat_body(&req, true, &|_| true);
        assert_eq!(r.unwrap_err().code, "UNSUPPORTED_CONTENT");
    }

    #[test]
    fn upsert_validation_errors_are_invalid_config_and_find_endpoint_miss() {
        let mut s = Settings {
            version: 1,
            endpoints: vec![],
            default_model: None,
            stream_event_limit_bytes: None,
        };
        assert_eq!(
            find_endpoint(&s, "nope").unwrap_err().code,
            "ENDPOINT_UNKNOWN"
        );
        let mut e = ep("https://h", "");
        e.id = String::new();
        assert_eq!(upsert_into(&mut s, e).unwrap_err().code, "INVALID_CONFIG");
    }

    fn media_request(part: ContentPart) -> ChatRequest {
        ChatRequest {
            endpoint_id: "e1".into(),
            model: "m1".into(),
            messages: vec![ChatMessage {
                role: "user".into(),
                content: MessageContent::Parts(vec![part]),
                tool_calls: None,
                tool_call_id: None,
            }],
            max_tokens: None,
            temperature: None,
            tools: None,
        }
    }

    #[test]
    fn media_caps_match_image_and_audio_capabilities() {
        let endpoint = ep("https://h", "");
        let vision = ensure_media_caps(
            &media_request(ContentPart::Image {
                source: MediaSource::Url {
                    url: "https://x/a.png".into(),
                },
            }),
            &endpoint,
        );
        let vision = vision.unwrap_err();
        assert_eq!(vision.code, "UNSUPPORTED_CONTENT");
        assert!(vision.message.contains("vision"));
        let audio = ensure_media_caps(
            &media_request(ContentPart::Audio {
                source: MediaSource::Inline {
                    data: "ZA".into(),
                    mime_type: "audio/wav".into(),
                },
            }),
            &endpoint,
        );
        let audio = audio.unwrap_err();
        assert_eq!(audio.code, "UNSUPPORTED_CONTENT");
        assert!(audio.message.contains("audio"));
    }

    #[test]
    fn chat_checked_blocks_unsupported_media_without_sending() {
        let (base, rx) = mock_server(200, "{}");
        let endpoint = ep(&base, "");
        let req = media_request(ContentPart::Image {
            source: MediaSource::Url {
                url: "https://x/a.png".into(),
            },
        });
        let result = chat_checked(&agent(), &endpoint, &req, &|_| false);
        assert_eq!(result.unwrap_err().code, "UNSUPPORTED_CONTENT");
        assert!(
            rx.try_recv().is_err(),
            "mock server must receive no request"
        );
    }

    #[test]
    fn stream_checked_blocks_unsupported_media_without_sending() {
        let (base, rx) = mock_server(200, "{}");
        let endpoint = ep(&base, "");
        let req = media_request(ContentPart::Audio {
            source: MediaSource::Inline {
                data: "ZA".into(),
                mime_type: "audio/wav".into(),
            },
        });
        let aborts = new_abort_registry();
        let result = run_chat_stream_checked(
            &agent(),
            &endpoint,
            &req,
            &mut |_| true,
            &StreamCtx {
                stream_id: "caps",
                aborts: &aborts,
                event_limit: u64::MAX,
                root_check: &|_| false,
            },
        );
        assert_eq!(result.unwrap_err().code, "UNSUPPORTED_CONTENT");
        assert!(
            rx.try_recv().is_err(),
            "mock server must receive no request"
        );
    }

    #[test]
    fn stream_send_failure_cleans_abort_registration() {
        let closed = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = closed.local_addr().unwrap().port();
        drop(closed);
        let endpoint = test_endpoint(&format!("http://127.0.0.1:{port}"));
        let aborts = new_abort_registry();
        aborts.lock().unwrap().insert("send-failure".into());
        let result = run_chat_stream(
            &agent(),
            &endpoint,
            &text_request(),
            &mut |_| true,
            &StreamCtx {
                stream_id: "send-failure",
                aborts: &aborts,
                event_limit: u64::MAX,
                root_check: &|_p| false,
            },
        );
        assert_eq!(result.unwrap_err().code, "UNREACHABLE");
        assert!(!aborts.lock().unwrap().contains("send-failure"));
    }
}

#[cfg(test)]
mod async_command_tests {
    use super::*;

    /// tauri-macros 对同步命令生成 body_blocking（IPC 处理器内联执行 → 主线程）；
    /// 网络命令必须是 async fn（宏走 respond_async 挂 async runtime），
    /// 否则一次推理（最长 600s）期间所有窗口冻结、关窗守卫失效。
    #[test]
    fn chat_stream_and_probe_commands_are_async() {
        type Reg = tauri::State<'static, Mutex<crate::windows::WindowRegistry>>;
        fn assert_async_chat<F: std::future::Future>(_f: fn(AppHandle, Reg, ChatRequest) -> F) {}
        fn assert_async_stream<F: std::future::Future>(
            _f: fn(AppHandle, Reg, ChatStreamRequest, Channel<StreamChunk>) -> F,
        ) {
        }
        fn assert_async_probe<F: std::future::Future>(_f: fn(AppHandle, String) -> F) {}
        assert_async_chat(llm_chat);
        assert_async_stream(llm_chat_stream);
        assert_async_probe(llm_probe);
    }
}
