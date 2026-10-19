# m3-01 音视频转录实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agent 新增 `transcribe` 工具：经用户显式配置的 kind=asr endpoint（transcriptions / chat 双协议）把库内音视频转录为带时间戳的 transcript.md，无 ASR 配置时工具不挂载、agent 行为零变化。

**Architecture:** 配置层给 asr endpoint 加 `protocol` 字段（缺省 transcriptions）→ Rust 新增 `llm_transcribe` 命令按 protocol 分叉（multipart 流式上传原文件 / 聊天口 input_audio）→ 宿主 `LlmService.transcribe` 只做 asr 路由 → agent-core 每回合按 `hasAsrCapability()` 动态挂载工具，审批单列一族，程序确定性格式化产物。

**Tech Stack:** Rust（ureq 2 阻塞 + spawn_blocking、serde_json、base64——全部既有依赖，零新增）、TS（宿主 facade + cordis 插件）、vitest、cargo test。

**Spec:** [plans/2026-10-19-asr-transcription-design.md](2026-10-19-asr-transcription-design.md)

## Global Constraints

- 零新增依赖：Rust 不加 crate（multipart 手构、JSON 用 serde_json），前端不加包。
- TS 导出与 Tauri 命令必须带文档注释（门禁校验）；提交信息中文、标题含 `(#32)`。
- 常驻文档中英成对：改任一侧最小修补另一侧并跑 `pnpm record:i18n -- <pair>`；plans/ 中文单语。
- markdown 段落一行到底、无尾随空白（pre-commit 钩子会拦）。
- key 永不出 Rust；前端只见脱敏投影。
- 路由隔离：聊天只认 kind=chat（既有 `#route` 已强制），转录只认 kind=asr；错误词表复用 MODEL_UNSPECIFIED / MODEL_UNKNOWN / MODEL_AMBIGUOUS / INVALID_CONFIG / UNSUPPORTED_CONTENT / UNAUTHORIZED_PATH / TIMEOUT / UNREACHABLE / BAD_RESPONSE。
- ureq 是阻塞调用：新命令必须 `async` + `spawn_blocking`（同 llm_chat 模式），否则会冻结主线程。

## Review Focus

1. verbose_json 响应缺 `segments` 字段或为空数组 → segments 置空、上层降级单段，不得解析报错——Task 4 钉住。
2. chat 路模型输出带开场白/闲聊导致 `[HH:MM:SS]` 行覆盖率 <80% → 整体降级 `timestamps: none`，不得产出半截时间戳文件——Task 7 钉住。
3. chat kind 的 endpoint 误带 `protocol` 字段 → 校验 `INVALID_CONFIG` fail-loud，不得静默忽略——Task 2 钉住。
4. 多条 asr endpoint 且未指定 model → `MODEL_AMBIGUOUS`，不得隐式选第一条——Task 6 钉住。
5. 会话进行中删除全部 ASR 配置 → 下一回合工具消失；模型若按历史 wire 仍发来 transcribe 调用 → 明确错误结果"当前未配置 ASR"，不得 panic/崩溃——Task 7 钉住。
6. MiMo 的 input_audio 要求 data 为 data URL 形（`data:audio/wav;base64,...`），仓内聊天附件是 raw base64 + format——chat 路发送 `data` 用 data URL 形且同带 `format` 字段，两者并存——Task 5 钉住请求体形状。

---

### Task 1: flow 状态推进 + issue scope 补登 + Agent Note（proposed）

**Files:**
- Modify: `.agents/flow/issues/m3-01-asr-transcription.md`（scope 补 `src-tauri/**`，status backlog → in_progress）
- Modify: `.agents/flow/issues/m3-01-asr-transcription.en.md`（同步英文侧）
- Create: `.agents/notes/proposed/architecture/2026-10-19-asr-dual-protocol.md` 与 `.en.md`
- Run: `pnpm record:i18n -- <pair>` 重录两个配对；`pnpm flow:sync` 推送 GitHub（需 gh 登录）

**Interfaces:**
- Produces: issue #32 进入 in_progress，后续所有提交标题含 `(#32)`。

- [ ] **Step 1: 更新 issue 三件套**

`.agents/flow/issues/m3-01-asr-transcription.md` 的 flow 块改为：

```yaml
kind: issue
milestone: m3
priority: P0
status: in_progress
scope:
  - src/plugins/**
  - src/host/**
  - src-tauri/**
  - docs/plugins/*
  - docs/architecture.*
```

`.en.md` 同步同样改动（英文侧文案不变，仅 flow 块）。

- [ ] **Step 2: 写 Agent Note（proposed，中英配对）**

`.agents/notes/proposed/architecture/2026-10-19-asr-dual-protocol.md`：

```markdown
# Agent Note: ASR 供给双协议：transcriptions 口与聊天口统一收编

Status: proposed

[English](2026-10-19-asr-dual-protocol.en.md) | 中文

## Problem

m3-01 要落地 ASR 转录，但 OpenAI 兼容 ASR 存在两种 wire 形状：转录口 `/v1/audio/transcriptions`（multipart + verbose_json 契约时间戳，Speaches/whisper.cpp 系）与聊天口 `chat/completions` + `input_audio`（小米 MiMo ASR 等，无契约时间戳）。同时要求：不配 ASR 时 agent 零变化；聊天模型（如 deepseek-v4-flash）不被转录误用。

## Decision

- ASR 模型独立成户：只在 `kind: asr` 的 endpoint 上配置，新增可选 `protocol` 字段（`transcriptions` 缺省 / `chat`）；聊天路由只认 kind=chat、转录路由只认 kind=asr，结构性隔离。
- 双协议统一返回 `TranscriptionResult { text, segments[] }`；chat 路无契约时间戳，由 TS 工具层按确定性规则（匹配行 ≥3 且覆盖 ≥80%）解析，失败降级单段 + `timestamps: none`。
- `transcribe` 工具按回合动态挂载：无 asr endpoint 时工具不进入声明清单，agent 行为零变化。
- 上传动作单列审批族 `transcribe`，一次审批同时覆盖上传与落盘。
- 客户端不做解码/分片/转码（ffmpeg 与环境无关性冲突）；视频容器原样上传，依赖服务端解码。

## Alternatives considered

- 借用 chat endpoint 的 audio 能力模型做 ASR：模糊聊天天职、模型清单互相污染；否。
- 只支持 transcriptions 口：MiMo ASR 等聊天口模型不可用；否。
- 无 ASR 时仍挂载工具并返回引导：模型空转一轮才能说出"请去配置"；由设置面板与文档承担引导，否。
- 客户端 ffmpeg 分片：违反环境无关性硬约束；否，本期超限明确报错。

## Consequences

- settings.json 兼容：protocol 为可缺省字段，版本号不动。
- chat 路 input_audio 采用 MiMo 文档形（data 为 data URL + format 双带），与仓内聊天附件的 raw base64 形不同——附件路不变。
- m3-03 的 raw 索引、m3-04 的本地 ASR 辅助不受本期约束。
```

`.en.md` 写对应英文版（逐段对应，标题 "Agent Note: Dual-protocol ASR supply: transcriptions endpoint and chat audio unified"）。

- [ ] **Step 3: 重录配对 + 推送**

```bash
pnpm record:i18n -- .agents/flow/issues/m3-01-asr-transcription.md
pnpm record:i18n -- .agents/notes/proposed/architecture/2026-10-19-asr-dual-protocol.md
pnpm flow:sync
```

预期：两条 record 输出 hash 更新；flow:sync 将 #32 状态推为 In Progress。

- [ ] **Step 4: 门禁**

