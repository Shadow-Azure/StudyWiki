use serde::Deserialize;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

/// grep 工具请求参数；路径必须先过 `crate::ensure_authorized_read`。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepArgs {
    pub pattern: String,
    pub path: String,
    pub glob: Option<String>,
    pub ignore_case: bool,
    pub literal: bool,
    pub context: u32,
    pub limit: u32,
}

/// 单条命中；`before`/`after` 是不带行号的纯上下文行。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepMatch {
    pub path: String,
    pub line: u64,
    pub text: String,
    pub before: Vec<String>,
    pub after: Vec<String>,
}

/// grep 工具结果；`truncated` 表示解析侧到达全量 limit 并提前终止子进程。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepResult {
    pub matches: Vec<GrepMatch>,
    pub truncated: bool,
}

/// grep 工具稳定错误词表；message 只做诊断，不参与分支判断。
#[derive(Debug, serde::Serialize)]
pub struct GrepError {
    pub code: String,
    pub message: String,
}

/// 单次 grep 的硬预算：stdout 原始字节上限与相邻输出超时。
pub struct GrepBudget {
    pub raw_max_bytes: usize,
    pub timeout: Duration,
}

/// 发布默认 stdout 预算：20 MB。
pub const RAW_OUTPUT_MAX_BYTES: usize = 20_000_000;
/// 发布默认空闲超时：30 秒。
pub const SEARCH_TIMEOUT: Duration = Duration::from_secs(30);
/// 发布默认全量命中上限。
pub const DEFAULT_LIMIT: u32 = 100;

#[derive(Deserialize)]
struct RipgrepEvent {
    #[serde(rename = "type")]
    kind: String,
    data: RipgrepEventData,
}

#[derive(Deserialize)]
struct RipgrepEventData {
    path: Option<RipgrepText>,
    lines: Option<RipgrepText>,
    line_number: Option<u64>,
}

#[derive(Deserialize)]
struct RipgrepText {
    text: String,
}

struct SearchState {
    raw_bytes: usize,
    pending_line: Vec<u8>,
    matches: Vec<GrepMatch>,
    pending_before: Vec<String>,
    after_match: Option<usize>,
    limit: u32,
    truncated: bool,
    parse_error: Option<String>,
}

impl SearchState {
    fn new(limit: u32) -> Self {
        Self {
            limit,
            raw_bytes: 0,
            pending_line: Vec::new(),
            matches: Vec::new(),
            pending_before: Vec::new(),
            after_match: None,
            truncated: false,
            parse_error: None,
        }
    }

    fn total_bytes(&self) -> usize {
        self.raw_bytes + self.pending_line.len()
    }

    fn ingest(&mut self, chunk: &str) {
        for part in chunk.split_inclusive('\n') {
            self.pending_line.extend_from_slice(part.as_bytes());
            if self.pending_line.ends_with(b"\n") {
                let line = std::mem::take(&mut self.pending_line);
                self.raw_bytes += line.len();
                self.process_line(&line);
                if self.parse_error.is_some() || self.limit_reached() {
                    return;
                }
            }
        }
    }

    fn finish_pending_line(&mut self) {
        if !self.pending_line.is_empty() {
            let line = std::mem::take(&mut self.pending_line);
            self.raw_bytes += line.len();
            self.process_line(&line);
        }
    }

    fn limit_reached(&self) -> bool {
        self.limit > 0 && self.matches.len() >= self.limit as usize
    }

    fn process_line(&mut self, raw_line: &[u8]) {
        let line = String::from_utf8_lossy(raw_line)
            .trim_end_matches(['\r', '\n'])
            .to_owned();
        if line.is_empty() {
            return;
        }
        let Ok(event) = serde_json::from_str::<RipgrepEvent>(&line) else {
            self.parse_error = Some(format!("解析 rg JSON 失败：{line}"));
            return;
        };
        if event.kind != "match" && event.kind != "context" {
            if event.kind == "begin" || event.kind == "end" {
                self.pending_before.clear();
                self.after_match = None;
            }
            return;
        }
        let Some(text) = event
            .data
            .lines
            .map(|lines| trim_output_newline(&lines.text))
        else {
            return;
        };
        if event.kind == "context" {
            if let Some(index) = self.after_match {
                self.matches[index].after.push(text.clone());
            }
            self.pending_before.push(text);
            return;
        }

        let (Some(path), Some(line_number)) = (event.data.path, event.data.line_number) else {
            self.parse_error = Some("rg match 事件缺少 path 或 line_number".into());
            return;
        };
        self.after_match = None;
        let before = std::mem::take(&mut self.pending_before);
        self.matches.push(GrepMatch {
            path: path.text,
            line: line_number,
            text,
            before,
            after: Vec::new(),
        });
        self.after_match = Some(self.matches.len() - 1);
    }
}

