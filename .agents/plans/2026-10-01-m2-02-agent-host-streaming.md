# Agent 宿主流式推理与 chat 槽位（m2-02）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 m2-02：Rust SSE 流式出口（`llm_chat_stream` + Channel 传输 + 中止）+ 多模态消息模型（path/inline/url 三源）+ 前端唯一组装点 `StreamAssembler` + `ctx.llm.chatStream` + 通用右栏槽位 `sidebar.right` + 内置插件 `app-chat` 的流式渲染 chat 面板。

**Architecture:** Rust 只做薄 egress（手写 SSE 行解析，ureq 阻塞读，零新依赖）；chunk 经 `tauri::ipc::Channel` 推前端；路由/能力门禁/组装在前端 `LlmService`；`app-chat` 内置插件经 `sidebar.right` 槽位渲染，rAF 合帧全量重渲 markdown-it。

**Tech Stack:** Tauri 2 `ipc::Channel`、ureq 2、serde、TypeScript、cordis、Vitest/jsdom、cargo test。

**Spec:** `/Users/zn-ice/2026/StudyWiki/.agents/notes/proposed/architecture/2026-10-01-agent-host-streaming.md`

## Global Constraints

- 提交标题含 `(#29)`；diff 落在 m2-02 issue scope 并集内（`pnpm verify:flow --diff`）。
- 零新增 npm / Cargo 依赖（`scripts/dep-allowlist.json` 不动）；无 CDN、无运行时下载、无环境变量分支、无 UI 框架。
- `src/plugins/**` 禁 import `@tauri-apps/*`（`verify:layering`）；`src/**` 无外部 URL 字面量（`verify:env-independence`）。
- TS 导出符号带契约文档注释（`verify-export-docs`）；每个 `#[tauri::command]` 带相邻 `///` 文档注释。
- chunk 词表（TS/Rust 同形，serde `tag = "type"` + kebab-case）：`text-delta` / `reasoning-delta` / `tool-call-delta` / `usage` / `finish` / `error`。
- 归一错误词表只增不减：新增 `STREAM_CLOSED`（EOF 无 `[DONE]`）与 `UNSUPPORTED_CONTENT`（能力不符 / url 音频）。
- `pnpm record:i18n -- <base>` 重录所有改动过的常驻文档对；生成区只由 `pnpm gen:commands` / `pnpm gen:code-map` 重建。
- 中止语义：`llm_chat_abort(streamId)` 置位 + Channel 对端消失（关窗）→ Rust send 失败即停读。spec 中「drop Channel 即 abort」落地为显式 abort 命令 + send 失败兜底：JS 侧 Channel 无确定性 close，GC 时序不可依赖。
- 测试缝：Rust 流循环以 `sink: impl FnMut(StreamChunk)` 纯函数测（cargo test 不碰真实 AppHandle/Channel）；前端 `LlmDeps` 增 `createChannel` 注入点，vitest 全程假 Channel。

## Review Focus

1. **SSE 行跨 TCP 读边界（mid-UTF-8）**——`BufRead::read_until(b'\n')` 按行字节聚合后再严格 UTF-8 解码，半个多字节序列不得丢字；由 Task 1 Step 1（`sse 行被拆到多次 read`）钉死。
2. **代理截断：EOF 无 `[DONE]`**——必须报 `STREAM_CLOSED`，不得当正常结束；Task 1 Step 1（`eof 无 done 报截断`）。
3. **模型无 vision 能力却收到图片 part**——发送前 `UNSUPPORTED_CONTENT`，请求不出网；Task 3 Step 1（`无 vision 能力带图被拦`）。
4. **流式中关窗/停用插件**——`app-chat` 清理函数必须调 `abort()` 并停 rAF；Task 5 Step 1（`卸载中止在途流`）。
5. **path 附件越出工作区 root**——Rust 出口拒读并报 `UNSUPPORTED_CONTENT`；Task 2 Step 1（`root 外路径拒读`）。
6. **reasoning 与 content 交错 / 仅 reasoning 无正文**——组装器按字段归属各 buffer，互不污染；Task 1 Step 1（`reasoning 字段回退优先级`）与 Task 3 Step 1（`交错 delta 各自归位`）。

---

### Task 1: Rust SSE 行解析器与 chunk 词表（纯函数）

**Files:**
- Create: `src-tauri/src/llm_stream.rs`
- Modify: `src-tauri/src/lib.rs`（`mod llm_stream;`，本任务不注册命令）

**Interfaces:**
- Consumes: `crate::llm::{LlmError, Usage}`。
- Produces（Task 2 依赖）：
  - `pub enum StreamChunk`（serde `tag="type"`，kebab-case 变体名、camelCase 字段）：`TextDelta{index:u32,text:String}` / `ReasoningDelta{index:u32,text:String}` / `ToolCallDelta{index:u32,id:String,name:Option<String>,arguments_delta:String}` / `Usage{usage:Usage}` / `Finish{reason:String}` / `Error{code:String,message:String}`。
  - `pub fn parse_sse_lines(reader: impl BufRead, on_chunk: &mut dyn FnMut(StreamChunk) -> bool) -> Result<(), LlmError>`——行解析 + OpenAI delta 映射一体；`on_chunk` 返回 false 立即停止；EOF 无 `[DONE]` → `STREAM_CLOSED`。

- [ ] **Step 1: 写失败测试**

`src-tauri/src/llm_stream.rs` 内 `#[cfg(test)]`，用 `std::io::Cursor` 喂字节：

```rust
fn collect(bytes: &[u8]) -> (Vec<StreamChunk>, Result<(), LlmError>) {
    let mut out = Vec::new();
    let r = parse_sse_lines(Cursor::new(bytes), &mut |c| { out.push(c); true });
    (out, r)
}

#[test]
fn text_delta_and_done() {
    let body = b"data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"好\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}\n\ndata: [DONE]\n\n";
    let (chunks, r) = collect(body);
    assert!(r.is_ok());
    assert!(matches!(&chunks[0], StreamChunk::TextDelta { text, .. } if text == "你"));
    assert!(matches!(&chunks[1], StreamChunk::TextDelta { text, .. } if text == "好"));
    assert!(matches!(&chunks[2], StreamChunk::Usage { .. }));
    assert!(matches!(&chunks[3], StreamChunk::Finish { reason } if reason == "stop"));
}

#[test]
fn reasoning_field_fallback_order() {
    // reasoning_content 优先于 reasoning；reasoning_text 兜底
    let body = b"data: {\"choices\":[{\"delta\":{\"reasoning\":\"r2\",\"reasoning_content\":\"r1\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"reasoning_text\":\"r3\"}}]}\n\ndata: [DONE]\n\n";
    let (chunks, _) = collect(body);
    assert!(matches!(&chunks[0], StreamChunk::ReasoningDelta { text, .. } if text == "r1"));
    assert!(matches!(&chunks[1], StreamChunk::ReasoningDelta { text, .. } if text == "r3"));
}

#[test]
fn sse_line_split_across_reads_mid_utf8() {
    // 多字节序列跨 read：自定义 Read 按 1/3/7 字节切片喂
    let body = "data: {\"choices\":[{\"delta\":{\"content\":\"特征值\"}}]}\n\ndata: [DONE]\n\n".as_bytes();
    struct Fragmented<'b> { bytes: &'b [u8], pos: usize, cuts: &'b [usize] }
    impl<'b> std::io::Read for Fragmented<'b> {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            if self.pos >= self.bytes.len() { return Ok(0); }
            let n = self.cuts.first().copied().unwrap_or(1)
                .min(self.bytes.len() - self.pos).min(buf.len());
            buf[..n].copy_from_slice(&self.bytes[self.pos..self.pos + n]);
            self.pos += n; self.cuts = &self.cuts[1..];
            Ok(n)
        }
    }
    let f = Fragmented { bytes: body, pos: 0, cuts: &[1, 3, 7] };
    let mut out = Vec::new();
    let r = parse_sse_lines(std::io::BufReader::new(f), &mut |c| { out.push(c); true });
    assert!(r.is_ok());
    assert!(matches!(&out[0], StreamChunk::TextDelta { text, .. } if text == "特征值"));
}

#[test]
fn eof_without_done_is_stream_closed() {
    let body = b"data: {\"choices\":[{\"delta\":{\"content\":\"半句\"}}]}\n\n";
    let (_, r) = collect(body);
    assert!(r.is_err());
    assert_eq!(r.unwrap_err().code, "STREAM_CLOSED");
}

#[test]
fn multiline_data_joined_and_comments_skipped() {
    let body = b": keep-alive\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"a\"}\ndata: }]}\n\ndata: [DONE]\n\n";
    let (chunks, r) = collect(body);
    assert!(r.is_ok());
    assert!(matches!(&chunks[0], StreamChunk::TextDelta { text, .. } if text == "a"));
}

#[test]
fn midstream_error_payload_becomes_error_chunk() {
    let body = b"data: {\"error\":{\"code\":\"rate_limit\",\"message\":\"slow down\"}}\n\ndata: [DONE]\n\n";
    let (chunks, r) = collect(body);
    assert!(r.is_ok()); // 错误作为 chunk 交付，不由解析层抛
    assert!(matches!(&chunks[0], StreamChunk::Error { code, .. } if code == "rate_limit"));
}

#[test]
fn tool_call_deltas_carry_index_and_name() {
    let body = b"data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"function\":{\"name\":\"read\",\"arguments\":\"{\\\"pa\"}}]}}]}\n\ndata: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"th\\\"}\"}}]}}]}\n\ndata: [DONE]\n\n";
    let (chunks, _) = collect(body);
    assert!(matches!(&chunks[0], StreamChunk::ToolCallDelta { index: 0, id, name: Some(n), arguments_delta } if id == "c1" && n == "read" && arguments_delta == "{\"pa"));
    assert!(matches!(&chunks[1], StreamChunk::ToolCallDelta { index: 0, name: None, arguments_delta } if arguments_delta == "th\"}"));
}

#[test]
fn usage_on_choice_fallback() {
    let body = b"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\",\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":1}}]}\n\ndata: [DONE]\n\n";
    let (chunks, _) = collect(body);
    assert!(chunks.iter().any(|c| matches!(c, StreamChunk::Usage { usage } if usage.prompt_tokens == 9)));
}

#[test]
fn callback_false_stops_parsing() {
    let body = b"data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"b\"}}]}\n\ndata: [DONE]\n\n";
    let mut n = 0;
    let r = parse_sse_lines(Cursor::new(body), &mut |_c| { n += 1; false });
    assert!(r.is_ok());
    assert_eq!(n, 1, "回调返回 false 后立即停止投递");
}
```

