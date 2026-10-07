//! 流式 chat 的 SSE 行解析与 chunk 词表：OpenAI 兼容 delta → StreamChunk。

use crate::llm::{LlmError, Usage};
use std::io::BufRead;

/// 流式 chunk：TS/Rust 同形（serde tag + kebab 变体名、camelCase 字段）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum StreamChunk {
    TextDelta {
        index: u32,
        text: String,
    },
    ReasoningDelta {
        index: u32,
        text: String,
    },
    ToolCallDelta {
        index: u32,
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        arguments_delta: String,
    },
    Usage {
        usage: Usage,
    },
    Finish {
        reason: String,
    },
    Error {
        code: String,
        message: String,
    },
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

/// MiniMax 类兼容端点的 `<think>` 方言：流式把标签内 content 归入 reasoning，
/// 标签外恢复 text。缓冲只保留可能是跨 chunk 标签前缀的最短尾部。
#[derive(Default)]
struct ThinkSplitter {
    inside: bool,
    buffer: String,
}

impl ThinkSplitter {
    fn push(&mut self, text: &str) -> Vec<(bool, String)> {
        self.buffer.push_str(text);
        let mut out = Vec::new();
        loop {
            if self.inside {
                match self.buffer.find("</think>") {
                    Some(index) => {
                        if index > 0 {
                            out.push((true, self.buffer[..index].to_owned()));
                        }
                        self.buffer.drain(..index + "</think>".len());
                        self.inside = false;
                    }
                    None => {
                        if ends_with_partial_tag(&self.buffer, "</think>") {
                            break;
                        }
                        if !self.buffer.is_empty() {
                            out.push((true, std::mem::take(&mut self.buffer)));
                        }
                        break;
                    }
                }
            } else {
                match self.buffer.find("<think>") {
                    Some(index) => {
                        if index > 0 {
                            out.push((false, self.buffer[..index].to_owned()));
                        }
                        self.buffer.drain(..index + "<think>".len());
                        self.inside = true;
                    }
                    None => {
                        if ends_with_partial_tag(&self.buffer, "<think>") {
                            break;
                        }
                        if !self.buffer.is_empty() {
                            out.push((false, std::mem::take(&mut self.buffer)));
                        }
                        break;
                    }
                }
            }
        }
        out
    }
}

fn ends_with_partial_tag(text: &str, tag: &str) -> bool {
    (1..tag.len()).any(|size| {
        let suffix = text.chars().rev().take(size).collect::<Vec<_>>();
        tag.chars().take(size).eq(suffix.into_iter().rev())
    })
}

/// 解析 SSE 字节流：按 \n 字节聚合行（半个 UTF-8 序列不可能含 \n，完整行再
/// 严格解码，跨 read 拆包天然安全）；事件空行分派；多 data 行 \n 拼接；
/// `:` 注释跳过；EOF 前既无 [DONE] 也无 finish_reason = STREAM_CLOSED。
/// max_event_bytes 限制单事件（多 data 行拼接后）的载荷字节数，超限断流报
/// BAD_RESPONSE——这是流内唯一无界缓冲，不设上限会被畸形/恶意端点撑爆内存。
/// on_chunk 返回 false 立即停止（中止/对端消失）。
pub fn parse_sse_lines(
    reader: impl BufRead,
    max_event_bytes: u64,
    on_chunk: &mut dyn FnMut(StreamChunk) -> bool,
) -> Result<(), LlmError> {
    let mut data_lines: Vec<String> = Vec::new();
    let mut payload_bytes: u64 = 0;
    let mut seen_done = false;
    let mut seen_finish = false;
    let mut think_splitter = ThinkSplitter::default();
    let mut stopped = false;
    let mut lines = reader.split(b'\n');
    while let Some(raw) = lines.next().transpose().map_err(|e| LlmError {
        code: "UNREACHABLE".into(),
        message: format!("流读取失败：{e}"),
    })? {
        let line = String::from_utf8(raw).map_err(|_| LlmError {
            code: "BAD_RESPONSE".into(),
            message: "SSE 行不是合法 UTF-8".into(),
        })?;
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            if !data_lines.is_empty() {
                let payload = data_lines.join("\n");
                data_lines.clear();
                payload_bytes = 0;
                if payload == "[DONE]" {
                    seen_done = true;
                    break;
                }
                if !dispatch(&payload, on_chunk, &mut seen_finish, &mut think_splitter)? {
                    stopped = true;
                    break;
                }
            }
            continue;
        }
        if line.starts_with(':') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("data:") {
            let rest = rest.strip_prefix(' ').unwrap_or(rest);
            payload_bytes += rest.len() as u64 + 1; // +1 计入拼接分隔符，宁紧勿松
            if payload_bytes > max_event_bytes {
                return Err(LlmError {
                    code: "BAD_RESPONSE".into(),
                    message: format!("SSE 事件载荷超过上限 {max_event_bytes} 字节，断流"),
                });
            }
            data_lines.push(rest.to_string());
        }
    }
    if !seen_done && !seen_finish && !stopped {
        return Err(LlmError {
            code: "STREAM_CLOSED".into(),
            message: "SSE 流结束而无 [DONE] 或 finish_reason（疑被截断）".into(),
        });
    }
    Ok(())
}