```bash
pnpm verify:flow
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add .agents/flow/issues/m3-01-asr-transcription.md .agents/flow/issues/m3-01-asr-transcription.en.md .agents/flow/issues/m3-01-asr-transcription.i18n.yaml .agents/notes/proposed/architecture/2026-10-19-asr-dual-protocol.md .agents/notes/proposed/architecture/2026-10-19-asr-dual-protocol.en.md .agents/notes/proposed/architecture/2026-10-19-asr-dual-protocol.i18n.yaml
git commit -m "chore: m3-01 开工：issue 状态推进与双协议 ASR Note (#32)"
```

---

### Task 2: Rust config——endpoint `protocol` 字段

**Files:**
- Modify: `src-tauri/src/config.rs`（Endpoint 结构、validate_endpoint、redact 投影、tests）

**Interfaces:**
- Produces: `Endpoint.protocol: Option<String>`（serde 缺省 None）；校验规则：protocol 仅允许 `transcriptions`/`chat` 且仅允许出现在 kind=asr 上；`RedactedEndpoint` 投影带 `protocol`（camelCase wire）。Task 3/4/9 依赖。

- [ ] **Step 1: 写失败测试**

`src-tauri/src/config.rs` 的 `mod tests` 内追加：

```rust
#[test]
fn endpoint_protocol_roundtrips_and_defaults_to_none() {
    let mut e = sample_endpoint();
    e.kind = "asr".into();
    e.protocol = Some("chat".into());
    let json = serde_json::to_string(&e).unwrap();
    let back: Endpoint = serde_json::from_str(&json).unwrap();
    assert_eq!(back.protocol.as_deref(), Some("chat"));
    let legacy: Endpoint = serde_json::from_str(
        &json.replace(r#","protocol":"chat""#, ""),
    )
    .unwrap();
    assert_eq!(legacy.protocol, None);
}

#[test]
fn protocol_rejects_unknown_value_and_chat_kind() {
    let mut bad = sample_endpoint();
    bad.kind = "asr".into();
    bad.protocol = Some("websocket".into());
    assert!(validate_endpoint(&bad).is_err());
    let mut chat = sample_endpoint();
    chat.protocol = Some("chat".into());
    assert!(validate_endpoint(&chat).is_err());
    let mut ok = sample_endpoint();
    ok.kind = "asr".into();
    ok.protocol = Some("transcriptions".into());
    assert!(validate_endpoint(&ok).is_ok());
}
```

（`sample_endpoint()` 已在 config.rs tests 存在，直接复用；若其不含 protocol 字段则编译错即视为红灯。）

- [ ] **Step 2: 跑测试确认红**

```bash
cargo test --manifest-path src-tauri/Cargo.toml endpoint_protocol
cargo test --manifest-path src-tauri/Cargo.toml protocol_rejects
```

预期：编译失败（Endpoint 无 protocol 字段）。

- [ ] **Step 3: 实现**

`config.rs`：

```rust
/// 一条 endpoint 配置（chat = LLM/VLM 共用；asr = 转写）。
/// protocol 仅 asr 有意义：None/transcriptions = 转录口；chat = 聊天口 input_audio。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct Endpoint {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "apiKey", default)]
    pub api_key: String,
    /// ASR 接线协议：transcriptions（缺省）或 chat；chat kind 携带属配置错误。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    #[serde(default, rename = "apiKeyDirty", skip_serializing)]
    pub api_key_dirty: bool,
    #[serde(default)]
    pub models: Vec<ModelEntry>,
}
```

`validate_endpoint` 在 kind 校验后追加：

```rust
match e.protocol.as_deref() {
    None | Some("transcriptions") | Some("chat") => {}
    Some(other) => return Err(format!("protocol 只允许 transcriptions 或 chat：{other}")),
}
if e.kind == "chat" && e.protocol.is_some() {
    return Err("protocol 只允许出现在 kind=asr 的 endpoint 上".into());
}
```

`RedactedEndpoint` 增加字段（序列化 camelCase）：

```rust
/// ASR 接线协议投影（None = transcriptions 缺省）。
pub protocol: Option<String>,
```

`redact` 填充 `protocol: e.protocol.clone()`。config.rs 内其它构造 Endpoint 字面量处补 `protocol: None`（编译器会点名）。

- [ ] **Step 4: 跑测试确认绿**

```bash
cargo test --manifest-path src-tauri/Cargo.toml config
```