- [ ] **Step 2: 跑测试确认全红**

Run: `cd src-tauri && cargo test llm_stream`
Expected: 编译失败（`llm_stream` 模块未建 / `parse_sse_lines` 未定义）。

- [ ] **Step 3: 最小实现**

`src-tauri/src/llm_stream.rs`：

```rust
//! 流式 chat 的 SSE 行解析与 chunk 词表：OpenAI 兼容 delta → StreamChunk。

use crate::llm::{LlmError, Usage};
use std::io::BufRead;

/// 流式 chunk：TS/Rust 同形（serde tag + kebab 变体名、camelCase 字段）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum StreamChunk {
    TextDelta { index: u32, text: String },
    ReasoningDelta { index: u32, text: String },
    ToolCallDelta {
        index: u32,
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        arguments_delta: String,
    },
    Usage { usage: Usage },
    Finish { reason: String },
    Error { code: String, message: String },
}

#[derive(serde::Deserialize)]
struct WireChunk {
    #[serde(default)]
    choices: Vec<WireStreamChoice>,
    #[serde(default)]
    usage: Option<Usage>,
    #[serde(default)]
    error: Option<WireError>,
}
#[derive(serde::Deserialize)]
struct WireStreamChoice {
    #[serde(default)]
    delta: serde_json::Value,
    #[serde(default, rename = "finish_reason")]
    finish_reason: Option<String>,
    #[serde(default)]
    usage: Option<Usage>,
}
#[derive(serde::Deserialize)]
struct WireError {
    #[serde(default)]
    code: serde_json::Value,
    #[serde(default)]
    message: serde_json::Value,
}

/// 解析 SSE 字节流：按 \n 字节聚合行（半个 UTF-8 序列不可能含 \n，完整行再
/// 严格解码，跨 read 拆包天然安全）；事件空行分派；多 data 行 \n 拼接；
/// `:` 注释跳过；EOF 前未见 [DONE] = STREAM_CLOSED。
/// on_chunk 返回 false 立即停止（中止/对端消失）。
pub fn parse_sse_lines(
    reader: impl BufRead,
    on_chunk: &mut dyn FnMut(StreamChunk) -> bool,
) -> Result<(), LlmError> {
    let mut data_lines: Vec<String> = Vec::new();
    let mut seen_done = false;
    let mut stopped = false;
    let mut lines = reader.split(b'\n');
    while let Some(raw) = lines.next().transpose().map_err(|e| {
        LlmError::new("UNREACHABLE", format!("流读取失败：{e}"))
    })? {
        let line = String::from_utf8(raw)
            .map_err(|_| LlmError::new("BAD_RESPONSE", "SSE 行不是合法 UTF-8"))?;
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            if !data_lines.is_empty() {
                let payload = data_lines.join("\n");
                data_lines.clear();
                if payload == "[DONE]" { seen_done = true; break; }
                if !dispatch(&payload, on_chunk)? { stopped = true; break; }
            }
            continue;
        }
        if line.starts_with(':') { continue; }
        if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.strip_prefix(' ').unwrap_or(rest).to_string());
        }
    }
    if !seen_done && !stopped {
        return Err(LlmError::new("STREAM_CLOSED", "SSE 流结束而无 [DONE]（疑被截断）"));
    }
    Ok(())
}

/// 单条 data 载荷 → 0..n 个 chunk；返回值聚合回调的「是否继续」。
fn dispatch(payload: &str, on_chunk: &mut dyn FnMut(StreamChunk) -> bool) -> Result<bool, LlmError> {
    let wire: WireChunk = serde_json::from_str(payload)
        .map_err(|e| LlmError::new("BAD_RESPONSE", format!("SSE 载荷不是合法 JSON：{e}")))?;
    if let Some(err) = wire.error {
        let code = err.code.as_str().unwrap_or("BAD_RESPONSE").to_string();
        let msg = err.message.as_str().map(str::to_string)
            .unwrap_or_else(|| err.message.to_string());
        return Ok(on_chunk(StreamChunk::Error { code, message: msg }));
    }
    if let Some(u) = wire.usage { if !on_chunk(StreamChunk::Usage { usage: u }) { return Ok(false); } }
    let Some(choice) = wire.choices.into_iter().next() else { return Ok(true) };
    if let Some(u) = choice.usage { if !on_chunk(StreamChunk::Usage { usage: u }) { return Ok(false); } }
    let d = &choice.delta;
    if let Some(t) = d.get("content").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
        if !on_chunk(StreamChunk::TextDelta { index: 0, text: t.to_string() }) { return Ok(false); }
    }
    // reasoning 字段回退：reasoning_content → reasoning → reasoning_text，取第一个非空。
    for key in ["reasoning_content", "reasoning", "reasoning_text"] {
        if let Some(t) = d.get(key).and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
            if !on_chunk(StreamChunk::ReasoningDelta { index: 0, text: t.to_string() }) { return Ok(false); }
            break;
        }
    }
    if let Some(calls) = d.get("tool_calls").and_then(|v| v.as_array()) {
        for call in calls {
            let index = call.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let id = call.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let name = call.pointer("/function/name").and_then(|v| v.as_str()).map(str::to_string);
            let args = call.pointer("/function/arguments").and_then(|v| v.as_str()).unwrap_or("");
            if !on_chunk(StreamChunk::ToolCallDelta { index, id, name, arguments_delta: args.to_string() }) {
                return Ok(false);
            }
        }
    }
    if let Some(reason) = choice.finish_reason.filter(|r| !r.is_empty()) {
        if !on_chunk(StreamChunk::Finish { reason }) { return Ok(false); }
    }
    Ok(true)
}
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `cd src-tauri && cargo test llm_stream`
Expected: 9 个测试全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/llm_stream.rs src-tauri/src/lib.rs
git commit -m "m2-02：SSE 行解析器与流式 chunk 词表 (#29)"
```

