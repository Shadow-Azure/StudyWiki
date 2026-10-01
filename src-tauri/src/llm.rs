//! LLM 推理薄能力层：厂商预设、endpoint CRUD、探测与非流式 chat 出口。

use crate::config::{self, Endpoint, ModelEntry, Settings};
use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::AppHandle;

/// 探测超时：OpenAI 兼容 /models 是轻调用，10s 足够。
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
/// chat 超时：大模型生成可达数分钟，给满 300s。
const CHAT_TIMEOUT: Duration = Duration::from_secs(300);

/// 归一错误：code 为全链路共享词表（前端路由层另有 MODEL_* 三码）。
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

/// 一条对话消息（本期 content 为纯文本；多模态随 m2-02 流式一起扩）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
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

/// 非流式 chat：POST chat/completions，解析 choices[0].message.content（必须是字符串）。
fn chat_with(
    agent: &ureq::Agent,
    ep: &Endpoint,
    req: &ChatRequest,
) -> Result<ChatResponse, LlmError> {
    let url = join_url(&ep.base_url, "chat/completions");
    let mut body = serde_json::json!({
        "model": req.model,
        "messages": req.messages,
        "stream": false,
    });
    if let Some(max) = req.max_tokens {
        body["max_tokens"] = serde_json::json!(max);
    }
    if let Some(t) = req.temperature {
        body["temperature"] = serde_json::json!(t);
    }
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
/// 编辑态保护：key 只进不出（前端永远拿不到完整 key），incoming 空 apiKey 时
/// 保留既有同 id endpoint 的 key——避免"改个名字顺手清掉密钥"。
fn upsert_into(s: &mut Settings, mut e: Endpoint) -> Result<(), LlmError> {
    config::validate_endpoint(&e).map_err(|m| LlmError::new("INVALID_CONFIG", m))?;
    if let Some(slot) = s.endpoints.iter_mut().find(|x| x.id == e.id) {
        if e.api_key.is_empty() {
            e.api_key = slot.api_key.clone();
        }
        *slot = e;
    } else {
        s.endpoints.push(e);
    }
    Ok(())
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

/// 探测：GET /models，成功返回延迟 ms。
#[tauri::command]
pub fn llm_probe(app: AppHandle, id: String) -> Result<u64, LlmError> {
    let dir = config::app_studywiki_dir(&app).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
    let s = config::load_settings(&dir).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
    let ep = find_endpoint(&s, &id)?;
    probe_with(&probe_agent(), &ep)
}

/// 设置/清除默认模型（写面：仅内置插件经宿主 facade 可达）。
#[tauri::command]
pub fn llm_set_default_model(app: AppHandle, model: Option<String>) -> Result<(), LlmError> {
    let dir = config::app_studywiki_dir(&app).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
    let mut s = config::load_settings(&dir).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
    set_default_into(&mut s, model)?;
    config::save_settings(&dir, &s).map_err(|e| LlmError::new("INVALID_CONFIG", e))
}

/// 非流式 chat：endpointId + model 由前端路由，Rust 纯传输。
#[tauri::command]
pub fn llm_chat(app: AppHandle, req: ChatRequest) -> Result<ChatResponse, LlmError> {
    let dir = config::app_studywiki_dir(&app).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
    let s = config::load_settings(&dir).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
    let ep = find_endpoint(&s, &req.endpoint_id)?;
    chat_with(&chat_agent(), &ep, &req)
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
                content: "hi".into(),
            }],
            max_tokens: None,
            temperature: None,
        };
        let resp = chat_with(&agent(), &ep(&base, "secret-key"), &req).unwrap();
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
        };
        assert_eq!(
            chat_with(&agent(), &ep(&base, ""), &req).unwrap_err().code,
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
    fn upsert_preserves_existing_key_when_incoming_empty() {
        let mut s = Settings {
            version: 1,
            endpoints: vec![ep("https://h", "secret")],
            default_model: None,
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

    #[test]
    fn upsert_validation_errors_are_invalid_config_and_find_endpoint_miss() {
        let mut s = Settings {
            version: 1,
            endpoints: vec![],
            default_model: None,
        };
        assert_eq!(
            find_endpoint(&s, "nope").unwrap_err().code,
            "ENDPOINT_UNKNOWN"
        );
        let mut e = ep("https://h", "");
        e.id = String::new();
        assert_eq!(upsert_into(&mut s, e).unwrap_err().code, "INVALID_CONFIG");
    }
}