预期：PASS（含两条新测试与既有用例）。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/config.rs
git commit -m "feat: settings endpoint 增加 asr protocol 字段 (#32)"
```

---

### Task 3: Rust llm.rs——ASR 预设两条 + LlmPreset 扩展

**Files:**
- Modify: `src-tauri/src/llm.rs`（LlmPreset 结构、presets()、既有预设测试）

**Interfaces:**
- Consumes: Task 2 的 `Endpoint.protocol` 语义（预设仅提供模板值，不实例化）。
- Produces: `LlmPreset { vendor, name, baseUrl, kind, protocol?, models[] }`（camelCase wire）；预设新增 `speaches` 与 `mimo-asr` 两条 kind=asr。Task 9 的设置面板依赖 `kind`/`protocol` 预填。

- [ ] **Step 1: 改失败测试**

`llm.rs` 既有测试 `presets_cover_known_tool_models` 断言全量 id 列表，更新为含新预设模型，并新增：

```rust
#[test]
fn presets_include_asr_templates_with_protocol() {
    let table = presets();
    let speaches = table.iter().find(|p| p.vendor == "speaches").unwrap();
    assert_eq!(speaches.kind, "asr");
    assert_eq!(speaches.protocol, None);
    assert_eq!(speaches.base_url, "http://localhost:8000");
    assert_eq!(speaches.models[0].id, "whisper-large-v3");
    let mimo = table.iter().find(|p| p.vendor == "mimo-asr").unwrap();
    assert_eq!(mimo.kind, "asr");
    assert_eq!(mimo.protocol.as_deref(), Some("chat"));
    assert_eq!(mimo.base_url, "https://api.xiaomimimo.com/v1");
    assert_eq!(mimo.models[0].id, "mimo-v2.5-asr");
    assert!(table.iter().filter(|p| p.kind == "chat").count() >= 4);
}
```

`presets_cover_known_tool_models` 的期望 id 列表尾部追加 `"whisper-large-v3"`, `"mimo-v2.5-asr"`。

- [ ] **Step 2: 跑测试确认红**

```bash
cargo test --manifest-path src-tauri/Cargo.toml presets
```

预期：编译失败（LlmPreset 无 kind/protocol 字段）或断言失败。

- [ ] **Step 3: 实现**

```rust
/// 构建期厂商预设（模板：用户实例化后可改模型清单；baseUrl 只存在于本文件）。
/// kind 区分 chat/asr 预设；protocol 仅 asr 模板携带（None = transcriptions）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmPreset {
    pub vendor: String,
    pub name: String,
    pub base_url: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    pub models: Vec<ModelEntry>,
}
```

`presets()` 既有四条补 `kind: "chat".into(), protocol: None`，尾部追加：

```rust
LlmPreset {
    vendor: "speaches".into(),
    name: "Speaches（自托管 ASR）".into(),
    base_url: "http://localhost:8000".into(),
    kind: "asr".into(),
    protocol: None,
    models: vec![m("whisper-large-v3", &[])],
},
LlmPreset {
    vendor: "mimo-asr".into(),
    name: "小米 MiMo ASR".into(),
    base_url: "https://api.xiaomimimo.com/v1".into(),
    kind: "asr".into(),
    protocol: Some("chat".into()),
    models: vec![m("mimo-v2.5-asr", &[])],
},
```

- [ ] **Step 4: 跑测试确认绿**

```bash
cargo test --manifest-path src-tauri/Cargo.toml presets
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/llm.rs
git commit -m "feat: 预设表新增 Speaches 与小米 MiMo ASR 两条 asr 模板 (#32)"
```

---

### Task 4: Rust `llm_transcribe`——transcriptions 路

**Files:**
- Modify: `src-tauri/src/llm.rs`（请求/结果类型、multipart 构建、命令、tests）
- Modify: `src-tauri/src/lib.rs:730` 附近（invoke_handler 注册）

**Interfaces:**
- Consumes: Task 2 的 `Endpoint.protocol`；既有 `find_endpoint`/`join_url`/`with_auth`/`map_transport`/`mock_server` 测试件。
- Produces（wire 契约，Task 6 消费）：命令 `llm_transcribe`，入参 `{ req: { endpointId, model, path, language? } }`，返回 `TranscriptionResult { text: string, segments: [{ start: number, end: number, text: string }] }`（segments 可为空数组）。错误：kind 非 asr → INVALID_CONFIG；path 越界 → UNAUTHORIZED_PATH；传输错误按 map_transport 词表。

- [ ] **Step 1: 写失败测试**

`llm.rs` tests 内追加：

```rust
/// multipart 体包含全部字段与文件名，boundary 一致闭合。
#[test]
fn multipart_head_contains_fields_and_filename() {
    let (head, boundary) = build_multipart_head(
        &[
            ("model", "whisper-large-v3"),
            ("response_format", "verbose_json"),
            ("timestamp_granularities[]", "segment"),
            ("language", "zh"),
        ],
        "lecture-01.mp4",
    );
    let text = String::from_utf8(head).unwrap();
    assert!(text.contains(&format!("--{boundary}")));
    assert!(text.contains(r#"name="model""#));
    assert!(text.contains("whisper-large-v3"));
    assert!(text.contains(r#"name="timestamp_granularities[]""#));
    assert!(text.contains(r#"name="file"; filename="lecture-01.mp4""#));
}

/// verbose_json 正常解析；缺 segments 字段 → 空数组（上层降级），不报错。
#[test]
fn verbose_json_parses_segments_and_tolerates_absence() {
    let full: WireTranscription = serde_json::from_str(
        r#"{"text":"全文","segments":[{"start":0.0,"end":4.2,"text":"第一句"}]}"#,
    )
    .unwrap();
    assert_eq!(full.segments.len(), 1);
    assert!((full.segments[0].end - 4.2).abs() < 1e-6);
    let bare: WireTranscription = serde_json::from_str(r#"{"text":"全文"}"#).unwrap();
    assert!(bare.segments.is_empty());
}

/// mock 服务器端到端：请求是 multipart 且带 Authorization；200 回包映射为结果。
#[test]
fn transcribe_transcriptions_route_roundtrip() {
    let (url, rx) = mock_server(
        200,
        r#"{"text":"今天我们讲二叉树","segments":[{"start":0.0,"end":4.2,"text":"今天我们讲二叉树"}]}"#,
    );
    let mut ep = sample_endpoint();
    ep.kind = "asr".into();
    ep.base_url = url;
    let dir = std::env::temp_dir().join(format!("sw-asr-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let media = dir.join("a.wav");
    std::fs::write(&media, b"RIFFfake").unwrap();
    let req = TranscribeRequest {
        endpoint_id: ep.id.clone(),
        model: "whisper-large-v3".into(),
        path: media.to_string_lossy().to_string(),
        language: Some("zh".into()),
    };
    let root = dir.to_string_lossy().to_string();
    let result = run_transcribe(&transcribe_agent(), &ep, &req, &|p| p.starts_with(&root)).unwrap();
    assert_eq!(result.segments.len(), 1);
    let sent = rx.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(sent.contains("multipart/form-data; boundary="));
    assert!(sent.contains("Authorization: Bearer"));
    assert!(sent.contains("verbose_json"));
    std::fs::remove_dir_all(&dir).ok();
}

/// kind=chat 的 endpoint 被拒绝；越界路径被拒绝。
#[test]
fn transcribe_rejects_chat_endpoint_and_outside_path() {
    let ep = sample_endpoint(); // kind=chat
    let req = TranscribeRequest {
        endpoint_id: ep.id.clone(),
        model: "x".into(),
        path: "/tmp/a.wav".into(),
        language: None,
    };
    let err = transcribe_checked(&transcribe_agent(), &ep, &req, &|_| true).unwrap_err();
    assert_eq!(err.code, "INVALID_CONFIG");
    let mut ep2 = sample_endpoint();
    ep2.kind = "asr".into();
    let err2 = transcribe_checked(&transcribe_agent(), &ep2, &req, &|_| false).unwrap_err();
    assert_eq!(err2.code, "UNAUTHORIZED_PATH");
}
```

- [ ] **Step 2: 跑测试确认红**

```bash
cargo test --manifest-path src-tauri/Cargo.toml multipart_head
cargo test --manifest-path src-tauri/Cargo.toml transcribe
```

预期：编译失败（类型/函数不存在）。

- [ ] **Step 3: 实现**

`llm.rs` 顶部常量区追加：

```rust
/// 转录独立超时：长视频分钟级，不可复用 chat 300s。
const TRANSCRIBE_TIMEOUT: Duration = Duration::from_secs(1800);
/// 转录 multipart 的边界标记（固定值即可：body 内容由本函数独家组装，不存在注入面）。
const MULTIPART_BOUNDARY: &str = "swasr7f3a9d21c4e8b6f0a5c3d2e190";
```

类型与构建（放在 presets() 之后）：

```rust
/// 转录请求（IPC 入线）：endpointId + model 由前端 asr 路由解析；path 为库根内媒体绝对路径。
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    pub endpoint_id: String,
    pub model: String,
    pub path: String,
    #[serde(default)]
    pub language: Option<String>,
}

/// 一段时间戳段（秒，浮点）。
#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq)]
pub struct TranscriptionSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// 转录统一结果：segments 为空数组表示服务端未给时间戳（上层降级单段）。
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TranscriptionResult {
    pub text: String,
    pub segments: Vec<TranscriptionSegment>,
}

/// verbose_json 回包子集；segments 缺席容忍为空。
#[derive(Debug, serde::Deserialize)]
struct WireTranscription {
    text: String,
    #[serde(default)]
    segments: Vec<TranscriptionSegment>,
}

/// multipart 头部（file part 之前的全部字段 + file 头）；body = head + 文件字节 + 尾。
fn build_multipart_head(fields: &[(&str, &str)], file_name: &str) -> (Vec<u8>, &'static str) {
    let mut out = Vec::new();
    for (name, value) in fields {
        out.extend_from_slice(
            format!(
                "--{MULTIPART_BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            )
            .as_bytes(),
        );
    }
    out.extend_from_slice(
        format!(
            "--{MULTIPART_BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        )
        .as_bytes(),
    );
    (out, MULTIPART_BOUNDARY)
}

/// multipart 收尾。
fn multipart_tail() -> Vec<u8> {
    format!("--{MULTIPART_BOUNDARY}--\r\n").into_bytes()
}

/// 转录专用 agent：30 分钟超时。
fn transcribe_agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(TRANSCRIBE_TIMEOUT).build()
}
```

执行函数（供命令与测试共用）：

```rust
/// 门禁后的转录入口：kind 必须 asr；path 必须在库根内；按 protocol 分叉。
fn transcribe_checked(
    agent: &ureq::Agent,
    ep: &Endpoint,
    req: &TranscribeRequest,
    root_check: &dyn Fn(&str) -> bool,
) -> Result<TranscriptionResult, LlmError> {
    if ep.kind != "asr" {
        return Err(LlmError::new("INVALID_CONFIG", "转录只接受 kind=asr 的 endpoint"));
    }
    if !root_check(&req.path) {
        return Err(LlmError::new("UNAUTHORIZED_PATH", format!("转录文件不在库根内：{}", req.path)));
    }
    match ep.protocol.as_deref() {
        Some("chat") => run_transcribe_chat(agent, ep, req),
        _ => run_transcribe(agent, ep, req, root_check),
    }
}

/// transcriptions 路：multipart 流式上传原文件（视频容器原样，依赖服务端解码）。
fn run_transcribe(
    agent: &ureq::Agent,
    ep: &Endpoint,
    req: &TranscribeRequest,
    _root_check: &dyn Fn(&str) -> bool,
) -> Result<TranscriptionResult, LlmError> {
    let file = std::fs::File::open(&req.path)
        .map_err(|e| LlmError::new("UNSUPPORTED_CONTENT", format!("转录文件读取失败：{e}")))?;
    let file_len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let file_name = std::path::Path::new(&req.path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "audio.bin".into());
    let mut fields: Vec<(&str, &str)> = vec![
        ("model", req.model.as_str()),
        ("response_format", "verbose_json"),
        ("timestamp_granularities[]", "segment"),
    ];
    if let Some(language) = &req.language {
        fields.push(("language", language.as_str()));
    }
    let (head, boundary) = build_multipart_head(&fields, &file_name);
    let tail = multipart_tail();
    let total = head.len() as u64 + file_len + tail.len() as u64;
    let body = std::io::Cursor::new(head).chain(file).chain(std::io::Cursor::new(tail));
    let url = join_url(&ep.base_url, "audio/transcriptions");
    let resp = with_auth(agent.post(&url), ep)
        .set("Content-Type", &format!("multipart/form-data; boundary={boundary}"))
        .set("Content-Length", &total.to_string())
        .send(body)
        .map_err(map_transport)?;
    let wire: WireTranscription = serde_json::from_reader(resp.into_reader())
        .map_err(|e| LlmError::new("BAD_RESPONSE", format!("转录响应不是合法 verbose_json：{e}")))?;
    Ok(TranscriptionResult { text: wire.text, segments: wire.segments })
}
```

命令（async + spawn_blocking，同 llm_chat 模式）：

```rust
/// 转录：只认 kind=asr 的 endpoint，按 protocol 分叉；path 必须在已打开库根内。
#[tauri::command]
pub async fn llm_transcribe(
    app: AppHandle,
    reg: tauri::State<'_, Mutex<crate::windows::WindowRegistry>>,
    req: TranscribeRequest,
) -> Result<TranscriptionResult, LlmError> {
    let roots_ok = {
        let reg = reg.lock().unwrap();
        reg.roots().iter().map(|p| p.to_string_lossy().to_string()).collect::<Vec<_>>()
    };
    tauri::async_runtime::spawn_blocking(move || {
        let dir = config::app_studywiki_dir(&app).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
        let s = config::load_settings(&dir).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
        let ep = find_endpoint(&s, &req.endpoint_id)?;
        let root_check = |p: &str| crate::windows::path_under_roots(&roots_ok, p);
        transcribe_checked(&transcribe_agent(), &ep, &req, &root_check)
    })
    .await
    .map_err(|e| LlmError::new("INTERNAL", format!("转录后台任务异常终止：{e}")))?
}
```

`src-tauri/src/lib.rs` 的 invoke_handler 清单在 `llm::llm_chat_abort` 前加一行 `llm::llm_transcribe,`（注意清单尾项逗号调整）。

注意：`transcribe_rejects_chat_endpoint_and_outside_path` 引用的 `sample_endpoint()` 若只在 config.rs tests 可见，则在 llm.rs tests 内自建等价 helper（文件已有类似构造，沿用现有写法）。

- [ ] **Step 4: 跑测试确认绿**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

预期：PASS 全量（含既有用例）。ureq 2 的 `Request::send(reader: impl Read)` 用于流式上传；若编译器提示 send 签名不符，改查 ureq 2 文档用法 `send(body)` 并接受 `impl Read`，不得退回 `send_bytes` 全量读内存（200MB 视频）。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/llm.rs src-tauri/src/lib.rs
git commit -m "feat: llm_transcribe 命令 transcriptions 路（multipart 流式上传 + verbose_json） (#32)"
```

---

### Task 5: Rust `llm_transcribe`——chat 路

**Files:**
- Modify: `src-tauri/src/llm.rs`（run_transcribe_chat + tests）

**Interfaces:**
- Consumes: Task 4 的 `TranscribeRequest`/`TranscriptionResult`/`transcribe_checked` 分叉点；既有 `WireChat` 解析、`audio_format` mime 门禁。
- Produces: chat 路完整可用；请求体形状 `messages=[{role:"user", content:[{type:"text",text:指令},{type:"input_audio",input_audio:{data:"data:<mime>;base64,...",format:"wav|mp3"}}]}]`，非流式，复用聊天超时 agent（chat_agent()）。

- [ ] **Step 1: 写失败测试**

```rust
/// chat 路请求体：data 为 data URL 形且同带 format（MiMo 文档形）；响应映射 text、segments 为空。
#[test]
fn transcribe_chat_route_body_and_result() {
    let (url, rx) = mock_server(
        200,
        r#"{"choices":[{"message":{"content":"[00:00:00] 你好"},"finish_reason":"stop"}]}"#,
    );
    let mut ep = sample_endpoint();
    ep.kind = "asr".into();
    ep.protocol = Some("chat".into());
    ep.base_url = url;
    let dir = std::env::temp_dir().join(format!("sw-asr-chat-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let media = dir.join("a.wav");
    std::fs::write(&media, b"RIFFfake").unwrap();
    let req = TranscribeRequest {
        endpoint_id: ep.id.clone(),
        model: "mimo-v2.5-asr".into(),
        path: media.to_string_lossy().to_string(),
        language: Some("zh".into()),
    };
    let result = run_transcribe_chat(&chat_agent(), &ep, &req).unwrap();
    assert_eq!(result.text, "[00:00:00] 你好");
    assert!(result.segments.is_empty());
    let sent = rx.recv_timeout(Duration::from_secs(2)).unwrap();
    assert!(sent.contains(r#""type":"input_audio""#));
    assert!(sent.contains("data:audio/wav;base64,"));
    assert!(sent.contains(r#""format":"wav""#));
    assert!(sent.contains("[HH:MM:SS]"));
    std::fs::remove_dir_all(&dir).ok();
}

/// chat 路只接 wav/mp3；超限拒绝。
#[test]
fn transcribe_chat_rejects_unsupported_ext_and_oversize() {
    let mut ep = sample_endpoint();
    ep.kind = "asr".into();
    ep.protocol = Some("chat".into());
    let req = TranscribeRequest {
        endpoint_id: ep.id.clone(),
        model: "mimo-v2.5-asr".into(),
        path: "/tmp/a.mp4".into(),
        language: None,
    };
    let err = run_transcribe_chat(&chat_agent(), &ep, &req).unwrap_err();
    assert_eq!(err.code, "UNSUPPORTED_CONTENT");
}
```

- [ ] **Step 2: 跑测试确认红**

```bash
cargo test --manifest-path src-tauri/Cargo.toml transcribe_chat
```

预期：编译失败（run_transcribe_chat 不存在）。

- [ ] **Step 3: 实现**

```rust
/// chat 路转录指令：要求逐行 [HH:MM:SS] 输出，只输出转录行。
const TRANSCRIBE_CHAT_INSTRUCTION: &str =
    "请将音频转录为逐行文本，每行格式严格为 [HH:MM:SS] 空格 文本；只输出转录行，不要任何解释、标题或开场白。";

/// chat 路：音频 base64 进 input_audio（wav/mp3、20MB 上限，与附件同门禁语义）。
fn run_transcribe_chat(
    agent: &ureq::Agent,
    ep: &Endpoint,
    req: &TranscribeRequest,
) -> Result<TranscriptionResult, LlmError> {
    let ext = std::path::Path::new(&req.path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        _ => {
            return Err(LlmError::new(
                "UNSUPPORTED_CONTENT",
                format!("聊天口转录仅支持 wav/mp3：{ext}（视频与无损格式请改用 transcriptions 协议的 endpoint）"),
            ))
        }
    };
    let bytes = std::fs::read(&req.path)
        .map_err(|e| LlmError::new("UNSUPPORTED_CONTENT", format!("转录文件读取失败：{e}")))?;
    if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err(LlmError::new(
            "UNSUPPORTED_CONTENT",
            format!("转录文件超过大小上限 {MAX_ATTACHMENT_BYTES} 字节（聊天口与附件同限；请改用 transcriptions 协议的 endpoint）"),
        ));
    }
    let data_url = format!("data:{mime};base64,{}", base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD, &bytes,
    ));
    let instruction = match &req.language {
        Some(language) => format!("{TRANSCRIBE_CHAT_INSTRUCTION}语种：{language}。"),
        None => TRANSCRIBE_CHAT_INSTRUCTION.to_string(),
    };
    let body = serde_json::json!({
        "model": req.model,
        "stream": false,
        "messages": [{
            "role": "user",
            "content": [
                { "type": "text", "text": instruction },
                { "type": "input_audio", "input_audio": {
                    "data": data_url,
                    "format": audio_format(mime)?,
                }},
            ],
        }],
    });
    let url = join_url(&ep.base_url, "chat/completions");
    let resp = with_auth(agent.post(&url), ep)
        .set("Content-Type", "application/json")
        .send_bytes(body.to_string().as_bytes())
        .map_err(map_transport)?;
    let wire: WireChat = serde_json::from_reader(resp.into_reader()).map_err(|e| {
        LlmError::new("BAD_RESPONSE", format!("响应不是合法 chat/completions 回包：{e}"))
    })?;
    let choice = wire.choices.first()
        .ok_or_else(|| LlmError::new("BAD_RESPONSE", "choices 为空"))?;
    let text = choice.message.content.as_str()
        .ok_or_else(|| LlmError::new("BAD_RESPONSE", "content 不是字符串"))?
        .to_string();
    Ok(TranscriptionResult { text, segments: Vec::new() })
}
```

（`chat_agent()` 是既有聊天超时 agent 工厂；`audio_format` 既有。）

- [ ] **Step 4: 跑测试确认绿**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

预期：PASS 全量。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/llm.rs
git commit -m "feat: llm_transcribe chat 路（input_audio data URL + 逐行时间戳指令） (#32)"
```

---

### Task 6: 宿主 LlmService——transcribe 路由 + hasAsrCapability

**Files:**
- Modify: `src/host/llm.ts`（类型 + 两个方法）
- Test: `tests/host-llm.test.ts`

**Interfaces:**
- Consumes: Task 4 的 wire 契约（`llm_transcribe` 入参/返回）。
- Produces（Task 7 消费）：`TranscriptionSegment { start: number; end: number; text: string }`；`TranscriptionResult { text: string; segments: TranscriptionSegment[] }`；`LlmService.transcribe(req: { path: string; language?: string; model?: string }): Promise<TranscriptionResult>`；`LlmService.hasAsrCapability(): Promise<boolean>`。`RedactedEndpoint`/`EndpointInput`/`LlmPreset` 投影带 `protocol?: string | null`，`LlmPreset` 另带 `kind: string`。

- [ ] **Step 1: 写失败测试**

`tests/host-llm.test.ts` 追加 describe 块（fake invoke 模式沿用既有 `depsWith`）：

```ts
describe("LlmService transcribe", () => {
  const asrRedacted = {
    endpoints: [
      { id: "nas", name: "NAS", kind: "asr", baseUrl: "http://192.168.1.10:8000", vendor: "speaches",
        hasKey: false, keyPreview: "", protocol: null, models: [{ id: "whisper-large-v3", capabilities: [] }] },
    ],
    defaultModel: null,
  };

  it("routes to the sole asr endpoint and forwards llm_transcribe args", async () => {
    const calls: { cmd: string; args?: unknown }[] = [];
    const llm = new LlmService({
      invoke: (cmd, args) => {
        calls.push({ cmd, args });
        if (cmd === "llm_list_endpoints") return Promise.resolve(asrRedacted);
        if (cmd === "llm_transcribe") return Promise.resolve({ text: "全文", segments: [{ start: 0, end: 4.2, text: "第一句" }] });
        return Promise.resolve(null);
      },
    });
    const r = await llm.transcribe({ path: "/lib/a.mp4", language: "zh" });
    expect(r.segments).toHaveLength(1);
    expect(calls.at(-1)).toMatchObject({
      cmd: "llm_transcribe",
      args: { req: { endpointId: "nas", model: "whisper-large-v3", path: "/lib/a.mp4", language: "zh" } },
    });
  });

  it("reports MODEL_AMBIGUOUS with multiple asr endpoints and no model", async () => {
    const two = { endpoints: [...asrRedacted.endpoints,
      { ...asrRedacted.endpoints[0]!, id: "mimo", models: [{ id: "mimo-v2.5-asr", capabilities: [] }] }], defaultModel: null };
    const llm = new LlmService({ invoke: (cmd) =>
      cmd === "llm_list_endpoints" ? Promise.resolve(two) : Promise.resolve(null) });
    await expect(llm.transcribe({ path: "/lib/a.mp4" })).rejects.toMatchObject({ code: "MODEL_AMBIGUOUS" });
    await expect(llm.transcribe({ path: "/lib/a.mp4", model: "mimo-v2.5-asr" })).resolves.toBeDefined();
  });

  it("reports MODEL_UNKNOWN when no asr endpoint owns the model / none configured", async () => {
    const llm = new LlmService({ invoke: (cmd) =>
      cmd === "llm_list_endpoints" ? Promise.resolve({ endpoints: [], defaultModel: null }) : Promise.resolve(null) });
    await expect(llm.transcribe({ path: "/lib/a.mp4" })).rejects.toMatchObject({ code: "MODEL_UNKNOWN" });
  });

  it("hasAsrCapability reflects asr endpoints with models", async () => {
    const yes = new LlmService({ invoke: (cmd) =>
      cmd === "llm_list_endpoints" ? Promise.resolve(asrRedacted) : Promise.resolve(null) });
    await expect(yes.hasAsrCapability()).resolves.toBe(true);
    const no = new LlmService({ invoke: (cmd) =>
      cmd === "llm_list_endpoints" ? Promise.resolve({ endpoints: [], defaultModel: null }) : Promise.resolve(null) });
    await expect(no.hasAsrCapability()).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

```bash
pnpm exec vitest run tests/host-llm.test.ts
```

预期：FAIL（transcribe/hasAsrCapability 不存在）。

- [ ] **Step 3: 实现**

`src/host/llm.ts`：

```ts
/** 一段时间戳段（秒）。 */
export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

/** 转录统一结果：segments 空数组表示无时间戳（调用方降级单段）。 */
export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
}
```

`RedactedEndpoint` 增 `protocol?: string | null`；`EndpointInput` 增 `protocol?: string | null`；`LlmPreset` 增 `kind: string` 与 `protocol?: string | null`。

`LlmService` 内追加：

```ts
/** 解析转录模型归属：只路由 asr 类 endpoint，chat 配置不得误入转录命令。
 * @throws LlmError MODEL_UNKNOWN（无归属或无配置）/ MODEL_AMBIGUOUS（多归属或多候选未点名）。 */
async #routeAsr(model?: string): Promise<{ endpointId: string; model: string }> {
  const settings = await this.listEndpoints();
  const asr = settings.endpoints.filter((e) => e.kind === "asr" && e.models.length > 0);
  if (model) {
    const owners = asr.filter((e) => e.models.some((m) => m.id === model));
    if (owners.length === 0) throw new LlmError("MODEL_UNKNOWN", `未找到 ASR 模型：${model}`);
    if (owners.length > 1) {
      throw new LlmError("MODEL_AMBIGUOUS", `模型 ${model} 同时属于 ${owners.map((e) => e.id).join(", ")}`);
    }
    return { endpointId: owners[0]!.id, model };
  }
  const candidates = asr.flatMap((e) => e.models.map((m) => ({ endpointId: e.id, model: m.id })));
  if (candidates.length === 0) throw new LlmError("MODEL_UNKNOWN", "未配置 ASR endpoint");
  if (candidates.length > 1) {
    throw new LlmError("MODEL_AMBIGUOUS", `存在多个 ASR 模型，请指定 model：${candidates.map((c) => c.model).join(", ")}`);
  }
  return candidates[0]!;
}

/** 转录库根内音视频：Rust 侧按 endpoint protocol 分叉执行，本层只做 asr 路由。
 * @throws LlmError 路由 MODEL_* 与传输词表原样透传。 */
async transcribe(req: { path: string; language?: string; model?: string }): Promise<TranscriptionResult> {
  const { endpointId, model } = await this.#routeAsr(req.model);
  return this.#call<TranscriptionResult>("llm_transcribe", {
    req: { endpointId, model, path: req.path, ...(req.language ? { language: req.language } : {}) },
  });
}

/** 是否存在至少一条带模型的 asr endpoint（agent 工具动态挂载依据）。 */
async hasAsrCapability(): Promise<boolean> {
  const settings = await this.listEndpoints();
  return settings.endpoints.some((e) => e.kind === "asr" && e.models.length > 0);
}
```

- [ ] **Step 4: 跑测试确认绿**

```bash
pnpm exec vitest run tests/host-llm.test.ts
```

预期：PASS。注意 `protocol: null` 与缺省两种投影都要能被 `EndpointInput` 接受（upsert 时透传）。

- [ ] **Step 5: Commit**

```bash
git add src/host/llm.ts tests/host-llm.test.ts
git commit -m "feat: LlmService 增加 transcribe 路由与 hasAsrCapability (#32)"
```

---

### Task 7: agent-core——transcribe 工具 + 动态挂载

**Files:**
- Create: `src/plugins/agent-core/transcribe.ts`（声明 + 格式化纯函数 + 执行）
- Modify: `src/plugins/agent-core/tools.ts`（ApprovalRequest.kind 增 transcribe、executeTool 接线、ToolRunContext 增 transcribe hook）
- Modify: `src/plugins/agent-core/service.ts`（每回合动态组工具清单 + 注入 transcribe hook）
- Modify: `src/plugins/agent-core/types.ts:65`（approval 日志 kind 联合增 transcribe）
- Test: `tests/agent-tools.test.ts`、`tests/agent-service.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `TranscriptionResult`/`transcribe`/`hasAsrCapability`；files facade 的 `probeSourceFile`（ProbeSample.size）。
- Produces: `TRANSCRIBE_DECLARATION: ToolDeclaration`；`formatTranscript(input: TranscriptInput): string`；`parseTimestampedLines(text: string): { start: number; text: string }[]`；`transcriptOutputPath(root: string, sourcePath: string): string`；`type TranscribeHook = { probeSize(path: string): Promise<number>; run(req: { path: string; language?: string; model?: string }): Promise<TranscriptionResult> }`；`ToolRunContext.transcribe?: TranscribeHook`。

- [ ] **Step 1: 写失败测试**

`tests/agent-tools.test.ts` 追加：

```ts
describe("transcribe 工具", () => {
  const hookOk = {
    probeSize: async () => 2048,
    run: async () => ({ text: "全文", segments: [
      { start: 0, end: 4.2, text: "今天我们讲二叉树" },
      { start: 4.2, end: 9.8, text: "它的定义是" },
    ] }),
  };

  it("审批→执行→格式化落盘→摘要", async () => {
    const writes: string[] = [];
    const ctx = ctxWith({ writeText: async (p, c) => { writes.push(`${p}\n${c}`); } });
    ctx.transcribe = hookOk;
    const r = await executeTool({ id: "t1", name: "transcribe",
      argumentsText: JSON.stringify({ path: "/lib/courses/lecture-01.mp4", language: "zh" }) }, ctx);
    expect(ctx.asked).toEqual(["transcribe"]);
    expect(writes).toHaveLength(1);
    const [path, content] = writes[0]!.split("\n", 2);
    expect(path).toBe("/lib/.study-wiki/raw/courses/lecture-01/transcript.md");
    expect(content).toContain("source: courses/lecture-01.mp4");
    expect(content).toContain("timestamps: segment");
    expect(content).toContain("[00:00:00] 今天我们讲二叉树");
    expect(content).toContain("[00:00:04] 它的定义是");
    expect(r.content).toContain("2 段");
  });

  it("审批拒绝不上传", async () => {
    let ran = false;
    const ctx = ctxWith({}, { decision: "deny", reason: "不要上传" });
    ctx.transcribe = { probeSize: async () => 1, run: async () => { ran = true; return { text: "", segments: [] }; } };
    const r = await executeTool({ id: "t1", name: "transcribe",
      argumentsText: JSON.stringify({ path: "/lib/a.mp4" }) }, ctx);
    expect(ran).toBe(false);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("不要上传");
  });

  it("无时间戳回包降级单段并标注 timestamps: none", async () => {
    const writes: string[] = [];
    const ctx = ctxWith({ writeText: async (p, c) => { writes.push(c); } });
    ctx.transcribe = { probeSize: async () => 1, run: async () => ({ text: "一整段没有分段的文本", segments: [] }) };
    await executeTool({ id: "t1", name: "transcribe", argumentsText: JSON.stringify({ path: "/lib/a.mp4" }) }, ctx);
    expect(writes[0]).toContain("timestamps: none");
    expect(writes[0]).toContain("一整段没有分段的文本");
    expect(writes[0]).not.toContain("[00:00:");
  });

  it("chat 路文本按 80% 覆盖规则解析；不足则降级", async () => {
    const good = "[00:00:00] 第一句\n[00:00:04] 第二句\n[00:00:09] 第三句";
    const parsed = parseTimestampedLines(good);
    expect(parsed).toHaveLength(3);
    const writes: string[] = [];
    const ctx = ctxWith({ writeText: async (_p, c) => { writes.push(c); } });
    ctx.transcribe = { probeSize: async () => 1, run: async () => ({ text: `好的，以下是转录：\n[00:00:00] 短`, segments: [] }) };
    await executeTool({ id: "t1", name: "transcribe", argumentsText: JSON.stringify({ path: "/lib/a.mp4" }) }, ctx);
    expect(writes[0]).toContain("timestamps: none");
  });

  it("未注入 transcribe hook 时明确报错（配置被删的会话中途场景）", async () => {
    const ctx = ctxWith({});
    const r = await executeTool({ id: "t1", name: "transcribe", argumentsText: JSON.stringify({ path: "/lib/a.mp4" }) }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("未配置 ASR");
  });

  it("扩展名白名单预检", async () => {
    const ctx = ctxWith({});
    ctx.transcribe = hookOk;
    const r = await executeTool({ id: "t1", name: "transcribe", argumentsText: JSON.stringify({ path: "/lib/a.txt" }) }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content).toContain("不支持");
  });
});
```

`tests/agent-service.test.ts` 追加动态挂载两态（沿用既有 service 装配 fake）：

```ts
it("无 asr endpoint 时工具清单不含 transcribe；有则含", async () => {
  // 既有 fake llm 上加 hasAsrCapability: async () => false / true 两态，
  // 打开会话 send 一轮，断言 chatStream 收到的 tools 名单。
});
```

（agent-service.test.ts 已有会话装配模式；按其现有 fake 结构补 `hasAsrCapability` 即可，断言 `tools.map(t => t.name)`。）

- [ ] **Step 2: 跑测试确认红**

```bash
pnpm exec vitest run tests/agent-tools.test.ts tests/agent-service.test.ts
```

预期：FAIL（transcribe 工具/hook 不存在）。

- [ ] **Step 3: 实现**

新建 `src/plugins/agent-core/transcribe.ts`：

```ts
import type { ToolDeclaration, TranscriptionResult } from "../../host/llm";

/** 转录执行挂点：由宿主装配（探测大小 + 调 LlmService.transcribe）。 */
export interface TranscribeHook {
  /** 探测文件字节数（审批卡展示用）。 */
  probeSize(path: string): Promise<number>;
  /** 执行转录；路由与传输错误原样抛出。 */
  run(req: { path: string; language?: string; model?: string }): Promise<TranscriptionResult>;
}

/** transcribe 工具的上游声明。 */
export const TRANSCRIBE_DECLARATION: ToolDeclaration = {
  name: "transcribe",
  description: "把库根内音视频文件上传到用户配置的 ASR endpoint 转录，产出带时间戳的 transcript.md；需用户批准。",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "库根内音视频文件的绝对路径" },
      language: { type: "string", description: "语种 ISO 码（如 zh/en），缺省自动检测" },
      model: { type: "string", description: "ASR 模型 id；多个 ASR endpoint 时必传" },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

/** 允许转录的扩展名（宽松预检；chat 路的 wav/mp3 限制由 Rust 侧硬门禁）。 */
const MEDIA_EXTENSIONS = new Set(["mp4", "mkv", "mov", "webm", "mp3", "wav", "m4a", "flac", "ogg"]);

/** 秒 → HH:MM:SS（floor 到整数秒，与 wiki 时间戳区间格式同源）。 */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/** 解析 chat 路文本的 `[HH:MM:SS] 文本` 行；不含匹配行时返回空数组。 */
export function parseTimestampedLines(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\[(\d{1,3}):(\d{2}):(\d{2})\]\s+(.+)$/u);
    if (!match) continue;
    const [, h, m, s, body] = match;
    out.push({ start: Number(h) * 3600 + Number(m) * 60 + Number(s), text: body!.trim() });
  }
  return out;
}

/** 产物落点：.study-wiki/raw/<源库相对路径去扩展名>/transcript.md。 */
export function transcriptOutputPath(root: string, sourcePath: string): string {
  const rel = sourcePath.startsWith(`${root}/`) ? sourcePath.slice(root.length + 1) : sourcePath;
  const noExt = rel.replace(/\.[^./\\]+$/u, "");
  return `${root}/.study-wiki/raw/${noExt}/transcript.md`;
}

/** 格式化输入。 */
export interface TranscriptInput {
  /** 源文件库相对路径。 */
  sourceRel: string;
  /** 源文件名（标题用）。 */
  fileName: string;
  /** 执行模型 id。 */
  model: string;
  /** 语种参数或 auto。 */
  language: string;
  /** 生成时刻 ISO 字符串。 */
  generatedAt: string;
  /** 转录原始结果。 */
  result: TranscriptionResult;
}

/** 确定性格式化 transcript.md：segments 优先；纯文本按 ≥3 行且覆盖 ≥80% 规则解析；否则降级单段。 */
export function formatTranscript(input: TranscriptInput): string {
  let segments = input.result.segments;
  let timestampMode = "segment";
  if (segments.length === 0) {
    const parsed = parseTimestampedLines(input.result.text);
    const covered = parsed.reduce((sum, p) => sum + p.text.length, 0);
    if (parsed.length >= 3 && covered >= input.result.text.length * 0.8) {
      segments = parsed.map((p, i) => ({ start: p.start, end: parsed[i + 1]?.start ?? p.start, text: p.text }));
    } else {
      timestampMode = "none";
    }
  }
  const header = [
    "---",
    `source: ${input.sourceRel}`,
    `model: ${input.model}`,
    `language: ${input.language}`,
    `generated: ${input.generatedAt}`,
    `timestamps: ${timestampMode}`,
    "---",
    "",
    `# 转录：${input.fileName}`,
    "",
  ].join("\n");
  if (timestampMode === "none") return `${header}${input.result.text.trim()}\n`;
  const lines = segments.map((seg) => `[${formatTimestamp(seg.start)}] ${seg.text.trim()}`);
  return `${header}${lines.join("\n")}\n`;
}
```

`tools.ts`：`ApprovalRequest.kind` 联合增 `"transcribe"`；`ToolRunContext` 增 `transcribe?: TranscribeHook`（import 自 transcribe.ts）；executeTool switch 增：

```ts
case "transcribe":
  return await executeTranscribe(call, args, ctx);
```

executeTranscribe 放 tools.ts 尾部（复用 askApproval/denialResult/requiredString）：

```ts
async function executeTranscribe(call: AgentToolCall, args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
  const path = requiredString(args, "path");
  if (typeof path !== "string") return path;
  const language = optionalString(args, "language");
  const model = optionalString(args, "model");
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (!MEDIA_EXTENSIONS.has(ext)) {
    return { content: `不支持的媒体格式：${ext}（支持 mp4/mkv/mov/webm/mp3/wav/m4a/flac/ogg）`, isError: true };
  }
  if (!isWithinRoot(path, ctx.root)) return { content: "transcribe 拒绝：文件不在库根内。", isError: true };
  if (!ctx.transcribe) {
    return { content: "当前未配置 ASR endpoint，转录不可用：请在设置中添加 kind=asr 的 endpoint。", isError: true };
  }
  const size = await ctx.transcribe.probeSize(path);
  const output = transcriptOutputPath(ctx.root, path);
  const detail = `文件：${path}\n大小：${(size / 1024 / 1024).toFixed(1)} MB\n产物：${output}\n说明：文件将完整上传到用户配置的 ASR endpoint 进行语音识别。`;
  const approval = await askApproval(ctx, {
    id: call.id, kind: "transcribe", tool: "transcribe", path,
    summary: `上传转录 ${path.split("/").pop()}（${(size / 1024 / 1024).toFixed(1)} MB）`,
    preview: createTextPreview(detail, detail.length, 4),
  });
  if (!approval.ok) return approval.result;
  if (approval.value.decision === "deny") return denialResult(approval.value, "用户拒绝转录");
  const result = await ctx.transcribe.run({ path, ...(language ? { language } : {}), ...(model ? { model } : {}) });
  const rel = path.slice(ctx.root.length + 1);
  const fileName = path.split("/").pop() ?? path;
  const content = formatTranscript({
    sourceRel: rel, fileName, model: model ?? "default",
    language: language ?? "auto", generatedAt: new Date().toISOString(), result,
  });
  await ctx.host.writeText(output, content);
  const degraded = result.segments.length === 0 && !content.includes("timestamps: segment");
  return { content: degraded
    ? `已生成 ${output}（无时间戳，单段全文；可用 read 查看）`
    : `已生成 ${output}：${result.segments.length || parseTimestampedLines(result.text).length} 段（可用 read/grep 查看内容）` };
}
```

（`MEDIA_EXTENSIONS` 从 transcribe.ts 导出；`model ?? "default"` 处实际由 Rust 侧记真实模型——简化为路由解析后模型名未知时写调用参数或 default，验收不依赖此字段精确性。）

`types.ts`：`kind: "write" | "edit" | "read-outside"` 增 `"transcribe"`。

`service.ts` send() 内 runTurn 前：

```ts
const asrAvailable = await deps.llm.hasAsrCapability();
const tools = asrAvailable ? [...TOOL_DECLARATIONS, TRANSCRIBE_DECLARATION] : TOOL_DECLARATIONS;
```

runTool 的 ctx 增：

```ts
transcribe: {
  probeSize: async (path) => (await deps.files.probeSourceFile(path)).size,
  run: (req) => deps.llm.transcribe(req),
},
```

（`hasAsrCapability` 为 false 时 hook 也注入无妨——工具不声明就不会被调；executeTranscribe 的缺 hook 报错兜底会话中途删配置场景时，service 可按 asrAvailable 决定是否注入，两者皆可，选"按 asrAvailable 注入"使错误路径可测。）

- [ ] **Step 4: 跑测试确认绿**

```bash
pnpm exec vitest run tests/agent-tools.test.ts tests/agent-service.test.ts tests/agent-approval.test.ts
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/plugins/agent-core/ tests/agent-tools.test.ts tests/agent-service.test.ts
git commit -m "feat: agent 新增 transcribe 工具（动态挂载 + 审批 + 确定性格式化） (#32)"
```

---

### Task 8: 审批族接线——渲染与日志

**Files:**
- Modify: `src/plugins/app-agent/render.ts:291`（approvalVerb）
- Modify: `src/plugins/app-agent/index.ts`（审批卡 detail 对 transcribe 族的展示，若按 kind 分支）
- Test: `tests/app-agent-render.test.ts`、`tests/agent-approval.test.ts`

**Interfaces:**
- Consumes: Task 7 的 `kind: "transcribe"`。
- Produces: 人工卡文案 "上传音视频做语音识别"；guardian 通道无需改动（summary/preview 走既有载荷）。

- [ ] **Step 1: 写失败测试**

`tests/app-agent-render.test.ts` 追加：构造 `kind: "transcribe"` 的 ApprovalRequest，断言摘要文案含"上传音视频做语音识别"（或对应动词文案）。

- [ ] **Step 2: 跑测试确认红**

```bash
pnpm exec vitest run tests/app-agent-render.test.ts
```

预期：FAIL。

- [ ] **Step 3: 实现**

`render.ts` approvalVerb：

```ts
if (req.kind === "transcribe") return "上传音视频做语音识别";
```

检查 `index.ts`/`render.ts` 中按 kind 分支的其它点（read-outside 的 grant 选项等），transcribe 走默认分支即可；若 detail popover 对 write/edit 有专用字段展示，确认 transcribe 的 preview.text 能落进既有通用预览区。

- [ ] **Step 4: 跑测试确认绿**

```bash
pnpm exec vitest run tests/app-agent-render.test.ts tests/agent-approval.test.ts tests/app-agent.test.ts
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/plugins/app-agent/ tests/app-agent-render.test.ts
git commit -m "feat: 审批 UI 支持 transcribe 族 (#32)"
```

---

### Task 9: 设置面板——协议下拉 + asr 预设实例化

**Files:**
- Modify: `src/plugins/llm-settings/model.ts`（EndpointDraft.protocol、instantiatePreset、validateDraft）
- Modify: `src/plugins/llm-settings/index.ts`（kind=asr 时渲染协议下拉；upsert 载荷带 protocol）
- Test: `tests/llm-settings.test.ts`

**Interfaces:**
- Consumes: Task 3 的 LlmPreset kind/protocol；Task 6 的 EndpointInput.protocol。
- Produces: 表单草稿 `EndpointDraft { ..., protocol?: "transcriptions" | "chat" }`；asr 预设选中时 kind=asr 且 protocol 预填。

- [ ] **Step 1: 写失败测试**

`tests/llm-settings.test.ts` 追加：

```ts
it("asr 预设实例化携带 kind 与 protocol", () => {
  const draft = instantiatePreset({ vendor: "mimo-asr", name: "小米 MiMo ASR",
    baseUrl: "https://api.xiaomimimo.com/v1", kind: "asr", protocol: "chat",
    models: [{ id: "mimo-v2.5-asr", capabilities: [] }] });
  expect(draft.kind).toBe("asr");
  expect(draft.protocol).toBe("chat");
});

it("validateDraft 拒绝 chat kind 携带 protocol 与未知 protocol 值", () => {
  const bad = { ...blankDraft(), id: "a", name: "a", baseUrl: "https://x.com/v1",
    models: [{ id: "m", capabilities: [] }], protocol: "chat" as const };
  expect(validateDraft(bad)).toContain("protocol");
  const asr = { ...bad, kind: "asr" as const };
  expect(validateDraft(asr)).toBeNull();
  const unknown = { ...asr, protocol: "websocket" as never };
  expect(validateDraft(unknown)).toContain("protocol");
});
```

- [ ] **Step 2: 跑测试确认红**

```bash
pnpm exec vitest run tests/llm-settings.test.ts
```

预期：FAIL。

- [ ] **Step 3: 实现**

`model.ts`：`EndpointDraft` 增 `protocol?: "transcriptions" | "chat"`；`instantiatePreset` 带 `kind: p.kind === "asr" ? "asr" : "chat"` 与 `protocol`；`blankDraft` 不带 protocol；`validateDraft` 追加与 Rust 同规则校验。

`index.ts`：kind 下拉切到 asr 时渲染协议下拉（「转录接口 /v1/audio/transcriptions（默认）」value=`transcriptions`、「聊天接口 input_audio（MiMo ASR 等）」value=`chat`），值写回 draft.protocol（transcriptions 时存 undefined 保持载荷干净）；kind 切回 chat 时清掉 protocol；upsert 载荷带 `protocol: draft.protocol ?? null`。PresetLike 接口增 `kind`/`protocol`。

- [ ] **Step 4: 跑测试确认绿**

```bash
pnpm exec vitest run tests/llm-settings.test.ts
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/plugins/llm-settings/ tests/llm-settings.test.ts
git commit -m "feat: 设置面板 asr 协议下拉与预设实例化 (#32)"
```

---

### Task 10: 文档 + 命令目录 + 全量门禁

**Files:**
- Modify: `docs/plugins/agent.md` + `.en.md`（工具表加 transcribe、审批两模式节加 transcribe 族、动态挂载语义）
- Modify: `docs/plugins/contract.md` + `.en.md`（llm 面方法清单：内置独占 transcribe/hasAsrCapability 不进外置承诺）
- Modify: `docs/architecture.md` + `.en.md`（命令目录经 gen:commands 再生成；config 字段表补 protocol）
- Run: `pnpm gen:commands`、`pnpm record:i18n -- <各 pair>`、全量门禁

**Interfaces:**
- Consumes: Task 1-9 全部。

- [ ] **Step 1: 文档更新**

`docs/plugins/agent.md` 工具表追加行：

```markdown
| `transcribe` | `path`; `language?`; `model?` | 上传库根音视频到 kind=asr endpoint 转录；一次审批覆盖上传与落盘；产物 `.study-wiki/raw/<源去扩展名>/transcript.md`，带 `[HH:MM:SS]` 段或降级 `timestamps: none`；无 asr endpoint 时工具不挂载 |
```

审批节补一句：transcribe 单列一族，卡片明示文件、大小与目标 endpoint。`.en.md` 同步。`contract.md` 的 llm 面清单注明 transcribe/hasAsrCapability 为内置独占（外置白名单不含）。`architecture.md` 的 config 字段说明补 `protocol`。

- [ ] **Step 2: 命令目录与配对重录**

```bash
pnpm gen:commands
pnpm record:i18n -- docs/plugins/agent.md
pnpm record:i18n -- docs/plugins/contract.md
pnpm record:i18n -- docs/architecture.md
```

- [ ] **Step 3: 全量门禁**

```bash
pnpm test
pnpm verify:layering
pnpm verify:docs
pnpm verify:flow
pnpm verify:env-independence
pnpm verify:commands
pnpm route:gates
```

预期：全绿；route:gates 若有额外推荐门禁则补跑。

- [ ] **Step 4: Commit**

```bash
git add docs/ .agents/
git commit -m "docs: m3-01 转录工具文档与命令目录 (#32)"
```

---

## Self-Review 记录

- Spec 覆盖：9 条决策 → Task 2/3（决策 1、2）、Task 7（3、5、6、7）、Task 6（4）、Task 4/5（8、9）；配置层/传输层/宿主层/工具层/设置 UI/文档/流程全部有归属任务。
- 占位符扫描：无 TBD/TODO；agent-service 动态挂载测试的 fake 细节依赖既有文件结构，实施时按 tests/agent-service.test.ts 现有装配模式落地（接口已在 Interfaces 块钉死）。
- 类型一致：TranscribeRequest/TranscriptionResult/TranscriptionSegment/TranscribeHook/TRANSCRIBE_DECLARATION/Endpoint.protocol/LlmPreset.kind+protocol 在生产与消费任务间逐字一致。
- Review Focus 六条全部有对应 Task 测试钉住。