---

### Task 2: 多模态请求构建 + `llm_chat_stream` / `llm_chat_abort` 命令

**Files:**
- Modify: `src-tauri/src/llm.rs`（消息 content 扩 part、请求构建共享、两条新命令）
- Modify: `src-tauri/src/lib.rs`（注册 `llm_chat_stream` / `llm_chat_abort`）
- Modify: `src-tauri/src/windows.rs`（导出 `is_under_any_root`）
- Modify: `.agents/flow/issues/m2-02-agent-host.md`（+ `.en.md`，scope 增 `- src/ui/**`，重录——Task 4 需要）

**Interfaces:**
- Consumes: Task 1 的 `StreamChunk` / `parse_sse_lines`；`windows.rs` 的窗口 root 注册表。
- Produces（Task 3 依赖）：
  - TS wire：`ChatRequest.messages[].content: string | ContentPart[]`；`ContentPart = {type:"text",text} | {type:"image"|"audio", source:{kind:"path",path}|{kind:"inline",data,mimeType}|{kind:"url",url}}`。
  - 命令 `llm_chat_stream(req: ChatStreamRequest, onChunk: Channel<StreamChunk>) -> Result<(), LlmError>`（`ChatStreamRequest = ChatRequest & {streamId: string}`）。
  - 命令 `llm_chat_abort(id: String) -> Result<(), LlmError>`。
  - `fn build_chat_body(req: &ChatRequest, stream: bool, root_check: &dyn Fn(&str) -> bool) -> Result<serde_json::Value, LlmError>`——非流式/流式共用。

- [ ] **Step 1: 写失败测试**

`src-tauri/src/llm.rs` tests 增（复用现有 mock server 的请求读取 helper；新增流式 mock 分片写 SSE）：

```rust
/// 流式 mock：分片写出 SSE（模拟网络分段），最后 [DONE]。
fn mock_stream_server(fragments: Vec<String>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        read_full_request(&mut stream); // 现有 mock 的请求读取，抽成 helper 复用
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").unwrap();
        for frag in fragments {
            stream.write_all(frag.as_bytes()).unwrap();
            stream.flush().unwrap();
            std::thread::sleep(Duration::from_millis(5));
        }
    });
    format!("http://127.0.0.1:{port}/v1")
}

#[test]
fn stream_loop_delivers_chunks_and_finishes() {
    let base = mock_stream_server(vec![
        "data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\n".into(),
        "data: {\"choices\":[{\"delta\":{\"content\":\"好\"},\"finish_reason\":\"stop\"}]}\n\n".into(),
        "data: [DONE]\n\n".into(),
    ]);
    let ep = test_endpoint(&base);
    let aborts = new_abort_registry();
    let mut got: Vec<StreamChunk> = Vec::new();
    let r = run_chat_stream(&stream_agent(), &ep, &text_request(),
        &mut |c| { got.push(c); true }, "s1", &aborts, &|_| false);
    assert!(r.is_ok());
    assert!(got.iter().any(|c| matches!(c, StreamChunk::TextDelta { text, .. } if text == "好")));
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
    let r = run_chat_stream(&stream_agent(), &ep, &text_request(), &mut |_c| {
        n += 1;
        if n == 1 { aborts.lock().unwrap().insert("s2".to_string()); }
        n == 0 // 恒 false：模拟中止后停止
    }, "s2", &aborts, &|_| false);
    assert!(r.is_ok());
    assert_eq!(n, 1, "回调停止后不得再投递 chunk");
}

#[test]
fn image_path_part_becomes_data_url() {
    let req = ChatRequest {
        endpoint_id: "e".into(), model: "m".into(),
        messages: vec![ChatMessage { role: "user".into(), content: MessageContent::Parts(vec![
            ContentPart::Text { text: "看图".into() },
            ContentPart::Media { kind: "image".into(), source: MediaSource::Path { path: "/w/a.png".into() } },
        ])}],
        max_tokens: None, temperature: None,
    };
    // 测试桩：root_check 放行 /w 前缀；真实读盘由 root_check=true + 临时文件用例覆盖
    let dir = std::env::temp_dir().join(format!("sw-att-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("a.png"), b"\x89PNG").unwrap();
    let p = dir.join("a.png").to_string_lossy().to_string();
    let req = { let mut r = req; r.messages[0].content = MessageContent::Parts(vec![
        ContentPart::Text { text: "看图".into() },
        ContentPart::Media { kind: "image".into(), source: MediaSource::Path { path: p } },
    ]); r };
    let body = build_chat_body(&req, false, &|_p| true).unwrap();
    let parts = body["messages"][0]["content"].as_array().unwrap();
    assert_eq!(parts[0]["type"], "text");
    assert!(parts[1]["image_url"]["url"].as_str().unwrap().starts_with("data:image/png;base64,"));
    assert_eq!(body["stream"], serde_json::json!(false));
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn root_outside_path_rejected() {
    let req = ChatRequest {
        endpoint_id: "e".into(), model: "m".into(),
        messages: vec![ChatMessage { role: "user".into(), content: MessageContent::Parts(vec![
            ContentPart::Media { kind: "image".into(), source: MediaSource::Path { path: "/etc/passwd".into() } },
        ])}],
        max_tokens: None, temperature: None,
    };
    let r = build_chat_body(&req, true, &|_p| false);
    assert_eq!(r.unwrap_err().code, "UNSUPPORTED_CONTENT");
}

#[test]
fn stream_body_carries_stream_options_usage() {
    let body = build_chat_body(&text_request(), true, &|_| true).unwrap();
    assert_eq!(body["stream"], serde_json::json!(true));
    assert_eq!(body["stream_options"], serde_json::json!({"include_usage": true}));
}

#[test]
fn audio_url_source_rejected() {
    let req = ChatRequest {
        endpoint_id: "e".into(), model: "m".into(),
        messages: vec![ChatMessage { role: "user".into(), content: MessageContent::Parts(vec![
            ContentPart::Media { kind: "audio".into(), source: MediaSource::Url { url: "https://x/a.mp3".into() } },
        ])}],
        max_tokens: None, temperature: None,
    };
    let r = build_chat_body(&req, true, &|_| true);
    assert_eq!(r.unwrap_err().code, "UNSUPPORTED_CONTENT");
}
```

注：`text_request()` / `test_endpoint()` / `new_abort_registry()` 为测试 helper（`text_request` = 单条纯文本 user 消息的 ChatRequest；`test_endpoint(base)` 构造指向 mock 的 Endpoint；`new_abort_registry()` = `Arc::new(Mutex::new(HashSet::new()))`）。

- [ ] **Step 2: 跑测试确认全红**

Run: `cd src-tauri && cargo test llm`
Expected: 编译失败（`MessageContent` / `run_chat_stream` / `build_chat_body` 未定义）。

- [ ] **Step 3: 最小实现**

`src-tauri/src/llm.rs` 关键改动：