/// 单条 data 载荷 → 0..n 个 chunk；返回值聚合回调的「是否继续」。
fn dispatch(
    payload: &str,
    on_chunk: &mut dyn FnMut(StreamChunk) -> bool,
    seen_finish: &mut bool,
    think_splitter: &mut ThinkSplitter,
) -> Result<bool, LlmError> {
    let wire: WireChunk = serde_json::from_str(payload).map_err(|e| LlmError {
        code: "BAD_RESPONSE".into(),
        message: format!("SSE 载荷不是合法 JSON：{e}"),
    })?;
    if let Some(err) = wire.error {
        let code = err.code.as_str().unwrap_or("BAD_RESPONSE").to_string();
        let msg = err
            .message
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| err.message.to_string());
        return Ok(on_chunk(StreamChunk::Error { code, message: msg }));
    }
    let top_usage = wire.usage;
    let Some(choice) = wire.choices.into_iter().next() else {
        if let Some(u) = top_usage {
            if !on_chunk(StreamChunk::Usage { usage: u }) {
                return Ok(false);
            }
        }
        return Ok(true);
    };
    let d = &choice.delta;
    if let Some(t) = d
        .get("content")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        for (is_reasoning, text) in think_splitter.push(t) {
            let chunk = if is_reasoning {
                StreamChunk::ReasoningDelta { index: 0, text }
            } else {
                StreamChunk::TextDelta { index: 0, text }
            };
            if !on_chunk(chunk) {
                return Ok(false);
            }
        }
    }
    // reasoning 字段回退：reasoning_content → reasoning → reasoning_text，取第一个非空。
    for key in ["reasoning_content", "reasoning", "reasoning_text"] {
        if let Some(t) = d
            .get(key)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            if !on_chunk(StreamChunk::ReasoningDelta {
                index: 0,
                text: t.to_string(),
            }) {
                return Ok(false);
            }
            break;
        }
    }
    if let Some(calls) = d.get("tool_calls").and_then(|v| v.as_array()) {
        for call in calls {
            // 上游 index 语义是 u32；畸形超大值钳到 u32::MAX（不静默变小值误归并），
            // m2-03 工具执行落地时应改为显式拒绝或独立处理。
            let index = u32::try_from(call.get("index").and_then(|v| v.as_u64()).unwrap_or(0))
                .unwrap_or(u32::MAX);
            let id = call
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let name = call
                .pointer("/function/name")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let args = call
                .pointer("/function/arguments")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if !on_chunk(StreamChunk::ToolCallDelta {
                index,
                id,
                name,
                arguments_delta: args.to_string(),
            }) {
                return Ok(false);
            }
        }
    }
    // 上游可能在顶层或 choice 上给 usage；去重后按内容增量之后再投递。
    if let Some(u) = top_usage.or(choice.usage) {
        if !on_chunk(StreamChunk::Usage { usage: u }) {
            return Ok(false);
        }
    }
    if let Some(reason) = choice.finish_reason.filter(|r| !r.is_empty()) {
        *seen_finish = true;
        if !on_chunk(StreamChunk::Finish { reason }) {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn collect(bytes: &[u8]) -> (Vec<StreamChunk>, Result<(), LlmError>) {
        collect_with(bytes, u64::MAX)
    }

    fn collect_with(bytes: &[u8], limit: u64) -> (Vec<StreamChunk>, Result<(), LlmError>) {
        let mut out = Vec::new();
        let r = parse_sse_lines(Cursor::new(bytes), limit, &mut |c| {
            out.push(c);
            true
        });
        (out, r)
    }

    #[test]
    fn text_delta_and_done() {
        let body = b"data: {\"choices\":[{\"delta\":{\"content\":\"\\u4f60\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"\\u597d\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}\n\ndata: [DONE]\n\n";
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
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"特征值\"}}]}\n\ndata: [DONE]\n\n"
            .as_bytes();
        struct Fragmented<'b> {
            bytes: &'b [u8],
            pos: usize,
            cuts: &'b [usize],
        }
        impl<'b> std::io::Read for Fragmented<'b> {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                if self.pos >= self.bytes.len() {
                    return Ok(0);
                }
                let cut = match self.cuts.split_first() {
                    Some((first, rest)) => {
                        self.cuts = rest;
                        *first
                    }
                    None => 1,
                };
                let n = cut.min(self.bytes.len() - self.pos).min(buf.len());
                buf[..n].copy_from_slice(&self.bytes[self.pos..self.pos + n]);
                self.pos += n;
                Ok(n)
            }
        }
        let f = Fragmented {
            bytes: body,
            pos: 0,
            cuts: &[1, 3, 7],
        };
        let mut out = Vec::new();
        let r = parse_sse_lines(std::io::BufReader::new(f), u64::MAX, &mut |c| {
            out.push(c);
            true
        });
        assert!(r.is_ok());
        assert!(matches!(&out[0], StreamChunk::TextDelta { text, .. } if text == "特征值"));
    }

    #[test]
    fn finish_reason_then_eof_without_done_is_complete() {
        // MiniMax 兼容方言：finish_reason 后先发 usage-only，再直接 EOF，不发 [DONE]。
        let body = br#"data: {"choices":[{"delta":{"content":"<think>plan</think>","tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"read","arguments":"{\"path\":\"readme.md\"}"}}]},"finish_reason":"tool_calls"}]}

data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":6}}

"#;
        let (chunks, r) = collect(body);
        assert!(r.is_ok());
        assert!(matches!(&chunks[0], StreamChunk::ReasoningDelta { text, .. } if text == "plan"));
        assert!(
            matches!(&chunks[1], StreamChunk::ToolCallDelta { id, name: Some(name), .. } if id == "c1" && name == "read")
        );
        assert!(matches!(&chunks[2], StreamChunk::Finish { reason } if reason == "tool_calls"));
        assert!(
            matches!(&chunks[3], StreamChunk::Usage { usage } if usage.prompt_tokens == 11 && usage.completion_tokens == 6)
        );
    }

    #[test]
    fn minimax_think_tags_split_across_chunks_become_reasoning_then_text() {
        let body = br#"data: {"choices":[{"delta":{"content":"<th"}}]}

data: {"choices":[{"delta":{"content":"ink>secret "}}]}

data: {"choices":[{"delta":{"content":"plan</th"}}]}

data: {"choices":[{"delta":{"content":"ink>visible"}}]}

data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}