fn trim_output_newline(value: &str) -> String {
    value.trim_end_matches(['\r', '\n']).to_owned()
}

fn failed(message: impl Into<String>) -> GrepError {
    GrepError {
        code: "SEARCH_FAILED".into(),
        message: message.into(),
    }
}

#[derive(Debug)]
enum StdoutEvent {
    Chunk(String),
    Eof,
    ReadError(String),
}

#[derive(Debug)]
enum CollectOutcome {
    Completed,
    LimitReached,
    ParseError,
    Overflow,
    ReadError(String),
}

impl CollectOutcome {
    fn read_error(self, stderr_tail: &str) -> Option<GrepError> {
        match self {
            Self::ReadError(detail) => {
                let tail = tail_chars(stderr_tail.trim(), 200);
                let message = if tail.is_empty() {
                    detail
                } else {
                    format!("{detail}：{tail}")
                };
                Some(GrepError {
                    code: "SEARCH_FAILED".into(),
                    message,
                })
            }
            _ => None,
        }
    }
}

/// Wait/collect seam: all timeout decisions happen here against the stdout
/// channel, so tests can pin them without spawning ripgrep.
fn collect_stdout(
    receiver: std::sync::mpsc::Receiver<StdoutEvent>,
    state: &mut SearchState,
    budget: &GrepBudget,
) -> Result<CollectOutcome, GrepError> {
    loop {
        match receiver.recv_timeout(budget.timeout) {
            Ok(StdoutEvent::Chunk(chunk)) => {
                if state.total_bytes() + chunk.len() > budget.raw_max_bytes {
                    return Ok(CollectOutcome::Overflow);
                }
                state.ingest(&chunk);
                if state.parse_error.is_some() {
                    return Ok(CollectOutcome::ParseError);
                }
                if state.limit_reached() {
                    return Ok(CollectOutcome::LimitReached);
                }
            }
            Ok(StdoutEvent::Eof) => return Ok(CollectOutcome::Completed),
            Ok(StdoutEvent::ReadError(detail)) => {
                return Ok(CollectOutcome::ReadError(detail));
            }
            Err(RecvTimeoutError::Timeout) => {
                return Err(GrepError {
                    code: "SEARCH_ABORTED".into(),
                    message: format!("rg 超过 {}ms 无输出", budget.timeout.as_millis()),
                });
            }
            Err(RecvTimeoutError::Disconnected) => return Ok(CollectOutcome::Completed),
        }
    }
}

fn shutdown_child(
    mut child: std::process::Child,
    stdout_reader: thread::JoinHandle<()>,
    stderr_reader: thread::JoinHandle<Result<String, std::io::Error>>,
) -> Result<String, GrepError> {
    let _ = child.kill();
    let _ = child.wait();
    let _ = stdout_reader.join();
    match stderr_reader.join() {
        Ok(Ok(stderr)) => Ok(stderr),
        Ok(Err(error)) => Err(failed(format!("读取 rg stderr 失败：{error}"))),
        Err(_) => Err(failed("rg stderr 读取线程终止")),
    }
}

fn tail_chars(value: &str, count: usize) -> String {
    let start = value
        .char_indices()
        .rev()
        .nth(count.saturating_sub(1))
        .map(|(index, _)| index)
        .unwrap_or(0);
    value[start..].to_owned()
}

/// 解析发布包内与主程序同级的 ripgrep sidecar；缺失时要求重新构建。
pub fn sidecar_path() -> Result<PathBuf, GrepError> {
    let extension = if cfg!(windows) { ".exe" } else { "" };
    let path = std::env::current_exe()
        .map_err(|e| failed(format!("定位主程序失败：{e}")))?
        .parent()
        .ok_or_else(|| failed("主程序路径没有父目录"))?
        .join(format!("rg-{}{extension}", env!("TARGET_TRIPLE")));
    if path.exists() {
        Ok(path)
    } else {
        Err(failed(format!(
            "rg sidecar 不存在：{}（请重新构建）",
            path.display()
        )))
    }
}