```rust
use crate::llm_stream::{parse_sse_lines, StreamChunk};
use std::io::BufReader;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::ipc::Channel;

/// 流式 chat 超时：长回答持续出字，给 600s。
const STREAM_TIMEOUT: Duration = Duration::from_secs(600);

/// 消息内容：纯文本或多模态 part 数组。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Parts(Vec<ContentPart>),
}

/// 多模态 part：文本，或 image/audio 媒体（source 三源联合）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ContentPart {
    Text { text: String },
    #[serde(rename_all = "camelCase")]
    Media { kind: String, source: MediaSource },
}

/// 媒体来源：path = 本地文件（Rust 出口读盘）；inline = 剪贴板/拖拽 base64；url = 透传。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MediaSource {
    Path { path: String },
    #[serde(rename_all = "camelCase")]
    Inline { data: String, mime_type: String },
    Url { url: String },
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
pub fn abort_registry() -> &'static AbortRegistry {
    static R: OnceLock<AbortRegistry> = OnceLock::new();
    R.get_or_init(|| Arc::new(Mutex::new(std::collections::HashSet::new())))
}

fn stream_agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(STREAM_TIMEOUT).build()
}

/// 按扩展名出 mime：image → png/jpg/jpeg/webp/gif；audio → mp3/wav，其余 UNSUPPORTED_CONTENT。
fn mime_of_path(path: &str, media_kind: &str) -> Result<String, LlmError> {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    let mime = match (media_kind, ext.as_str()) {
        ("image", "png") => "image/png",
        ("image", "jpg" | "jpeg") => "image/jpeg",
        ("image", "webp") => "image/webp",
        ("image", "gif") => "image/gif",
        ("audio", "mp3") => "audio/mpeg",
        ("audio", "wav") => "audio/wav",
        _ => return Err(LlmError::new("UNSUPPORTED_CONTENT", format!("不支持的附件类型：{path}"))),
    };
    Ok(mime.to_string())
}

/// input_audio 的 format 字段只认 wav/mp3。
fn audio_format(mime: &str) -> Result<&'static str, LlmError> {
    match mime {
        "audio/wav" | "audio/x-wav" => Ok("wav"),
        "audio/mpeg" | "audio/mp3" => Ok("mp3"),
        _ => Err(LlmError::new("UNSUPPORTED_CONTENT", format!("音频格式不受支持：{mime}（仅 wav/mp3）"))),
    }
}

/// 媒体 source → OpenAI content part JSON；path 在此读盘转 base64 data URL（限 root_check 放行）。
fn resolve_media(source: &MediaSource, media_kind: &str, root_check: &dyn Fn(&str) -> bool) -> Result<serde_json::Value, LlmError> {
    match source {
        MediaSource::Inline { data, mime_type } => {
            if media_kind == "audio" {
                Ok(serde_json::json!({"type":"input_audio","input_audio":{"data":data,"format":audio_format(mime_type)?}}))
            } else {
                Ok(serde_json::json!({"type":"image_url","image_url":{"url":format!("data:{mime_type};base64,{data}")}}))
            }
        }
        MediaSource::Path { path } => {
            if !root_check(path) {
                return Err(LlmError::new("UNSUPPORTED_CONTENT", format!("附件路径不在工作区内：{path}")));
            }
            let bytes = std::fs::read(path)
                .map_err(|e| LlmError::new("UNSUPPORTED_CONTENT", format!("附件读取失败：{e}")))?;
            let mime = mime_of_path(path, media_kind)?;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            if media_kind == "audio" {
                Ok(serde_json::json!({"type":"input_audio","input_audio":{"data":b64,"format":audio_format(&mime)?}}))
            } else {
                Ok(serde_json::json!({"type":"image_url","image_url":{"url":format!("data:{mime};base64,{b64}")}}))
            }
        }
        MediaSource::Url { url } => {
            if media_kind == "audio" {
                return Err(LlmError::new("UNSUPPORTED_CONTENT", "音频不支持 url 来源".into()));
            }
            Ok(serde_json::json!({"type":"image_url","image_url":{"url":url}}))
        }
    }
}

/// 请求体构建（非流式/流式共用）：parts 归一为 OpenAI content 数组；流式带 stream_options。
fn build_chat_body(
    req: &ChatRequest,
    stream: bool,
    root_check: &dyn Fn(&str) -> bool,
) -> Result<serde_json::Value, LlmError> {
    let mut messages = Vec::new();
    for m in &req.messages {
        let content = match &m.content {
            MessageContent::Text(t) => serde_json::json!(t),
            MessageContent::Parts(parts) => {
                let mut out = Vec::new();
                for p in parts {
                    out.push(match p {
                        ContentPart::Text { text } => serde_json::json!({"type":"text","text":text}),
                        ContentPart::Media { kind, source } => resolve_media(source, kind, root_check)?,
                    });
                }
                serde_json::json!(out)
            }
        };
        messages.push(serde_json::json!({"role": m.role, "content": content}));
    }
    let mut body = serde_json::json!({"model": req.model, "messages": messages, "stream": stream});
    if stream { body["stream_options"] = serde_json::json!({"include_usage": true}); }
    if let Some(max) = req.max_tokens { body["max_tokens"] = serde_json::json!(max); }
    if let Some(t) = req.temperature { body["temperature"] = serde_json::json!(t); }
    Ok(body)
}

/// 流式读循环（纯缝：sink 可测）：abort 置位或 sink 返回 false 即停；
/// 结束时清理登记表。
fn run_chat_stream(
    agent: &ureq::Agent,
    ep: &Endpoint,
    req: &ChatRequest,
    sink: &mut dyn FnMut(StreamChunk) -> bool,
    stream_id: &str,
    aborts: &AbortRegistry,
    root_check: &dyn Fn(&str) -> bool,
) -> Result<(), LlmError> {
    let url = join_url(&ep.base_url, "chat/completions");
    let body = build_chat_body(req, true, root_check)?;
    let resp = with_auth(agent.post(&url), ep)
        .set("Content-Type", "application/json")
        .send_bytes(body.to_string().as_bytes())
        .map_err(map_transport)?;
    let reader = BufReader::new(resp.into_reader());
    let result = parse_sse_lines(reader, &mut |chunk| {
        if aborts.lock().unwrap().contains(stream_id) { return false; }
        sink(chunk)
    });
    aborts.lock().unwrap().remove(stream_id);
    result
}
```

`chat_with`（非流式）改为复用 `build_chat_body(req, false, …)`，行为不变（纯文本消息序列化形状不变）。

`windows.rs` 增（注册表已有 `roots()` 返回已设 root 集合，补路径判定面）：

```rust
/// 路径是否落在任一已注册窗口 root 之下（附件 path 来源的越权防线；无 root 全拒）。
/// 纯函数取 root 快照（字符串），两侧 canonicalize 后做前缀判断；
/// 路径不存在（canonicalize 失败）即拒。注册表读取在命令面做，worker 线程不碰 State。
pub fn path_under_roots(roots: &[String], path: &str) -> bool {
    let p = match std::fs::canonicalize(path) { Ok(p) => p, Err(_) => return false };
    roots.iter().any(|root| {
        match std::fs::canonicalize(root) { Ok(r) => p.starts_with(r), Err(_) => false }
    })
}
```

`llm_chat_stream` 命令额外取 `tauri::State<'_, Mutex<WindowRegistry>>`，闭包 `|p| path_under_any_root(&state.lock().unwrap(), p)` 传给 `run_chat_stream` 的 `root_check` 参数——`run_chat_stream` 签名相应增参 `root_check: &dyn Fn(&str) -> bool`（`build_chat_body` 同签名直传）。

命令面：

```rust
/// 流式 chat：chunk 经 Channel 增量投递，命令 Promise 在流终结时 resolve。
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
        let snapshot: Vec<String> = reg.roots().iter().map(|p| p.to_string_lossy().to_string()).collect();
        snapshot
    };
    tauri::async_runtime::spawn_blocking(move || {
        let dir = config::app_studywiki_dir(&app).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
        let s = config::load_settings(&dir).map_err(|e| LlmError::new("INVALID_CONFIG", e))?;
        let ep = find_endpoint(&s, &req.base.endpoint_id)?;
        let sid = req.stream_id.clone();
        let root_check = |p: &str| crate::windows::path_under_roots(&roots_ok, p);
        run_chat_stream(&stream_agent(), &ep, &req.base, &mut |chunk| {
            on_chunk.send(chunk).is_ok()
        }, &sid, abort_registry(), &root_check)
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
```

`lib.rs`：`mod llm_stream;` + `invoke_handler!` 注册 `llm::llm_chat_stream`、`llm::llm_chat_abort`。

`base64` 已在 Cargo.toml（m2 插件安装用），`use base64::Engine as _;` 即可，零新依赖。

- [ ] **Step 4: 跑测试确认全绿**