"#;
        let (chunks, result) = collect(body);
        assert!(result.is_ok());
        assert!(
            matches!(&chunks[0], StreamChunk::ReasoningDelta { text, .. } if text == "secret ")
        );
        assert!(matches!(&chunks[1], StreamChunk::ReasoningDelta { text, .. } if text == "plan"));
        assert!(matches!(&chunks[2], StreamChunk::TextDelta { text, .. } if text == "visible"));
        assert!(matches!(&chunks[3], StreamChunk::Usage { .. }));
        assert!(matches!(&chunks[4], StreamChunk::Finish { reason } if reason == "stop"));
    }

    #[test]
    fn plain_angle_bracket_text_is_not_treated_as_think_dialect() {
        let body = br#"data: {"choices":[{"delta":{"content":"compare < a and b"}}]}

data: {"choices":[{"delta":{},"finish_reason":"stop"}]}

"#;
        let (chunks, result) = collect(body);
        assert!(result.is_ok());
        assert!(
            matches!(&chunks[0], StreamChunk::TextDelta { text, .. } if text == "compare < a and b")
        );
        assert!(matches!(&chunks[1], StreamChunk::Finish { .. }));
    }

    #[test]
    fn eof_without_done_is_stream_closed() {
        let body = b"data: {\"choices\":[{\"delta\":{\"content\":\"\\u534a\\u53e5\"}}]}\n\n";
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
        assert!(
            matches!(&chunks[0], StreamChunk::ToolCallDelta { index: 0, id, name: Some(n), arguments_delta } if id == "c1" && n == "read" && arguments_delta == "{\"pa")
        );
        assert!(
            matches!(&chunks[1], StreamChunk::ToolCallDelta { index: 0, name: None, arguments_delta, .. } if arguments_delta == "th\"}")
        );
    }

    #[test]
    fn oversized_tool_call_index_clamps_to_max() {
        let body = b"data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":5000000000,\"id\":\"c1\",\"function\":{\"arguments\":\"{}\"}}]}}]}\n\ndata: [DONE]\n\n";
        let (chunks, r) = collect(body);
        assert!(r.is_ok());
        assert!(matches!(
            &chunks[0],
            StreamChunk::ToolCallDelta {
                index: u32::MAX,
                ..
            }
        ));
    }

    #[test]
    fn usage_on_choice_fallback() {
        let body = b"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\",\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":1}}]}\n\ndata: [DONE]\n\n";
        let (chunks, _) = collect(body);
        assert!(chunks
            .iter()
            .any(|c| matches!(c, StreamChunk::Usage { usage } if usage.prompt_tokens == 9)));
    }

    #[test]
    fn event_exceeding_limit_fails_bad_response() {
        let big = "x".repeat(64);
        let body = format!(
            "data: {{\"choices\":[{{\"delta\":{{\"content\":\"{big}\"}}}}]}}\n\ndata: [DONE]\n\n"
        );
        let (_, r) = collect_with(body.as_bytes(), 32);
        assert_eq!(r.unwrap_err().code, "BAD_RESPONSE");
    }

    #[test]
    fn multiline_data_accumulates_toward_limit() {
        // 两条 data 行各 20 字节，拼接后 41 字节 > 40：跨行也计入同一事件上限
        let body = b"data: {\"a\":\"aaaaaaaaaaaaaaaaaaaa\"\ndata: \"b\"}\n\ndata: [DONE]\n\n";
        let (_, r) = collect_with(body, 40);
        assert_eq!(r.unwrap_err().code, "BAD_RESPONSE");
    }

    #[test]
    fn callback_false_stops_parsing() {
        let body = b"data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"b\"}}]}\n\ndata: [DONE]\n\n";
        let mut n = 0;
        let r = parse_sse_lines(Cursor::new(body), u64::MAX, &mut |_c| {
            n += 1;
            false
        });
        assert!(r.is_ok());
        assert_eq!(n, 1, "回调返回 false 后立即停止投递");
    }
}
