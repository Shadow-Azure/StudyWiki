use serde::Deserialize;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

/// grep 工具请求参数；路径必须先过 `crate::ensure_authorized`。
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

    fn ingest(&mut self, chunk: &[u8]) {
        for part in chunk.split_inclusive(|byte| *byte == b'\n') {
            self.pending_line.extend_from_slice(part);
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

fn shutdown_child(
    mut child: std::process::Child,
    stdout_reader: thread::JoinHandle<()>,
    stderr_reader: thread::JoinHandle<Result<String, std::io::Error>>,
) {
    let _ = child.kill();
    let _ = child.wait();
    let _ = stdout_reader.join();
    let _ = stderr_reader.join();
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
    let (sender, receiver) = mpsc::channel::<Result<Vec<u8>, String>>();
    let reader = thread::spawn(move || {
        let mut chunk = vec![0_u8; 64 * 1024];
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) => break,
                Ok(size) => {
                    if sender.send(Ok(chunk[..size].to_vec())).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = sender.send(Err(format!("读取 rg stdout 失败：{e}")));
                    break;
                }
            }
        }
    });

    let mut state = SearchState::new(limit);
    let mut budget_exceeded: Option<GrepError> = None;
    for message in std::iter::from_fn(|| {
        if budget_exceeded.is_some() {
            None
        } else {
            Some(receiver.recv_timeout(budget.timeout))
        }
    }) {
        match message {
            Ok(Ok(chunk)) => {
                if state.total_bytes() + chunk.len() > budget.raw_max_bytes {
                    budget_exceeded = Some(GrepError {
                        code: "SEARCH_RAW_OUTPUT_OVERFLOW".into(),
                        message: format!("rg stdout 超过 {} 字节预算", budget.raw_max_bytes),
                    });
                    break;
                }
                state.ingest(&chunk);
                if state.parse_error.is_some() {
                    shutdown_child(child, reader, stderr_reader);
                    return Err(failed(
                        state
                            .parse_error
                            .unwrap_or_else(|| "解析 rg 输出失败".into()),
                    ));
                }
                if state.limit_reached() {
                    state.truncated = true;
                    shutdown_child(child, reader, stderr_reader);
                    return Ok(GrepResult {
                        matches: state.matches,
                        truncated: state.truncated,
                    });
                }
            }
            Ok(Err(message)) => {
                budget_exceeded = Some(failed(message));
                break;
            }
            Err(RecvTimeoutError::Timeout) => {
                budget_exceeded = Some(GrepError {
                    code: "SEARCH_ABORTED".into(),
                    message: format!("rg 超过 {}ms 无输出", budget.timeout.as_millis()),
                });
                break;
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    if let Some(error) = budget_exceeded {
        shutdown_child(child, reader, stderr_reader);
        return Err(error);
    }

    let _ = reader.join();
    state.finish_pending_line();
    if state.limit_reached() {
        state.truncated = true;
    }
    if let Some(message) = state.parse_error {
        return Err(failed(message));
    }

    let status = child
        .wait()
        .map_err(|e| failed(format!("等待 rg 退出失败：{e}")))?;
    let stderr = match stderr_reader.join() {
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
}