Run: `cd src-tauri && cargo test`
Expected: 新增 6 个 + 存量全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/ .agents/flow/issues/m2-02-agent-host.md .agents/flow/issues/m2-02-agent-host.en.md .agents/flow/issues/m2-02-agent-host.i18n.yaml
git commit -m "m2-02：多模态请求构建与流式/中止命令 (#29)"
```

---

### Task 3: 前端 `ctx.llm.chatStream` + `StreamAssembler` + 能力门禁 + guard 白名单

**Files:**
- Create: `src/host/llm-stream.ts`（`StreamChunk` TS 词表 + `StreamAssembler` + `ChunkQueue` + `ChatStreamHandle`）
- Modify: `src/host/llm.ts`（`ChatInput` content 扩 part、`#route` 抽取、`chatStream`、`createChannel` 注入点、能力门禁）
- Modify: `src/host/context.d.ts`（llm 服务文档注释更新）
- Modify: `src/loader/guard.ts`（llm 白名单增 `chatStream`）
- Test: `tests/host-llm-stream.test.ts`（新建）、`tests/guard.test.ts`（增例）

**Interfaces:**
- Consumes: Task 2 的命令面与 wire 形状。
- Produces（Task 5 依赖）：

```ts
/** 流式 chunk（与 Rust llm_stream.rs 同形）。 */
export type StreamChunk =
  | { type: "text-delta"; index: number; text: string }
  | { type: "reasoning-delta"; index: number; text: string }
  | { type: "tool-call-delta"; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: "usage"; usage: { promptTokens: number; completionTokens: number } }
  | { type: "finish"; reason: string }
  | { type: "error"; code: string; message: string };

/** 组装中的 assistant 部分快照（消费者只读快照，不碰裸 delta）。 */
export interface PartialAssistant {
  reasoning: string;
  text: string;
  toolCalls: { index: number; id: string; name: string; argumentsText: string }[];
  usage?: { promptTokens: number; completionTokens: number };
  finishReason?: string;
  error?: { code: string; message: string };
}

/** chunk → 快照唯一组装点。 */
export class StreamAssembler {
  /** 喂一个 chunk；error chunk 只记录不抛（由 settled 拒绝表达）。 */
  push(chunk: StreamChunk): void;
  /** 当前部分快照（toolCalls 按 index 升序）。 */
  snapshot(): PartialAssistant;
}

/** 在途流句柄：events 逐 chunk；settled 终结 resolve（error chunk/传输失败 reject LlmError）。 */
export interface ChatStreamHandle {
  readonly events: AsyncIterable<StreamChunk>;
  readonly settled: Promise<void>;
  abort(): Promise<void>;
}
```

`LlmService` 增 `chatStream(req: ChatInput): Promise<ChatStreamHandle>`；`ChatInput.messages[].content` 扩为 `string | ContentPart[]`，`ContentPart = {type:"text",text:string} | {type:"image"|"audio", source: MediaSource}`，`MediaSource = {kind:"path",path:string} | {kind:"inline",data:string,mimeType:string} | {kind:"url",url:string}`。

- [ ] **Step 1: 写失败测试**

`tests/host-llm-stream.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { LlmService } from "../src/host/llm";
import { StreamAssembler, type StreamChunk } from "../src/host/llm-stream";

describe("StreamAssembler", () => {
  it("交错 delta 各自归位", () => {
    const a = new StreamAssembler();
    a.push({ type: "reasoning-delta", index: 0, text: "想" });
    a.push({ type: "text-delta", index: 0, text: "答" });
    a.push({ type: "reasoning-delta", index: 0, text: "完" });
    const s = a.snapshot();
    expect(s.reasoning).toBe("想完");
    expect(s.text).toBe("答");
  });

  it("tool-call 按 index 归并参数", () => {
    const a = new StreamAssembler();
    a.push({ type: "tool-call-delta", index: 0, id: "c1", name: "read", argumentsDelta: "{\"pa" });
    a.push({ type: "tool-call-delta", index: 0, id: "c1", argumentsDelta: "th\"}" });
    expect(a.snapshot().toolCalls[0].argumentsText).toBe("{\"path\"}");
  });

  it("error chunk 落快照", () => {
    const a = new StreamAssembler();
    a.push({ type: "error", code: "RATE_LIMITED", message: "慢点" });
    expect(a.snapshot().error?.code).toBe("RATE_LIMITED");
  });
});

/** 假 invoke：listEndpoints 回单 endpoint；llm_chat_stream 把脚本化 chunk 灌进假 channel。 */
function fakeDeps(script: StreamChunk[], caps = ["text", "vision"]) {
  let onmessage: ((c: StreamChunk) => void) | null = null;
  const calls: string[] = [];
  const deps = {
    invoke: async (cmd: string, _args?: Record<string, unknown>) => {
      calls.push(cmd);
      if (cmd === "llm_list_endpoints") {
        return { endpoints: [{ id: "e1", name: "E", kind: "chat", baseUrl: "https://x", vendor: "custom", hasKey: true, keyPreview: "sk-…", models: [{ id: "m1", capabilities: caps }] }], defaultModel: "m1" };
      }
      if (cmd === "llm_chat_stream") {
        queueMicrotask(() => { for (const c of script) onmessage?.(c); });
        return undefined;
      }
      if (cmd === "llm_chat_abort") return undefined;
      throw new Error(`unexpected ${cmd}`);
    },
    createChannel: () => ({
      set onmessage(f: ((c: StreamChunk) => void) | null) { onmessage = f; },
      get onmessage() { return onmessage; },
    }),
  };
  return { calls, deps };
}

describe("LlmService.chatStream", () => {
  it("路由 + 逐 chunk 交付 + settled", async () => {
    const { deps } = fakeDeps([
      { type: "text-delta", index: 0, text: "好" },
      { type: "finish", reason: "stop" },
    ]);
    const llm = new LlmService(deps);
    const h = await llm.chatStream({ messages: [{ role: "user", content: "hi" }] });
    const seen: string[] = [];
    for await (const c of h.events) seen.push(c.type);
    expect(seen).toEqual(["text-delta", "finish"]);
    await h.settled;
  });

  it("无 vision 能力带图被拦（UNSUPPORTED_CONTENT，不出网）", async () => {
    const { deps, calls } = fakeDeps([], ["text"]);
    const llm = new LlmService(deps);
    await expect(llm.chatStream({
      messages: [{ role: "user", content: [
        { type: "text", text: "看" },
        { type: "image", source: { kind: "inline", data: "AA", mimeType: "image/png" } },
      ] }],
    })).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
    expect(calls).not.toContain("llm_chat_stream");
  });

  it("无 audio 能力带音频被拦", async () => {
    const { deps } = fakeDeps([], ["text", "vision"]);
    const llm = new LlmService(deps);
    await expect(llm.chatStream({
      messages: [{ role: "user", content: [
        { type: "audio", source: { kind: "path", path: "/w/a.mp3" } },
      ] }],
    })).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT" });
  });

  it("abort 调 llm_chat_abort", async () => {
    const { deps, calls } = fakeDeps([]);
    const llm = new LlmService(deps);
    const h = await llm.chatStream({ messages: [] });
    await h.abort();
    expect(calls).toContain("llm_chat_abort");
  });

  it("invoke 拒绝使迭代抛 LlmError", async () => {
    const deps = {
      invoke: async (cmd: string) => {
        if (cmd === "llm_list_endpoints") return { endpoints: [{ id: "e1", kind: "chat", baseUrl: "https://x", vendor: "custom", hasKey: true, keyPreview: "", models: [{ id: "m1", capabilities: ["text"] }] }], defaultModel: "m1" };
        if (cmd === "llm_chat_stream") throw { code: "UNREACHABLE", message: "断网" };
        return undefined;
      },
      createChannel: () => ({ onmessage: null as null | ((c: StreamChunk) => void) }),
    };
    const llm = new LlmService(deps);
    const h = await llm.chatStream({ messages: [] });
    await expect(h.settled).rejects.toMatchObject({ code: "UNREACHABLE" });
  });
});
```

`tests/guard.test.ts` 增例：外置门面 `ctx.llm.chatStream` 放行、`revealKey` 仍抛教学错误。