/// 执行一次 ripgrep sidecar：裸 argv 启动，流式解析 stdout，
/// 并按 raw bytes、超时和全量 limit 预算提前终止子进程。
pub fn run_grep(
    rg: &std::path::Path,
    args: &GrepArgs,
    budget: &GrepBudget,
) -> Result<GrepResult, GrepError> {
    let mut argv = vec![
        "--json".to_string(),
        "--line-number".to_string(),
        "--color=never".to_string(),
        "--hidden".to_string(),
    ];
    if args.ignore_case {
        argv.push("--ignore-case".to_string());
    }
    if args.literal {
        argv.push("--fixed-strings".to_string());
    }
    if let Some(glob) = &args.glob {
        argv.push("--glob".to_string());
        argv.push(glob.clone());
    }
    if args.context > 0 {
        argv.push("-C".to_string());
        argv.push(args.context.to_string());
    }
    let limit = if args.limit > 0 {
        args.limit
    } else {
        DEFAULT_LIMIT
    };
    if limit > 0 {
        argv.push("--max-count".to_string());
        argv.push(limit.to_string());
    }
    argv.push("--".to_string());
    argv.push(args.pattern.clone());
    argv.push(args.path.clone());

    let mut child = Command::new(rg)
        .args(&argv)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| failed(format!("spawn rg {} 失败：{e}", rg.display())))?;

    let Some(mut stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(failed("rg stdout 不可读取"));
    };
    let Some(mut stderr_pipe) = child.stderr.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(failed("rg stderr 不可读取"));
    };
    let stderr_reader = thread::spawn(move || {
        let mut stderr = String::new();
        stderr_pipe.read_to_string(&mut stderr).map(|_| stderr)
    });
    let (sender, receiver) = mpsc::channel::<StdoutEvent>();
    let reader = thread::spawn(move || {
        let mut buffer = vec![0_u8; 64 * 1024];
        let mut pending_bytes: Vec<u8> = Vec::new();
        loop {
            match stdout.read(&mut buffer) {
                Ok(0) => {
                    if !pending_bytes.is_empty() {
                        let tail = String::from_utf8_lossy(&pending_bytes).into_owned();
                        if sender.send(StdoutEvent::Chunk(tail)).is_err() {
                            break;
                        }
                    }
                    let _ = sender.send(StdoutEvent::Eof);
                    break;
                }
                Ok(size) => {
                    pending_bytes.extend_from_slice(&buffer[..size]);
                    let valid_bytes = match std::str::from_utf8(&pending_bytes) {
                        Ok(_) => pending_bytes.len(),
                        Err(error) => error.valid_up_to(),
                    };
                    if valid_bytes > 0 {
                        let chunk =
                            String::from_utf8_lossy(&pending_bytes[..valid_bytes]).into_owned();
                        pending_bytes.drain(..valid_bytes);
                        if sender.send(StdoutEvent::Chunk(chunk)).is_err() {
                            break;
                        }
                    }
                }
                Err(error) => {
                    let _ = sender.send(StdoutEvent::ReadError(format!(
                        "读取 rg stdout 失败：{error:?}"
                    )));
                    break;
                }
            }
        }
    });

    let mut state = SearchState::new(limit);
    match collect_stdout(receiver, &mut state, budget) {
        Ok(CollectOutcome::Overflow) => {
            let error = GrepError {
                code: "SEARCH_RAW_OUTPUT_OVERFLOW".into(),
                message: format!("rg stdout 超过 {} 字节预算", budget.raw_max_bytes),
            };
            let _ = shutdown_child(child, reader, stderr_reader);
            return Err(error);
        }
        Ok(CollectOutcome::ParseError) => {
            let message = state
                .parse_error
                .unwrap_or_else(|| "解析 rg 输出失败".into());
            let _ = shutdown_child(child, reader, stderr_reader);
            return Err(failed(message));
        }
        Ok(CollectOutcome::LimitReached) => {
            state.truncated = true;
            let _ = shutdown_child(child, reader, stderr_reader);
            return Ok(GrepResult {
                matches: state.matches,
                truncated: state.truncated,
            });
        }
        Ok(CollectOutcome::ReadError(detail)) => {
            let stderr = shutdown_child(child, reader, stderr_reader)?;
            return Err(CollectOutcome::ReadError(detail)
                .read_error(&stderr)
                .unwrap_or_else(|| failed("rg stdout 读取失败，但未携带错误详情")));
        }
        Ok(CollectOutcome::Completed) => {}
        Err(error) => {
            let _ = shutdown_child(child, reader, stderr_reader);
            return Err(error);
        }
    }

    state.finish_pending_line();
    if state.limit_reached() {
        state.truncated = true;
    }
    if let Some(message) = state.parse_error {
        let _ = shutdown_child(child, reader, stderr_reader);
        return Err(failed(message));
    }

    let _ = reader.join();
    let wait_result = child.wait();
    let stderr_result = stderr_reader.join();
    let status = wait_result.map_err(|e| failed(format!("等待 rg 退出失败：{e}")))?;
    let stderr = match stderr_result {
        Ok(Ok(stderr)) => stderr,
        Ok(Err(e)) => return Err(failed(format!("读取 rg stderr 失败：{e}"))),
        Err(_) => return Err(failed("rg stderr 读取线程终止")),
    };
    if status.success() || status.code() == Some(1) {
        return Ok(GrepResult {
            matches: state.matches,
            truncated: state.truncated,
        });
    }

    if status.code() == Some(2) && stderr.contains("regex parse error") {
        return Err(GrepError {
            code: "SEARCH_INVALID_PATTERN".into(),
            message: tail_chars(stderr.trim(), 200),
        });
    }
    Err(failed(format!(
        "rg 退出码 {:?}：{}",
        status.code(),
        tail_chars(stderr.trim(), 200)
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(rel: &str) -> String {
        format!("{}/tests/fixtures/grep/{rel}", env!("CARGO_MANIFEST_DIR"))
    }

    fn rg() -> std::path::PathBuf {
        sidecar_path().unwrap_or_else(|_| {
            let extension = if cfg!(windows) { ".exe" } else { "" };
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(format!("rg-{}{extension}", env!("TARGET_TRIPLE")))
        })
    }

    fn budget() -> GrepBudget {
        GrepBudget {
            raw_max_bytes: RAW_OUTPUT_MAX_BYTES,
            timeout: SEARCH_TIMEOUT,
        }
    }

    fn args(pattern: &str) -> GrepArgs {
        GrepArgs {
            pattern: pattern.into(),
            path: fixture("notes"),
            glob: None,
            ignore_case: false,
            literal: false,
            context: 0,
            limit: DEFAULT_LIMIT,
        }
    }

    #[test]
    fn match_lines_with_numbers() {
        let r = run_grep(&rg(), &args("线性代数"), &budget()).unwrap();
        assert_eq!(r.matches.len(), 2);
        assert!(r.matches[0].path.ends_with("a.md"));
        assert!(r.matches[0].line > 0);
        assert!(r.matches[0].text.contains("线性代数"));
        assert!(!r.truncated);
    }

    #[test]
    fn literal_and_glob_and_limit() {
        let mut a = args("a.b");
        a.literal = true;
        assert_eq!(run_grep(&rg(), &a, &budget()).unwrap().matches.len(), 1);

        let mut g = args("共享词");
        g.path = fixture("");
        g.glob = Some("*.md".into());
        let r = run_grep(&rg(), &g, &budget()).unwrap();
        assert!(r.matches.iter().all(|m| m.path.ends_with(".md")));

        let mut l = args("线");
        l.limit = 1;
        let r = run_grep(&rg(), &l, &budget()).unwrap();
        assert_eq!(r.matches.len(), 1);
        assert!(r.truncated);
    }

    #[test]
    fn invalid_pattern_reports_search_invalid_pattern() {
        let e = run_grep(&rg(), &args("(未闭合"), &budget()).unwrap_err();
        assert_eq!(e.code, "SEARCH_INVALID_PATTERN");
    }

    #[test]
    fn raw_output_overflow_reports() {
        let tiny = GrepBudget {
            raw_max_bytes: 256,
            timeout: SEARCH_TIMEOUT,
        };
        let e = run_grep(&rg(), &args("线"), &tiny).unwrap_err();
        assert_eq!(e.code, "SEARCH_RAW_OUTPUT_OVERFLOW");
    }

    #[test]
    fn stdout_read_error_maps_to_search_failed_through_seam() {
        let (sender, receiver) = std::sync::mpsc::channel::<StdoutEvent>();
        sender
            .send(StdoutEvent::ReadError("simulated stdout fd failure".into()))
            .unwrap();
        let mut state = SearchState::new(1);
        let outcome = collect_stdout(receiver, &mut state, &budget()).unwrap();
        let error = outcome
            .read_error("rg stderr diagnostic tail")
            .expect("ReadError must produce a failure");
        drop(sender);
        assert_eq!(error.code, "SEARCH_FAILED");
        assert!(error.message.contains("simulated stdout fd failure"));
        assert!(error.message.contains("rg stderr diagnostic tail"));
    }

    #[test]
    fn empty_stdout_channel_times_out_deterministically() {
        let (sender, receiver) = std::sync::mpsc::channel::<StdoutEvent>();
        let budget = GrepBudget {
            raw_max_bytes: RAW_OUTPUT_MAX_BYTES,
            timeout: std::time::Duration::from_millis(10),
        };
        let mut state = SearchState::new(1);
        let error = collect_stdout(receiver, &mut state, &budget).unwrap_err();
        drop(sender);
        assert_eq!(error.code, "SEARCH_ABORTED");
        assert!(state.matches.is_empty());
    }

    #[test]
    fn timeout_reports_aborted() {
        let instant = GrepBudget {
            raw_max_bytes: RAW_OUTPUT_MAX_BYTES,
            timeout: std::time::Duration::from_millis(1),
        };
        let e = run_grep(&rg(), &args("线"), &instant).unwrap_err();
        assert_eq!(e.code, "SEARCH_ABORTED");
    }

    #[test]
    fn shared_context_appears_before_and_after_adjacent_matches() {
        let mut a = args("命中");
        a.path = fixture("notes/context-pair.md");
        a.context = 2;
        let r = run_grep(&rg(), &a, &budget()).unwrap();
        assert_eq!(r.matches.len(), 2);
        assert_eq!(r.matches[0].after, vec!["中间共享上下文"]);
        assert_eq!(r.matches[1].before, vec!["中间共享上下文"]);
        assert_eq!(r.matches[1].after, vec!["唯一后文"]);
    }

    #[test]
    fn context_lines_do_not_carry_numbers() {
        let mut a = args("上下文命中行");
        a.context = 2;
        let r = run_grep(&rg(), &a, &budget()).unwrap();
        assert_eq!(r.matches.len(), 1);
        assert_eq!(r.matches[0].before, vec!["上下文前两行", "上下文前一行"]);
        assert_eq!(r.matches[0].after, vec!["上下文后一行", "上下文后两行"]);
        assert!(r.matches[0].text.contains("上下文命中行"));
    }

    #[test]
    fn context_does_not_cross_file_boundaries() {
        let mut state = SearchState::new(DEFAULT_LIMIT);
        let events = [
            r#"{"type":"begin","data":{}}"#,
            r#"{"type":"context","data":{"lines":{"text":"file-one-before"}}}"#,
            r#"{"type":"match","data":{"path":{"text":"/one.md"},"line_number":2,"lines":{"text":"file-one-match"}}}"#,
            r#"{"type":"end","data":{}}"#,
            r#"{"type":"begin","data":{}}"#,
            r#"{"type":"context","data":{"lines":{"text":"file-two-before"}}}"#,
            r#"{"type":"match","data":{"path":{"text":"/two.md"},"line_number":2,"lines":{"text":"file-two-match"}}}"#,
        ];
        for event in events {
            state.process_line(event.as_bytes());
        }

        assert_eq!(state.matches.len(), 2);
        assert_eq!(state.matches[0].before, vec!["file-one-before".to_string()]);
        assert!(state.matches[0].after.is_empty());
        assert_eq!(state.matches[1].before, vec!["file-two-before".to_string()]);
        assert_eq!(state.matches[1].path, "/two.md");
    }
}