- [ ] **Step 2: 跑测试确认全红**

Run: `pnpm exec vitest run tests/host-llm-stream.test.ts`
Expected: FAIL（`llm-stream` 模块不存在）。

- [ ] **Step 3: 最小实现**

`src/host/llm-stream.ts`：

```ts
import { LlmError } from "./llm";

/** 流式 chunk（与 Rust llm_stream.rs 同形：serde tag + kebab 变体名）。 */
export type StreamChunk =
  | { type: "text-delta"; index: number; text: string }
  | { type: "reasoning-delta"; index: number; text: string }
  | { type: "tool-call-delta"; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: "usage"; usage: { promptTokens: number; completionTokens: number } }
  | { type: "finish"; reason: string }
  | { type: "error"; code: string; message: string };

/** 组装中的 assistant 快照（消费者只读快照，不碰裸 delta）。 */
export interface PartialAssistant {
  reasoning: string;
  text: string;
  toolCalls: { index: number; id: string; name: string; argumentsText: string }[];
  usage?: { promptTokens: number; completionTokens: number };
  finishReason?: string;
  error?: { code: string; message: string };
}

/** chunk → 快照唯一组装点：index 关联交错块；error/usage/finish 落元数据。 */
export class StreamAssembler {
  #reasoning = "";
  #text = "";
  #tools = new Map<number, { index: number; id: string; name: string; argumentsText: string }>();
  #usage?: PartialAssistant["usage"];
  #finish?: string;
  #error?: PartialAssistant["error"];

  /** 喂一个 chunk；error chunk 只记录不抛。 */
  push(chunk: StreamChunk): void {
    switch (chunk.type) {
      case "text-delta": this.#text += chunk.text; break;
      case "reasoning-delta": this.#reasoning += chunk.text; break;
      case "tool-call-delta": {
        const t = this.#tools.get(chunk.index) ?? { index: chunk.index, id: "", name: "", argumentsText: "" };
        if (chunk.id) t.id = chunk.id;
        if (chunk.name) t.name = chunk.name;
        t.argumentsText += chunk.argumentsDelta;
        this.#tools.set(chunk.index, t);
        break;
      }
      case "usage": this.#usage = chunk.usage; break;
      case "finish": this.#finish = chunk.reason; break;
      case "error": this.#error = { code: chunk.code, message: chunk.message }; break;
    }
  }

  /** 当前快照（toolCalls 按 index 升序）。 */
  snapshot(): PartialAssistant {
    return {
      reasoning: this.#reasoning,
      text: this.#text,
      toolCalls: [...this.#tools.values()].sort((a, b) => a.index - b.index),
      ...(this.#usage ? { usage: this.#usage } : {}),
      ...(this.#finish ? { finishReason: this.#finish } : {}),
      ...(this.#error ? { error: this.#error } : {}),
    };
  }
}

/** FIFO 异步队列：close 正常终结；fail 使迭代与 settled 抛 LlmError。 */
export class ChunkQueue implements AsyncIterable<StreamChunk> {
  #buf: StreamChunk[] = [];
  #waiters: ((r: IteratorResult<StreamChunk>) => void)[] = [];
  #done = false;
  #failure: LlmError | null = null;

  /** 投递一个 chunk（终结后忽略）。 */
  push(c: StreamChunk): void {
    if (this.#done) return;
    const w = this.#waiters.shift();
    if (w) w({ value: c, done: false });
    else this.#buf.push(c);
  }

  /** 正常终结。 */
  close(): void {
    this.#done = true;
    for (const w of this.#waiters.splice(0)) w({ value: undefined, done: true });
  }

  /** 失败终结：settled 与在途/后续迭代一并拒绝。 */
  fail(e: LlmError): void {
    this.#failure = e;
    this.close();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
    while (true) {
      const c = this.#buf.shift();
      if (c !== undefined) yield c;
      else if (this.#done) {
        if (this.#failure) throw this.#failure;
        return;
      } else {
        const r = await new Promise<IteratorResult<StreamChunk>>((res) => this.#waiters.push(res));
        if (r.done) {
          if (this.#failure) throw this.#failure;
          return;
        }
        yield r.value;
      }
    }
  }
}
```

`src/host/llm.ts`：

- `LlmDeps` 增 `createChannel?: () => { onmessage: ((chunk: StreamChunk) => void) | null }`；`defaultLlmDeps` 用 `() => new Channel<StreamChunk>()`（`import { Channel } from "@tauri-apps/api/core"`）。
- `ChatInput.messages` 的 `content` 扩为 `string | ContentPart[]`，类型与文档注释同步更新（删去「多模态随 m2-02」预告语，写现状）。
- 抽 `#route(model?: string): Promise<{ endpointId: string; model: string; entry: ModelEntry }>`，`chat()` 与 `chatStream()` 共用。
- `chatStream` 按 Interfaces 实现：`#route` → 能力门禁（image 要 `vision`、audio 要 `audio`，不符抛 `UNSUPPORTED_CONTENT`）→ `crypto.randomUUID()` streamId → `createChannel` → `ChunkQueue` → invoke `llm_chat_stream`（then `queue.close()`，catch `queue.fail(LlmError)`）→ 返回 `{events, settled, abort}`。`settled` 语义：`queue.close()` 后检查 assembler 无关——settled 直接挂 invoke promise（失败即 reject LlmError）；**此外**迭代结束后若最后一个 chunk 是 `error`，`chatStream` 内部把 `queue.fail(new LlmError(code, message))`（在 onmessage 里检测 error chunk 时标记，close 时若有标记则 fail）——实现为 onmessage 闭包：`if (chunk.type === "error") seenError = chunk; queue.push(chunk);`，close 回调里 `seenError ? queue.fail(...) : queue.close()`。

`guard.ts`：`llm: new Set(["listEndpoints", "probe", "chat", "chatStream"])`（注释同步：外置插件可发起流式推理）。

`context.d.ts` llm 行注释更新：「LLM 推理服务（endpoint 列表/探测/非流式与流式 chat；模型路由与能力门禁在本层）」。

- [ ] **Step 4: 跑测试确认全绿**

Run: `pnpm exec vitest run tests/host-llm-stream.test.ts tests/host-llm.test.ts tests/guard.test.ts`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/host/ src/loader/guard.ts tests/
git commit -m "m2-02：chatStream 宿主面、组装器与能力门禁 (#29)"
```

---

### Task 4: `sidebar.right` 槽位 + app-shell 右栏 + 共享 markdown 渲染器

**Files:**
- Modify: `src/host/slots.ts`（`SlotName` 增 `"sidebar.right"`）
- Modify: `src/plugins/app-shell/index.ts`（右栏容器 + mount）
- Modify: `src/styles.css`（`.body` 三列、`.chat-rail`）
- Create: `src/ui/markdown.ts`（共享 markdown-it 实例）
- Modify: `src/plugins/doc-markdown/preview.ts`（改为 re-export）
- Test: `tests/slots.test.ts`（增例）、`tests/app-shell.test.ts`（增例）

**Interfaces:**
- Consumes: 现有 slots/app-shell 结构。
- Produces（Task 5 依赖）：`ctx.slots.register("sidebar.right", render)` 可用；`renderMarkdown(src: string): string` 从 `src/ui/markdown.ts` 导出。

- [ ] **Step 1: 写失败测试**

```ts
// tests/slots.test.ts 增例
it("sidebar.right 槽位可注册并按序渲染", () => {
  const slots = new SlotsService();
  const host = document.createElement("div");
  slots.register("sidebar.right", (el) => { el.textContent = "chat"; });
  slots.mount("sidebar.right", host);
  expect(host.textContent).toContain("chat");
});

// tests/app-shell.test.ts 增例（复用该文件现有基建：#app root + slots/workspace 桩）
test("shell: mounts the sidebar.right slot container", () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const mounted: string[] = [];
  const slots = { mount: (slot: string, host: HTMLElement) => { mounted.push(slot); host.replaceChildren(); } };
  const workspace = { root: null, activeFile: null, events: { on: () => () => {} } };
  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
  expect(mounted).toContain("sidebar.right");
  expect(root.querySelector(".slot-host.sidebar-right")).toBeTruthy();
  teardown();
  root.remove();
});
```

- [ ] **Step 2: 跑测试确认全红**

Run: `pnpm exec vitest run tests/slots.test.ts tests/app-shell.test.ts`
Expected: FAIL（`SlotName` 不含 `sidebar.right`）。

- [ ] **Step 3: 最小实现**

- `slots.ts`：`export type SlotName = "topbar.left" | "sidebar.tree" | "main.viewer" | "sidebar.right";`（类型文档注释同步）。
- `app-shell/index.ts`：建 `chatRail` aside（class `chat-rail`），内含 `<div class="slot-host sidebar-right">`；`body.append(sidebar, resizer, main, chatRail)`；`ctx.slots.mount("sidebar.right", chatHost)`。
- `styles.css`：`.body { grid-template-columns: var(--sidebar-size, 252px) minmax(340px, 1fr) var(--chat-size, 320px); }`；`.chat-rail { border-left: 1px solid var(--line); min-height: 0; display: flex; flex-direction: column; }`（设计令牌沿用现有变量名，落地时对齐 styles.css 现有命名）。
- `src/ui/markdown.ts`：

```ts
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

/** Render markdown source to HTML (raw HTML disabled — escaped, not executed).
 * 宿主共享渲染器：doc-markdown 与 app-chat 同一实例同一策略。
 * @param src Markdown source text.
 * @returns Rendered HTML. */
export function renderMarkdown(src: string): string {
  return md.render(src);
}
```

- `doc-markdown/preview.ts` 改为 `export { renderMarkdown } from "../../ui/markdown";`（原实现删除，消费方签名不变）。

- [ ] **Step 4: 跑测试确认全绿**

Run: `pnpm exec vitest run tests/slots.test.ts tests/app-shell.test.ts tests/doc-markdown.test.ts`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/host/slots.ts src/plugins/app-shell/ src/styles.css src/ui/markdown.ts src/plugins/doc-markdown/preview.ts tests/
git commit -m "m2-02：sidebar.right 槽位、右栏布局与共享 markdown 渲染器 (#29)"
```

---

### Task 5: 内置插件 `app-chat`（会话 UI + 流式渲染 + 附件 + 中止）

**Files:**
- Create: `src/plugins/app-chat/index.ts`（插件面：slot 注册、会话状态、composer、模型选择）
- Create: `src/plugins/app-chat/render.ts`（消息 DOM 渲染 + rAF 合帧 + reasoning 折叠 + usage/中断/错误态）
- Create: `src/plugins/app-chat/attachments.ts`（粘贴/拖拽 → inline；📎 选文件 → path）
- Modify: `src/loader/table.ts`（注册内置行）
- Test: `tests/app-chat.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `chatStream`/`StreamAssembler`/`ChatStreamHandle`；Task 4 的 `sidebar.right` 与 `renderMarkdown`；`ctx.llm.listEndpoints`（模型下拉）；`ctx.workspace`（上下文行）。
- Produces: 无下游消费者（验收面：插件发起流式推理并渲染）。

**apply 签名与测试缝**：`apply(ctx, config, deps: ChatDeps = defaultChatDeps)`；`ChatDeps = { raf: (cb: () => void) => number; pickFile: () => Promise<string | null> }`（jsdom 无 rAF / 无原生文件对话框，注入桩；真身 `pickFile` 经 `ctx.windows` 或宿主文件服务现有对话框面，落地时对齐现有 seam——若宿主无文件选择对话框面，则本期 📎 只接粘贴/拖拽，pickFile 置灰）。

- [ ] **Step 1: 写失败测试**

```ts
// tests/app-chat.test.ts（jsdom）
import { describe, expect, it, beforeEach } from "vitest";
import { apply } from "../src/plugins/app-chat/index";
import type { StreamChunk } from "../src/host/llm-stream";

let aborted: boolean;
let lastReq: unknown;

function fakeCtx(script: StreamChunk[]) {
  let host: HTMLElement | null = null;
  const ctx = {
    slots: { register: (_slot: string, render: (el: HTMLElement) => void) => { host = el as HTMLElement; document.body.append(el); render(el); return () => el.remove(); } },
    llm: {
      listEndpoints: async () => ({ endpoints: [{ id: "e1", kind: "chat", models: [{ id: "m1", capabilities: ["text", "vision", "audio"] }] }], defaultModel: "m1" }),
      chatStream: async (req: unknown) => {
        lastReq = req;
        const events = (async function* () { for (const c of script) yield c; })();
        return { events, settled: Promise.resolve(), abort: async () => { aborted = true; } };
      },
    },
    workspace: { root: "/w", activeFile: { name: "第3章.md", path: "/w/第3章.md", kind: "markdown" }, events: { on: () => () => {} } },
  };
  return { ctx, host: () => host! };
}

beforeEach(() => { document.body.innerHTML = ""; aborted = false; lastReq = null; });

const syncDeps = { raf: (cb: () => void) => { cb(); return 0; }, pickFile: async () => null };

it("发送后流式渲染：reasoning 折叠、正文增量、usage 落行", async () => {
  const { ctx } = fakeCtx([
    { type: "reasoning-delta", index: 0, text: "想一下" },
    { type: "text-delta", index: 0, text: "### 答案\n\n内容" },
    { type: "usage", usage: { promptTokens: 3, completionTokens: 5 } },
    { type: "finish", reason: "stop" },
  ]);
  const dispose = apply(ctx as never, {}, syncDeps);
  const input = document.querySelector("textarea")!;
  input.value = "提问";
  document.querySelector<HTMLButtonElement>(".chat-send")!.click();
  await new Promise((r) => setTimeout(r, 10));
  expect(document.querySelector(".chat-reason")).toBeTruthy();
  expect(document.querySelector(".chat-md")!.innerHTML).toContain("<h3>");
  expect(document.body.textContent).toContain("3"); // usage 行存在
  dispose();
});

it("流式中发送键变停止，点击调 abort 并标已中断", async () => {
  const { ctx } = fakeCtx([{ type: "text-delta", index: 0, text: "半截" }]);
  const dispose = apply(ctx as never, {}, syncDeps);
  document.querySelector("textarea")!.value = "q";
  document.querySelector<HTMLButtonElement>(".chat-send")!.click();
  await new Promise((r) => setTimeout(r, 10));
  const stop = document.querySelector<HTMLButtonElement>(".chat-send")!;
  expect(stop.textContent).toContain("停止");
  stop.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(aborted).toBe(true);
  expect(document.body.textContent).toContain("已中断");
  dispose();
});

it("error chunk 渲染错误横幅含错误码", async () => {
  const { ctx } = fakeCtx([{ type: "error", code: "RATE_LIMITED", message: "慢点" }]);
  const dispose = apply(ctx as never, {}, syncDeps);
  document.querySelector("textarea")!.value = "q";
  document.querySelector<HTMLButtonElement>(".chat-send")!.click();
  await new Promise((r) => setTimeout(r, 10));
  expect(document.body.textContent).toContain("RATE_LIMITED");
  dispose();
});

it("卸载中止在途流", async () => {
  const { ctx } = fakeCtx([{ type: "text-delta", index: 0, text: "x" }]);
  const dispose = apply(ctx as never, {}, syncDeps);
  document.querySelector("textarea")!.value = "q";
  document.querySelector<HTMLButtonElement>(".chat-send")!.click();
  await new Promise((r) => setTimeout(r, 10));
  dispose();
  expect(aborted).toBe(true);
});

it("fileToAttachment：图片 File → inline base64，文本 File → null", async () => {
  const { fileToAttachment } = await import("../src/plugins/app-chat/attachments");
  const img = new File([new Uint8Array([137, 80, 78, 71])], "截图.png", { type: "image/png" });
  const att = await fileToAttachment(img);
  expect(att?.part.type).toBe("image");
  expect(att?.part.source).toMatchObject({ kind: "inline", mimeType: "image/png" });
  const txt = new File(["hi"], "a.txt", { type: "text/plain" });
  expect(await fileToAttachment(txt)).toBeNull();
});

it("paste 事件把图片挂进 composer chips", async () => {
  const { ctx } = fakeCtx([{ type: "finish", reason: "stop" }]);
  const dispose = apply(ctx as never, {}, syncDeps);
  const file = new File([new Uint8Array([1, 2])], "贴图.png", { type: "image/png" });
  const area = document.querySelector("textarea")!;
  // jsdom 无 ClipboardEvent：直接构造通用 Event 并挂 clipboardData（插件只读 files）
  const ev = new Event("paste", { bubbles: true }) as Event & { clipboardData: unknown };
  ev.clipboardData = { files: [file] };
  area.dispatchEvent(ev);
  await new Promise((r) => setTimeout(r, 10));
  expect(document.querySelector(".chat-chip")?.textContent).toContain("贴图.png");
  dispose();
});
```

- [ ] **Step 2: 跑测试确认全红**

Run: `pnpm exec vitest run tests/app-chat.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`attachments.ts`：

```ts
/** 附件 source（对齐 host/llm.ts 的 ContentPart source 联合）。 */
export type MediaSource =
  | { kind: "path"; path: string }
  | { kind: "inline"; data: string; mimeType: string }
  | { kind: "url"; url: string };

/** composer 待发附件。 */
export interface PendingAttachment {
  part: { type: "image" | "audio"; source: MediaSource };
  label: string;
}

/** File（粘贴/拖拽）→ inline 附件；非图非音频类型拒收返回 null。 */
export async function fileToAttachment(file: File): Promise<PendingAttachment | null> {
  const image = file.type.startsWith("image/");
  const audio = file.type === "audio/mpeg" || file.type === "audio/wav" || file.type === "audio/x-wav";
  if (!image && !audio) return null;
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return {
    part: { type: image ? "image" : "audio", source: { kind: "inline", data: btoa(bin), mimeType: file.type } },
    label: file.name || (image ? "粘贴的图片" : "粘贴的音频"),
  };
}
```

`render.ts`：

```ts
import { renderMarkdown } from "../../ui/markdown";
import type { PartialAssistant } from "../../host/llm-stream";

/** 流式渲染调度器：delta 只改快照，rAF 合帧重渲（一帧多 delta 只渲一次）。 */
export function createStreamRenderer(el: HTMLElement, raf: (cb: () => void) => number) {
  let pending: PartialAssistant | null = null;
  let scheduled = false;
  return {
    /** 提交新快照；合帧后重绘。 */
    update(snapshot: PartialAssistant) {
      pending = snapshot;
      if (scheduled) return;
      scheduled = true;
      raf(() => { scheduled = false; if (pending) paint(el, pending); });
    },
  };
}

/** 单条 assistant 消息渲染：reasoning <details>（有 finishReason 即折起）+ markdown 正文
 * + usage 行（tokens 输入 X · 输出 Y · finish R）+ error 横幅。 */
export function paint(el: HTMLElement, s: PartialAssistant): void {
  /* 实现要点：
     - s.reasoning 非空 → <details class="chat-reason">，open = !s.finishReason && !s.error；
     - s.text → .chat-md，innerHTML = renderMarkdown(s.text)；
     - s.usage → .chat-usage 文本行；
     - s.error → .chat-err（code + message + 重试按钮由调用层接）。 */
}
```

`index.ts` 骨架：

- 会话内存态 `messages: { role: string; content: string | ContentPart[] }[]`；`pending: PendingAttachment[]`；`current: { handle: ChatStreamHandle; assembler: StreamAssembler; renderer } | null`。
- 发送：文本 + pending 附件组 parts → `ctx.llm.chatStream` → `for await` 逐 chunk `assembler.push` + `renderer.update(assembler.snapshot())` → `settled` 后落 usage/错误行；`current` 清空。
- 流式中发送键变「■ 停止」→ `handle.abort()` + 中断标记行「已中断 · 已保留以上内容」。
- composer：`textarea`（Enter 发送/Shift+Enter 换行）+ 📎 + 附件 chips（× 移除）；paste/drop 事件 → `fileToAttachment`。
- 头部：模型下拉（`listEndpoints` 的 chat endpoint 模型并集，`defaultModel` 选中，能力标注 `vision`/`audio`）+ 上下文行（`ctx.workspace.activeFile?.name`）。
- 清理函数：`current?.handle.abort()`、撤 slot 注册、移除 DOM 监听。
- `loader/table.ts` 注册内置行 `app-chat`（manifest 存量迁移自动并入）。

- [ ] **Step 4: 跑测试确认全绿**

Run: `pnpm exec vitest run tests/app-chat.test.ts`
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/plugins/app-chat/ src/loader/table.ts tests/app-chat.test.ts
git commit -m "m2-02：app-chat 内置插件——流式 chat 面板 (#29)"
```

---

### Task 6: 能力标注 UI + 文档/生成区/门禁收尾 + issue 落地

**Files:**
- Modify: `src/plugins/llm-settings/index.ts`（audio capability checkbox，对照现有 vision checkbox）
- Modify: `docs/architecture.md`（+ `.en.md`：数据流增流式链路、关键决策点增 Channel/SSE/三源附件条目；组成树生成区 regen）
- Modify: `docs/plugins/contract.md`（+ `.en.md`：inject 服务清单补 `llm`、槽位清单补 `sidebar.right`）
- Modify: `docs/commands.md`（+ `.en.md`：`pnpm gen:commands` 重建）
- Modify: `scripts/code-map.manifest.json`（新文件行：`llm_stream.rs` / `llm-stream.ts` / `app-chat/*` / `ui/markdown.ts`）
- Modify: `.agents/flow/issues/m2-02-agent-host.md`（+ `.en.md`：落地记录段）
- Test: `tests/llm-settings.test.ts`（增例）

**Interfaces:**
- Consumes: Task 1-5 全部产物。
- Produces: 门禁证据与落地记录（issue 验收对照）。

- [ ] **Step 1: llm-settings audio checkbox（先测试）**

对照 vision checkbox（`src/plugins/llm-settings/index.ts` 现有 vision 勾选行）增 audio 勾选：`m.capabilities` 增删 `"audio"`。`tests/llm-settings.test.ts` 增例：勾选 audio → upsert payload 的模型 capabilities 含 `"audio"`；取消则移除。

- [ ] **Step 2: 文档三件套更新 + 重录**

- `architecture.md` 数据流段：LLM 推理句改述为含流式（「流式走 `llm_chat_stream`：Rust 手写 SSE 行解析，chunk 经 ipc::Channel 推前端组装器」）；关键决策点增两条：「流式走 ipc::Channel 而非事件广播（单消费者有序流、多窗口天然隔离）」「附件三源联合（path 由 Rust 出口读盘转 base64，inline 不落盘，url 透传 provider）」。
- `contract.md`：inject 服务清单补 `llm`（外置可调用面 `listEndpoints / probe / chat / chatStream`）；槽位说明补 `sidebar.right`。
- 双侧最小修补后重录：`pnpm record:i18n -- docs/architecture.md`、`pnpm record:i18n -- docs/plugins/contract.md`。

- [ ] **Step 3: 生成区重建 + code-map 登记**

`scripts/code-map.manifest.json` 增新文件行后跑：

```bash
pnpm gen:code-map
pnpm gen:commands
```

- [ ] **Step 4: 全量门禁**

```bash
pnpm exec vitest run
cd src-tauri && cargo test && cd ..
pnpm lint:docs && pnpm verify:docs
pnpm verify:layering && pnpm verify:env-independence && pnpm verify:dep-audit && pnpm verify:flow && pnpm verify:commands
```

Expected: 全绿。

- [ ] **Step 5: issue 落地记录**

m2-02 issue 双侧增「落地记录」段（对照 m2-01 格式：链路形状、命令面、错误词表增量、门禁证据）；status 保持 `in-progress`（PR 合并后转 done）。重录 issue 对。spec note 保持 `proposed`（随 PR 合并转 implemented）。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "m2-02：audio 能力标注、文档与门禁收尾 (#29)"
```
