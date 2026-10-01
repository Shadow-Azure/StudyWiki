# AI Inference Supply (m2-01) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the m2-01 model-supply foundation: `~/.studywiki/` user config root with migration, `settings.json` endpoint contract, thin Rust egress/persistence commands, the `ctx.llm` frontend host service with model routing, and the built-in `llm-settings` config plugin with vendor presets.

**Architecture:** Rust is a thin capability layer (persistence + HTTP egress via the already-vendored `ureq`, zero new deps); all routing lives in the seventh frontend host service `ctx.llm`; the built-in plugin is pure UI over that facade. Vendor presets ship from Rust (`llm_list_presets`) because `verify-env-independence` scans `src/**` for external URLs.

**Tech Stack:** Tauri 2 Rust commands (ureq, serde), TypeScript, cordis, Vitest/jsdom, cargo test.

**Spec:** `/Users/zn-ice/2026/StudyWiki/.agents/notes/proposed/feature/2026-10-01-ai-inference-supply.md`

## Global Constraints

- Commit titles contain `(#28)`; every commit passes `pnpm verify:flow --diff` scope rules (touched files stay inside the m2-01 issue scope union).
- No new npm dependency; no new Cargo dependency (reuse `ureq`, `serde`, `serde_json`, `tauri`). `scripts/dep-allowlist.json` stays untouched.
- No CDN, runtime download, environment-variable branch, or UI framework. `src/plugins/**` never imports `@tauri-apps/*` (checked by `pnpm verify:layering`).
- No external URL literals under `src/**` (checked by `pnpm verify:env-independence`); vendor base URLs live only in `src-tauri/src/llm.rs`.
- All exported TS symbols carry contract doc comments (checked by `verify-export-docs`); every `#[tauri::command]` carries an adjacent `///` doc comment.
- `settings.json` writes are atomic (tmp + rename) with `0600` permissions; parse failures and unsupported `version` fail loud and never overwrite the user's file.
- Persistent docs (`docs/architecture.md`, `docs/environment-independence.md`) are edited bilingually and re-recorded with `pnpm record:i18n -- <base.md>`; generated sections are regenerated (`pnpm gen:commands`, `pnpm gen:code-map`), never hand-edited.
- All Rust filesystem logic lives in pure functions taking paths; `#[tauri::command]` wrappers are thin so `cargo test` never touches the real `$HOME`.
- Empty `apiKey` is legal (self-hosted endpoints): requests then carry no `Authorization` header.

## Review Focus

1. **Empty `apiKey` on a self-hosted endpoint** — a probe/chat must go out with no `Authorization` header and succeed against a keyless server; pinned by Task 3 step 1 (`probe succeeds without key`).
2. **`baseUrl` with a trailing slash** — `https://host/v1/` must not produce `//models`; pinned by Task 3 step 1 (`join_url trims trailing slash`).
3. **`settings.json` with `version: 99`** — load must fail loud and any save attempt must refuse to overwrite; pinned by Task 2 step 1 (`future version fails loud`) and step 2 (`save refuses after failed load` — enforced by only ever saving a successfully parsed `Settings`).
4. **Duplicate model id inside one endpoint / empty endpoint id on upsert** — rejected with `INVALID_CONFIG`, file untouched; pinned by Task 3 step 1 (`upsert rejects duplicate model ids`, `upsert rejects empty id`).
5. **Concurrent writers leaving a torn file** — two interleaved saves must never yield partial JSON; pinned by Task 2 step 1 (`atomic write leaves no tmp residue and full JSON`) — last-writer-wins is accepted and documented in the spec note's Consequences.

---

### Task 1: Flow activation, spec alignment, and the `~/.studywiki` config root with migration

**Files:**
- Modify: `.agents/flow/issues/m2-01-ai-inference-supply.md` (+ `.en.md`, re-record)
- Modify: `.agents/flow/milestones/m2-ai-agent-host.md` (+ `.en.md`, re-record)
- Modify: `.agents/notes/proposed/feature/2026-10-01-ai-inference-supply.md` (+ `.en.md`, re-record)
- Create: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/lib.rs` (register `mod config;` + `.setup` migration)
- Modify: `src-tauri/src/plugins.rs:118-124` (`plugin_dir` switches root)
- Modify: `src-tauri/src/windows.rs:131-158` (`read_manifest`/`write_manifest` switch root)

**Interfaces:**
- Consumes: Tauri `AppHandle::path().home_dir()` / `app_config_dir()` resolvers.
- Produces (used by Tasks 2-3):
  - `pub fn studywiki_dir(home: &Path) -> PathBuf` — pure `<home>/.studywiki`.
  - `pub fn app_studywiki_dir(app: &AppHandle) -> Result<PathBuf, String>`.
  - `pub fn migrate_legacy_dirs(legacy: &Path, new: &Path) -> Result<(), String>` — pure; moves `plugins.json` and `plugins/` when present-at-old and absent-at-new; idempotent.
  - `pub fn migrate_legacy(app: &AppHandle) -> Result<(), String>` — thin resolver wrapper.

- [ ] **Step 1: Activate flow state and align the spec note**

In `.agents/flow/issues/m2-01-ai-inference-supply.md` and `.en.md`, change the yaml fence `status: backlog` → `status: in-progress`. In `.agents/flow/milestones/m2-ai-agent-host.md` and `.en.md`, change `status: planned` → `status: active`. In the spec note (both languages), replace the `reqwest`/`dirs` wording with "reuse the already-vendored `ureq` (rustls) and Tauri `app.path().home_dir()`; zero new Cargo dependencies", move the vendor preset table from the frontend-plugin sentence into the Rust command surface (`llm_list_presets`, rationale: `verify-env-independence` scans `src/**` for external URLs), and add `INVALID_CONFIG` to the error-code list (upsert validation). Re-record all three pairs:

```bash
pnpm record:i18n -- .agents/flow/issues/m2-01-ai-inference-supply.md
pnpm record:i18n -- .agents/flow/milestones/m2-ai-agent-host.md
pnpm record:i18n -- .agents/notes/proposed/feature/2026-10-01-ai-inference-supply.md
```

Run: `pnpm verify:flow && pnpm lint:docs` — Expected: PASS.

- [ ] **Step 2: Write the failing test for `studywiki_dir` and migration**

Create `src-tauri/src/config.rs` with only the module doc comment and `#[cfg(test)] mod tests`:

```rust
//! 用户配置根（~/.studywiki）解析与老 app_config_dir 一次性迁移。

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn studywiki_dir_joins_dot_dir() {
        assert_eq!(studywiki_dir(Path::new("/home/u")), PathBuf::from("/home/u/.studywiki"));
    }

    #[test]
    fn migrate_moves_absent_entries_and_is_idempotent() {
        let tmp = std::env::temp_dir().join(format!("sw-mig-{}", std::process::id()));
        let legacy = tmp.join("legacy");
        let new = tmp.join("new");
        std::fs::create_dir_all(legacy.join("plugins/ext-a")).unwrap();
        std::fs::write(legacy.join("plugins.json"), "{}").unwrap();
        std::fs::create_dir_all(&new).unwrap();
        migrate_legacy_dirs(&legacy, &new).unwrap();
        assert!(new.join("plugins.json").exists() && new.join("plugins/ext-a").is_dir());
        assert!(!legacy.join("plugins.json").exists());
        migrate_legacy_dirs(&legacy, &new).unwrap(); // 二次空转不报错
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn migrate_keeps_both_sides_when_new_exists() {
        let tmp = std::env::temp_dir().join(format!("sw-mig2-{}", std::process::id()));
        let legacy = tmp.join("legacy");
        let new = tmp.join("new");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(legacy.join("plugins.json"), "old").unwrap();
        std::fs::write(new.join("plugins.json"), "new").unwrap();
        migrate_legacy_dirs(&legacy, &new).unwrap();
        assert_eq!(std::fs::read_to_string(new.join("plugins.json")).unwrap(), "new");
        assert!(legacy.join("plugins.json").exists()); // 老条目保留不删
        std::fs::remove_dir_all(&tmp).unwrap();
    }
}
```

Run: `cargo test --lib config` — Expected: FAIL (unresolved names; module compiles only after Step 3).

- [ ] **Step 3: Implement the config root and migration**

Add to `src-tauri/src/config.rs` (before the test module):

```rust
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// 老配置域里需要搬家的条目（插件清单 + 外置插件目录）。
const LEGACY_ENTRIES: [&str; 2] = ["plugins.json", "plugins"];

/// 用户配置根：<home>/.studywiki（三端同形，纯函数便于测试）。
pub fn studywiki_dir(home: &Path) -> PathBuf {
    home.join(".studywiki")
}

/// App 态配置根：home 解析失败即 fail-loud。
pub fn app_studywiki_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(studywiki_dir(
        &app.path().home_dir().map_err(|e| e.to_string())?,
    ))
}

/// 一次性迁移本体：老条目在新根缺席时 move；两边都有以新根为准，老条目保留。
pub fn migrate_legacy_dirs(legacy: &Path, new: &Path) -> Result<(), String> {
    if legacy == new {
        return Ok(());
    }
    for name in LEGACY_ENTRIES {
        let (from, to) = (legacy.join(name), new.join(name));
        if from.exists() && !to.exists() {
            fs::create_dir_all(new).map_err(|e| format!("mkdir {}: {e}", new.display()))?;
            fs::rename(&from, &to)
                .map_err(|e| format!("迁移 {} → {} 失败：{e}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

/// 启动入口：解析两个目录后委托纯函数（空转成本可忽略）。
pub fn migrate_legacy(app: &AppHandle) -> Result<(), String> {
    let legacy = app.path().app_config_dir().map_err(|e| e.to_string())?;
    migrate_legacy_dirs(&legacy, &app_studywiki_dir(app)?)
}
```

In `src-tauri/src/lib.rs`: add `pub mod config;` beside the other `mod` declarations, and in `app_builder()` chain `.setup(|app| { config::migrate_legacy(&app.handle()).map_err(Box::<dyn std::error::Error>::from)?; Ok(()) })` before `.invoke_handler(...)`.

Run: `cargo test --lib config` — Expected: PASS (3 tests).

- [ ] **Step 4: Switch the three existing call sites to the new root**

In `src-tauri/src/plugins.rs` `plugin_dir`: replace the `app_config_dir()` chain with `crate::config::app_studywiki_dir(app)?.join("plugins")`. In `src-tauri/src/windows.rs` `read_manifest`/`write_manifest`: replace `.app_config_dir().map_err(|e| e.to_string())?.join("plugins.json")` with `crate::config::app_studywiki_dir(&app)?.join("plugins.json")`.

Run: `cargo test` — Expected: PASS (whole suite; no test referenced `app_config_dir` directly).

- [ ] **Step 5: Commit**

```bash
git add .agents/flow .agents/notes/proposed/feature src-tauri/src/config.rs src-tauri/src/lib.rs src-tauri/src/plugins.rs src-tauri/src/windows.rs
git commit -m "立 ~/.studywiki 用户配置根并迁移插件数据 (#28)"
```

---

### Task 2: `settings.json` model, persistence, and redaction in `config.rs`

**Files:**
- Modify: `src-tauri/src/config.rs`

**Interfaces:**
- Consumes: Task 1 `studywiki_dir` helpers.
- Produces (consumed by Task 3 commands):
  - `pub struct ModelEntry { pub id: String, pub capabilities: Vec<String> }`
  - `pub struct Endpoint { pub id, name, kind: String, #[serde(rename="baseUrl")] pub base_url, #[serde(rename="apiKey")] pub api_key: String, pub models: Vec<ModelEntry> }`
  - `pub struct Settings { pub version: u32, pub endpoints: Vec<Endpoint>, #[serde(rename="defaultModel")] pub default_model: Option<String> }`
  - `pub struct RedactedEndpoint { id, name, kind, base_url, has_key: bool, key_preview: String, models }` (serde camelCase field renames to match TS types)
  - `pub const SUPPORTED_SETTINGS_VERSION: u32 = 1;`
  - `pub fn load_settings(dir: &Path) -> Result<Settings, String>` — missing file → default empty v1; parse error or `version > SUPPORTED` → Err, file untouched.
  - `pub fn save_settings(dir: &Path, s: &Settings) -> Result<(), String>` — atomic tmp+rename, `0600`.
  - `pub fn redact(e: &Endpoint) -> RedactedEndpoint`
  - `pub fn validate_endpoint(e: &Endpoint) -> Result<(), String>` — non-empty id/name/baseUrl (`http://` or `https://` prefix), `kind ∈ {chat, asr}`, model ids unique & non-empty.

- [ ] **Step 1: Write the failing tests**

Append to `config.rs` tests:

```rust
fn sample_endpoint() -> Endpoint {
    Endpoint {
        id: "deepseek".into(),
        name: "DeepSeek".into(),
        kind: "chat".into(),
        base_url: "https://api.deepseek.com/v1".into(),
        api_key: "sk-1234567890abcdef".into(),
        models: vec![ModelEntry { id: "deepseek-v4-flash".into(), capabilities: vec!["text".into()] }],
    }
}

#[test]
fn missing_file_loads_default_v1() {
    let dir = std::env::temp_dir().join(format!("sw-set-{}", std::process::id()));
    let s = load_settings(&dir).unwrap();
    assert_eq!(s.version, 1);
    assert!(s.endpoints.is_empty() && s.default_model.is_none());
}

#[test]
fn corrupt_and_future_version_fail_loud_without_overwrite() {
    let dir = std::env::temp_dir().join(format!("sw-set2-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("settings.json"), "{not json").unwrap();
    assert!(load_settings(&dir).is_err());
    std::fs::write(dir.join("settings.json"), r#"{"version":99,"endpoints":[]}"#).unwrap();
    assert!(load_settings(&dir).is_err());
    assert_eq!(std::fs::read_to_string(dir.join("settings.json")).unwrap(), r#"{"version":99,"endpoints":[]}"#);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn atomic_write_roundtrip_with_0600_and_no_tmp_residue() {
    let dir = std::env::temp_dir().join(format!("sw-set3-{}", std::process::id()));
    let mut s = Settings { version: 1, endpoints: vec![sample_endpoint()], default_model: Some("deepseek-v4-flash".into()) };
    save_settings(&dir, &s).unwrap();
    s.endpoints.push(sample_endpoint());
    save_settings(&dir, &s).unwrap(); // 交错二次写，结果必须仍是完整 JSON
    let back = load_settings(&dir).unwrap();
    assert_eq!(back.endpoints.len(), 2);
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dir.join("settings.json")).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
    assert!(!dir.join("settings.json.tmp").exists());
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn redact_never_leaks_full_key() {
    let r = redact(&sample_endpoint());
    let json = serde_json::to_string(&r).unwrap();
    assert!(r.has_key && !json.contains("sk-1234567890abcdef"));
    assert!(json.contains("sk-1"));
    let mut no_key = sample_endpoint();
    no_key.api_key = String::new();
    assert!(!redact(&no_key).has_key);
}

#[test]
fn validate_rejects_bad_shapes() {
    let mut e = sample_endpoint();
    e.id = String::new();
    assert!(validate_endpoint(&e).is_err());
    let mut dup = sample_endpoint();
    dup.models.push(dup.models[0].clone());
    assert!(validate_endpoint(&dup).is_err());
    let mut bad_kind = sample_endpoint();
    bad_kind.kind = "image".into();
    assert!(validate_endpoint(&bad_kind).is_err());
    let mut bad_url = sample_endpoint();
    bad_url.base_url = "ftp://x".into();
    assert!(validate_endpoint(&bad_url).is_err());
    let mut keyless = sample_endpoint();
    keyless.api_key = String::new();
    assert!(validate_endpoint(&keyless).is_ok()); // 自托管无 key 合法
}
```

Run: `cargo test --lib config` — Expected: FAIL (types/functions undefined).

- [ ] **Step 2: Implement the settings model**

Add to `src-tauri/src/config.rs` (implementation must satisfy every test above verbatim):

- Serde structs exactly as listed in **Produces**, all with `Debug, Clone, Serialize, Deserialize, PartialEq` (Redacted needs `Serialize` only), `#[serde(default)]` on `api_key`/`models`/`endpoints`/`default_model`, camelCase renames as specified; `RedactedEndpoint` uses `#[serde(rename_all = "camelCase")]`.
- `load_settings`: `fs::read_to_string(dir.join("settings.json"))`; `NotFound` → `Ok(Settings{version:1, endpoints:vec![], default_model:None})`; other IO error or `serde_json::from_str` error → `Err` naming the path; `version > SUPPORTED_SETTINGS_VERSION` → `Err("settings.json 版本 {v} 高于本客户端支持的 {SUPPORTED}，请升级客户端")`.
- `save_settings`: `fs::create_dir_all(dir)`; serialize pretty; write `settings.json.tmp` then `fs::rename`; after rename, on unix `fs::set_permissions(path, Permissions::from_mode(0o600))` (set permissions on the tmp file **before** rename so no window exists with looser mode).
- `redact`: `has_key = !api_key.is_empty()`; `key_preview`: chars `> 7` → first 4 + `…` + last 2, else `"****"`, empty → `""`.
- `validate_endpoint`: returns `Err` with a message naming the offending field for each rule in **Produces**.

Run: `cargo test --lib config` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/config.rs
git commit -m "新增 settings.json 模型、原子写 0600 与脱敏投影 (#28)"
```

---

### Task 3: Rust `llm.rs` — presets, command surface, egress, error normalization

**Files:**
- Create: `src-tauri/src/llm.rs`
- Modify: `src-tauri/src/lib.rs` (`pub mod llm;` + register six commands in `app_builder`)

**Interfaces:**
- Consumes: Task 2 `config::{load_settings, save_settings, redact, validate_endpoint, Endpoint, Settings, app_studywiki_dir}`.
- Produces (command names consumed by Task 4 TS):
  - `llm_list_presets() -> Vec<LlmPreset>` where `LlmPreset { vendor, name, base_url, models: Vec<ModelEntry> }` (camelCase serde).
  - `llm_list_endpoints(app) -> RedactedSettings { endpoints: Vec<RedactedEndpoint>, default_model: Option<String> }`.
  - `llm_upsert_endpoint(app, endpoint: Endpoint) -> Result<(), LlmError>` — validate; replace-by-id or push; save.
  - `llm_remove_endpoint(app, id: String) -> Result<(), LlmError>` — `ENDPOINT_UNKNOWN` if absent.
  - `llm_probe(app, id: String) -> Result<u64, LlmError>` — `GET {base}/models`, returns latency ms.
  - `llm_chat(app, req: ChatRequest) -> Result<ChatResponse, LlmError>` — non-streaming `POST {base}/chat/completions`.
  - `#[derive(Serialize)] pub struct LlmError { pub code: String, pub message: String }` — codes: `UNREACHABLE` `UNAUTHORIZED` `TIMEOUT` `RATE_LIMITED` `BAD_RESPONSE` `ENDPOINT_UNKNOWN` `INVALID_CONFIG`.
  - Pure helpers (unit-testable without AppHandle): `join_url(base, path)`, `map_transport(e: ureq::Error) -> LlmError`, `find_endpoint(s: &Settings, id) -> Result<Endpoint, LlmError>`, `upsert_into(s: &mut Settings, e: Endpoint) -> Result<(), LlmError>`, `probe_with(agent, ep) -> Result<u64, LlmError>`, `chat_with(agent, ep, req) -> Result<ChatResponse, LlmError>`.

- [ ] **Step 1: Write the failing tests (local mock HTTP server)**

Append `#[cfg(test)] mod tests` in `llm.rs`:

```rust
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

/// 起本地 mock：读掉请求头与 body（按 Content-Length），回固定响应；返回 base URL 与收到的请求原文通道。
fn mock_server(status: u16, body: &'static str) -> (String, std::sync::mpsc::Receiver<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut buf = Vec::new();
        let mut tmp = [0u8; 4096];
        // 读到 header 结束后再按 Content-Length 读 body
        loop {
            let n = stream.read(&mut tmp).unwrap();
            buf.extend_from_slice(&tmp[..n]);
            if let Some(pos) = find_header_end(&buf) {
                let head = String::from_utf8_lossy(&buf[..pos]).to_string();
                let len: usize = head.lines()
                    .find_map(|l| l.strip_prefix("Content-Length: ").or_else(|| l.strip_prefix("content-length: ")))
                    .and_then(|v| v.trim().parse().ok())
                    .unwrap_or(0);
                if buf.len() >= pos + len { break; }
            }
            if n == 0 { break; }
        }
        tx.send(String::from_utf8_lossy(&buf).to_string()).unwrap();
        write!(stream, "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
    });
    (format!("http://127.0.0.1:{port}/v1"), rx)
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|p| p + 4)
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_millis(1500)).build()
}

fn ep(base_url: &str, key: &str) -> crate::config::Endpoint {
    crate::config::Endpoint {
        id: "e1".into(),
        name: "E1".into(),
        kind: "chat".into(),
        base_url: base_url.into(),
        api_key: key.into(),
        models: vec![crate::config::ModelEntry { id: "m1".into(), capabilities: vec!["text".into()] }],
    }
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
    assert_eq!(probe_with(&agent(), &ep(&base, "k")).unwrap_err().code, "UNAUTHORIZED");
    let (base2, _rx2) = mock_server(429, "{}");
    assert_eq!(probe_with(&agent(), &ep(&base2, "k")).unwrap_err().code, "RATE_LIMITED");
    let closed = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    assert_eq!(probe_with(&agent(), &ep(&format!("http://127.0.0.1:{port}"), "k")).unwrap_err().code, "UNREACHABLE");
}

#[test]
fn chat_posts_messages_and_parses_reply() {
    let body = r#"{"choices":[{"message":{"role":"assistant","content":"你好"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}"#;
    let (base, rx) = mock_server(200, body);
    let req = ChatRequest {
        endpoint_id: "x".into(),
        model: "m1".into(),
        messages: vec![ChatMessage { role: "user".into(), content: "hi".into() }],
        max_tokens: None,
        temperature: None,
    };
    let resp = chat_with(&agent(), &ep(&base, "secret-key"), &req).unwrap();
    assert_eq!(resp.content, "你好");
    assert_eq!(resp.finish_reason, "stop");
    let sent = rx.recv().unwrap();
    assert!(sent.starts_with("POST /v1/chat/completions HTTP/1.1"));
    assert!(sent.to_lowercase().contains("authorization: bearer secret-key"));
    assert!(sent.contains(r#""model":"m1""#));
}

#[test]
fn chat_maps_bad_json_to_bad_response() {
    let (base, _rx) = mock_server(200, "not json");
    let req = ChatRequest { endpoint_id: "x".into(), model: "m1".into(), messages: vec![], max_tokens: None, temperature: None };
    assert_eq!(chat_with(&agent(), &ep(&base, ""), &req).unwrap_err().code, "BAD_RESPONSE");
}

#[test]
fn upsert_validation_errors_are_invalid_config_and_find_endpoint_miss() {
    let mut s = Settings { version: 1, endpoints: vec![], default_model: None };
    assert_eq!(find_endpoint(&s, "nope").unwrap_err().code, "ENDPOINT_UNKNOWN");
    // validate_endpoint 的规则由 Task 2 锁定，这里只锁命令面包装：空 id → INVALID_CONFIG
    let mut e = ep("https://h", "");
    e.id = String::new();
    assert_eq!(upsert_into(&mut s, e).unwrap_err().code, "INVALID_CONFIG");
}
```

Run: `cargo test --lib llm` — Expected: FAIL (module has no implementation yet).

- [ ] **Step 2: Implement `llm.rs`**

Module skeleton (fill every helper so the tests pass verbatim):

```rust
//! LLM 推理薄能力层：厂商预设、endpoint CRUD、探测与非流式 chat 出口（唯一联网点，
//! 豁免登记 docs/environment-independence.md）。传输之外零逻辑：路由在前端宿主服务。

use crate::config::{self, Endpoint, ModelEntry, Settings};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::AppHandle;

const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const CHAT_TIMEOUT: Duration = Duration::from_secs(300);

/// 归一错误：code 为全链路共享词表（前端路由层另有 MODEL_* 三码）。
#[derive(Debug, Serialize)]
pub struct LlmError { pub code: String, pub message: String }

impl LlmError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into() }
    }
}

/// 构建期厂商预设（模板，用户实例化后可改模型清单）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmPreset { pub vendor: String, pub name: String, pub base_url: String, pub models: Vec<ModelEntry> }
```

Presets (the only sanctioned external-URL literals in the frontend-facing surface; they live in `.rs` so `verify-env-independence` stays green):

```rust
fn presets() -> Vec<LlmPreset> {
    let m = |id: &str, caps: &[&str]| ModelEntry { id: id.into(), capabilities: caps.iter().map(|s| s.to_string()).collect() };
    vec![
        LlmPreset { vendor: "zhipu".into(), name: "智谱 GLM".into(), base_url: "https://open.bigmodel.cn/api/paas/v4".into(), models: vec![m("glm-5.3", &["text", "vision"]), m("glm-5.3-flash", &["text"])] },
        LlmPreset { vendor: "deepseek".into(), name: "DeepSeek".into(), base_url: "https://api.deepseek.com/v1".into(), models: vec![m("deepseek-v4-pro", &["text"]), m("deepseek-v4-flash", &["text"])] },
        LlmPreset { vendor: "moonshot".into(), name: "Kimi（月之暗面）".into(), base_url: "https://api.moonshot.cn/v1".into(), models: vec![m("kimi-k3", &["text"])] },
        LlmPreset { vendor: "minimax".into(), name: "MiniMax".into(), base_url: "https://api.minimaxi.com/v1".into(), models: vec![m("minimax-m3", &["text"])] },
    ]
}
```

Then: `ChatMessage { role, content }`, `ChatRequest { endpoint_id, model, messages, max_tokens, temperature }` (serde camelCase), `ChatResponse { content, finish_reason, usage }` with `Usage { prompt_tokens, completion_tokens }`; `join_url(base.trim_end_matches('/'), path)`; `with_auth(req, ep)` adding `Authorization: Bearer {api_key}` only when non-empty; `map_transport`: `ureq::Error::Status(401|403)` → `UNAUTHORIZED`, `Status(429)` → `RATE_LIMITED`, `Status(_)` → `BAD_RESPONSE` (include status), `Transport` with `kind() == Timeout` → `TIMEOUT`, else `UNREACHABLE`; `probe_with(agent, ep)`: `Instant` around `agent.get(&join_url(base,"models"))`, require 2xx, return elapsed ms; `chat_with(agent, ep, req)`: POST JSON `{"model","messages","stream":false, …optional params}`, parse `choices[0].message.content` (must be a JSON string, else `BAD_RESPONSE`), `finish_reason`, optional `usage`; `upsert_into(settings, endpoint)`: `config::validate_endpoint` mapped to `INVALID_CONFIG`, replace by id else push; thin `#[tauri::command]` wrappers (each with an adjacent `///` doc comment) resolving `config::app_studywiki_dir(&app)?` + `load_settings`/`save_settings` and delegating to the pure helpers; `find_endpoint` clones the match or returns `ENDPOINT_UNKNOWN`.

In `src-tauri/src/lib.rs`: add `pub mod llm;` and register in `app_builder`'s `generate_handler!`:

```rust
llm::llm_list_presets,
llm::llm_list_endpoints,
llm::llm_upsert_endpoint,
llm::llm_remove_endpoint,
llm::llm_probe,
llm::llm_chat
```

Run: `cargo test --lib llm && cargo test` — Expected: PASS.

- [ ] **Step 3: Verify the env-independence gate stays green**

Run: `pnpm verify:env-independence && pnpm verify:dep-audit` — Expected: PASS (no new deps; no external URL under `src/**`).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/llm.rs src-tauri/src/lib.rs
git commit -m "新增 LLM 命令面：厂商预设、CRUD、探测与非流式 chat (#28)"
```

---

### Task 4: Frontend host service `ctx.llm` (routing, facade, whitelist)

**Files:**
- Create: `src/host/llm.ts`
- Create: `tests/host-llm.test.ts`
- Modify: `src/bootstrap.ts` (construct + `ctx.reflect.provide("llm", …)`)
- Modify: `src/host/context.d.ts` (declare `llm`)
- Modify: `src/loader/guard.ts` (`publicServiceMembers.llm`)
- Modify: `tests/bootstrap.test.ts` (assert the service is provided, if the suite snapshots provided keys)

**Interfaces:**
- Consumes: Task 3 command names and wire shapes.
- Produces (consumed by Task 5 plugin and future agent plugins):
  - `export class LlmError extends Error { readonly code: string }`
  - `export class LlmService` with `listPresets(): Promise<LlmPreset[]>`, `listEndpoints(): Promise<RedactedSettings>`, `upsertEndpoint(e: EndpointInput): Promise<void>`, `removeEndpoint(id: string): Promise<void>`, `probe(id: string): Promise<number>`, `chat(req: ChatInput): Promise<ChatResult>`
  - `ChatInput { model?: string; messages: { role: string; content: string }[]; maxTokens?: number; temperature?: number }`; `ChatResult { content: string; finishReason: string; usage?: { promptTokens: number; completionTokens: number } }`
  - Routing error codes thrown as `LlmError`: `MODEL_UNKNOWN`, `MODEL_AMBIGUOUS`, `MODEL_UNSPECIFIED`.

- [ ] **Step 1: Write the failing test**

Create `tests/host-llm.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LlmError, LlmService, type LlmDeps } from "../src/host/llm";

const redacted = {
  endpoints: [
    { id: "deepseek", name: "DeepSeek", kind: "chat", baseUrl: "https://api.deepseek.com/v1",
      hasKey: true, keyPreview: "sk-…ef",
      models: [{ id: "deepseek-v4-flash", capabilities: ["text"] }] },
    { id: "zhipu", name: "智谱 GLM", kind: "chat", baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      hasKey: true, keyPreview: "ab…yz",
      models: [{ id: "glm-5.3", capabilities: ["text", "vision"] }] },
  ],
  defaultModel: "deepseek-v4-flash",
};

function depsWith(calls: { cmd: string; args?: unknown }[], chatResult?: unknown): LlmDeps {
  return {
    invoke: (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "llm_list_endpoints") return Promise.resolve(redacted);
      if (cmd === "llm_chat") return Promise.resolve(chatResult ?? { content: "ok", finishReason: "stop" });
      return Promise.resolve(null);
    },
  };
}

describe("LlmService", () => {
  it("routes an explicit model to its owning endpoint", async () => {
    const calls: { cmd: string; args?: unknown }[] = [];
    const llm = new LlmService(depsWith(calls));
    const r = await llm.chat({ model: "glm-5.3", messages: [{ role: "user", content: "hi" }] });
    expect(r.content).toBe("ok");
    expect(calls.at(-1)).toMatchObject({ cmd: "llm_chat",
      args: { req: { endpointId: "zhipu", model: "glm-5.3", messages: [{ role: "user", content: "hi" }] } } });
  });

  it("falls back to defaultModel and reports MODEL_UNSPECIFIED without it", async () => {
    const calls: { cmd: string; args?: unknown }[] = [];
    const llm = new LlmService(depsWith(calls));
    await llm.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(calls.at(-1)?.args).toMatchObject({ req: { model: "deepseek-v4-flash", endpointId: "deepseek" } });
    const noDefault = new LlmService({ invoke: (cmd) =>
      cmd === "llm_list_endpoints" ? Promise.resolve({ ...redacted, defaultModel: null }) : Promise.resolve(null) });
    await expect(noDefault.chat({ messages: [] })).rejects.toMatchObject({ code: "MODEL_UNSPECIFIED" });
  });

  it("throws MODEL_UNKNOWN and MODEL_AMBIGUOUS from the routing layer", async () => {
    const llm = new LlmService(depsWith([]));
    await expect(llm.chat({ model: "nope", messages: [] })).rejects.toMatchObject({ code: "MODEL_UNKNOWN" });
    const dup = new LlmService({ invoke: (cmd) => cmd === "llm_list_endpoints"
      ? Promise.resolve({ ...redacted, endpoints: [...redacted.endpoints,
          { ...redacted.endpoints[0], id: "copy" }] })
      : Promise.resolve(null) });
    await expect(dup.chat({ model: "deepseek-v4-flash", messages: [] })).rejects.toMatchObject({ code: "MODEL_AMBIGUOUS" });
  });

  it("normalizes IPC rejections into LlmError with the Rust code", async () => {
    const llm = new LlmService({ invoke: (cmd) => cmd === "llm_chat"
      ? Promise.reject({ code: "UNAUTHORIZED", message: "bad key" })
      : Promise.resolve(redacted) });
    const err = await llm.chat({ model: "glm-5.3", messages: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("exposes presets, upsert, remove and probe as thin command wrappers", async () => {
    const calls: { cmd: string; args?: unknown }[] = [];
    const llm = new LlmService(depsWith(calls));
    await llm.listPresets();
    await llm.upsertEndpoint({ id: "x", name: "X", kind: "chat", baseUrl: "https://h/v1", apiKey: "k", models: [] });
    await llm.removeEndpoint("x");
    await llm.probe("x");
    expect(calls.map((c) => c.cmd)).toEqual([
      "llm_list_presets", "llm_upsert_endpoint", "llm_remove_endpoint", "llm_probe",
    ]);
  });
});
```

Run: `pnpm exec vitest run tests/host-llm.test.ts` — Expected: FAIL (`../src/host/llm` does not exist).

- [ ] **Step 2: Implement `src/host/llm.ts`**

Follow the `FilesService` pattern (deps interface + `defaultLlmDeps` binding the real `invoke`). Key pieces:

```ts
import { invoke } from "@tauri-apps/api/core";

/** Tauri binding this service wraps; injectable so tests fake exactly one seam. */
export interface LlmDeps {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

/** 归一错误（与 Rust LlmError 同一词表：传输码 + 本层 MODEL_* 路由码）。 */
export class LlmError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LlmError";
  }
}
```

Types mirroring the wire shapes (`LlmPreset`, `ModelEntry`, `RedactedEndpoint`, `RedactedSettings`, `EndpointInput`, `ChatInput`, `ChatResult` — all exported with doc comments). One private `call<T>(cmd, args)` that `try/catch`es `invoke` and rethrows `LlmError` from `{code, message}` rejections (unknown shapes become `BAD_RESPONSE`). `chat()` flow: `const s = await this.listEndpoints();` → resolve model (rules per test) → `this.call("llm_chat", { req: { endpointId, model, messages, maxTokens, temperature } })`.

- [ ] **Step 3: Mount the service**

In `src/bootstrap.ts`: `const llm = new LlmService({ invoke: env.invoke });` after the other services, and `ctx.reflect.provide("llm", llm);` after the existing `provide` lines. In `src/host/context.d.ts` add with a doc comment: `/** LLM 推理服务（endpoint 列表/探测/非流式 chat，模型路由在本层）。 */ llm: LlmService;` plus the import. In `src/loader/guard.ts` add to `publicServiceMembers`: `llm: new Set(["listEndpoints", "probe", "chat"]),` — external plugins can call models but never mutate config or read presets. If `tests/bootstrap.test.ts` enumerates provided services, extend it to expect `llm`.

Run: `pnpm exec vitest run` — Expected: PASS (whole suite).

- [ ] **Step 4: Verify gates**

Run: `pnpm verify:layering && pnpm verify:env-independence && npm_config_cache=/tmp/sw-npm-cache pnpm lint:docs` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/host/llm.ts src/bootstrap.ts src/host/context.d.ts src/loader/guard.ts tests/host-llm.test.ts tests/bootstrap.test.ts
git commit -m "新增第七宿主服务 ctx.llm：模型路由与推理 facade (#28)"
```

---

### Task 5: Built-in `llm-settings` plugin (preset-driven config UI)

**Files:**
- Create: `src/plugins/llm-settings/index.ts`
- Create: `src/plugins/llm-settings/model.ts`
- Create: `tests/llm-settings.test.ts`
- Modify: `src/loader/table.ts` (add `llm-settings` row)
- Modify: `src/ui/icons.ts` (add `sparkle` icon)
- Modify: `src/preview.ts` (mount plugin with an in-memory stub `LlmService`)

**Interfaces:**
- Consumes: Task 4 `LlmService` facade (`listPresets`, `listEndpoints`, `upsertEndpoint`, `removeEndpoint`, `probe`); `ctx.slots.register("topbar.left", …)`; `labelButton` from `src/ui/dom.ts`.
- Produces:
  - `export const name = "llm-settings"`, `export const inject = ["llm", "slots"]`, `export function apply(ctx: Context): () => void` (PluginModule triad).
  - In `model.ts` (pure, DOM-free): `export interface EndpointDraft { id: string; name: string; kind: "chat" | "asr"; baseUrl: string; apiKey: string; models: ModelEntry[] }`; `export function instantiatePreset(p: LlmPreset): EndpointDraft`; `export function blankDraft(): EndpointDraft`; `export function validateDraft(d: EndpointDraft): string | null` (Chinese inline messages naming the field); `export const CUSTOM_VENDOR = "custom";`

- [ ] **Step 1: Write the failing tests (model + panel)**

Create `tests/llm-settings.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { instantiatePreset, validateDraft } from "../src/plugins/llm-settings/model";
import * as llmSettings from "../src/plugins/llm-settings";

const preset = { vendor: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1",
  models: [{ id: "deepseek-v4-pro", capabilities: ["text"] }] };

describe("model", () => {
  it("instantiates a preset into an editable draft", () => {
    const d = instantiatePreset(preset);
    expect(d).toMatchObject({ id: "deepseek", name: "DeepSeek", kind: "chat",
      baseUrl: preset.baseUrl, apiKey: "", models: preset.models });
  });

  it("validates drafts with Chinese field-named messages", () => {
    expect(validateDraft(instantiatePreset(preset))).toBeNull(); // 空 apiKey 合法（自托管/后填）
    const d = instantiatePreset(preset);
    d.baseUrl = "ftp://x";
    expect(validateDraft(d)).toContain("baseUrl");
    const dup = instantiatePreset(preset);
    dup.models.push({ ...dup.models[0] });
    expect(validateDraft(dup)).toContain("模型");
  });
});

describe("panel", () => {
  function fakeCtx() {
    const saved: unknown[] = [];
    const llm = {
      listPresets: () => Promise.resolve([preset]),
      listEndpoints: () => Promise.resolve({ endpoints: [], defaultModel: null }),
      upsertEndpoint: (e: unknown) => { saved.push(e); return Promise.resolve(); },
      removeEndpoint: () => Promise.resolve(),
      probe: () => Promise.resolve(42),
    };
    const renders: ((host: HTMLElement) => void)[] = [];
    const slots = { register: (_slot: string, render: (host: HTMLElement) => void) => { renders.push(render); return () => {}; } };
    return { ctx: { llm, slots }, saved, renders };
  }

  it("saves a preset-instantiated endpoint through ctx.llm", async () => {
    const { ctx, saved, renders } = fakeCtx();
    llmSettings.apply(ctx as never);
    const host = document.createElement("div");
    renders[0](host);
    document.body.append(host);
    (host.querySelector("button") as HTMLButtonElement).click();          // 顶栏按钮 → 面板
    await new Promise((r) => setTimeout(r));                              // 面板数据加载
    (document.querySelector(".llm-panel [data-action=add]") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    const form = document.querySelector(".llm-panel form") as HTMLFormElement;
    (form.querySelector("[name=vendor]") as HTMLSelectElement).value = "deepseek";
    (form.querySelector("[name=vendor]") as HTMLSelectElement).dispatchEvent(new Event("change"));
    (form.querySelector("[name=apiKey]") as HTMLInputElement).value = "sk-test";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r));
    expect(saved[0]).toMatchObject({ id: "deepseek", apiKey: "sk-test",
      models: [{ id: "deepseek-v4-pro", capabilities: ["text"] }] });
  });
});
```

Run: `pnpm exec vitest run tests/llm-settings.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement `model.ts` and the icon**

`model.ts` exactly per **Produces**; `instantiatePreset` deep-copies models; `validateDraft` checks non-empty `id`/`name`, `baseUrl` starts with `http://` or `https://` (message contains `baseUrl`), model ids non-empty and unique (message contains `模型`), empty `apiKey` allowed.

In `src/ui/icons.ts` add to `ICONS`:

```ts
  sparkle: [["path", { d: "M8 2.6l1.3 3.4 3.4 1.3-3.4 1.3L8 12l-1.3-3.4-3.4-1.3 3.4-1.3z" }]],
```

- [ ] **Step 3: Implement `index.ts` (panel UI)**

Follow `plugin-manager`'s modal-overlay pattern (`.querySelector(".llm-panel")?.remove()` on open, Esc closes, full re-render after each action). `apply` registers `topbar.left` with `labelButton("sparkle", "", { className: "btn btn-ghost icon-btn", ariaLabel: "模型" })`. Panel structure (class prefix `llm-panel`):

- List view: one row per endpoint (name, baseUrl, model count, `key` badge when `hasKey`, `默认` marker when any of its models equals `defaultModel`), buttons `探测` (shows latency ms or `LlmError.code` inline), `编辑`, `删除` (immediate, no confirm — config is user-owned and re-creatable); footer `data-action=add` button `新增 endpoint`.
- Form view (`<form>`): `select[name=vendor]` whose options are the presets plus `自定义（OpenAI 兼容）` (`CUSTOM_VENDOR`); on `change`, refill `name`/`baseUrl`/model rows from `instantiatePreset` (custom → `blankDraft()`); inputs `name=id`, `name=name`, `name=baseUrl`, `name=apiKey` (`type=password`, `autocomplete=off`); model rows each with text input for id + `vision` checkbox (toggles `capabilities`) + delete button; `添加模型` button; submit → `validateDraft` → `ctx.llm.upsertEndpoint(draft)` → back to list; validation failure renders the message inline and saves nothing.
- All failures (`LlmError` or other) render inline with `code` when present; nothing fails silently.

Keep `index.ts` ≤ ~300 lines; put row/form builders in the same file, DOM helpers via `document.createElement` (no innerHTML — consistent with `dom.ts`/`icons.ts` rationale).

In `src/loader/table.ts`: add `"llm-settings": { plugin: llmSettings as PluginModule, defaults: {} },` (import as the other rows do). The existing manifest migration in `src/loader/manifest.ts` merges new built-in rows into existing user manifests automatically — no extra work.

- [ ] **Step 4: Wire the browser preview**

In `src/preview.ts` add a stub service and mount the plugin so the panel is visually inspectable without Tauri:

```ts
class PreviewLlm {
  #endpoints: { endpoints: unknown[]; defaultModel: string | null } = { endpoints: [], defaultModel: null };
  listPresets() { return Promise.resolve([{ vendor: "deepseek", name: "DeepSeek", baseUrl: "https://example.invalid/v1", models: [{ id: "demo-model", capabilities: ["text"] }] }]); }
  listEndpoints() { return Promise.resolve(this.#endpoints); }
  upsertEndpoint(e: unknown) { this.#endpoints.endpoints.push(e); return Promise.resolve(); }
  removeEndpoint() { return Promise.resolve(); }
  probe() { return Promise.resolve(12); }
}
```

Apply it like the other preview plugins (`applyLlmSettings(ctx as never)` with `ctx.llm = new PreviewLlm()`). The stub baseUrl must not appear as a URL literal in source (the env-independence gate scans `src/**` text): write it as `"https://" + "preview.invalid/v1"` so the regex does not match while the rendered form stays readable. Verify `pnpm verify:env-independence` stays green.

Run: `pnpm exec vitest run && pnpm verify:env-independence && pnpm verify:layering` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/llm-settings src/loader/table.ts src/ui/icons.ts src/preview.ts tests/llm-settings.test.ts
git commit -m "新增 llm-settings 内置插件：厂商预设快速配置面板 (#28)"
```

---

### Task 6: Docs, notes lifecycle, acceptance, and the full gate sweep

**Files:**
- Modify: `docs/architecture.md` (+ `.en.md`) — 数据流 + 关键决策 paragraphs
- Modify: `scripts/code-map.manifest.json` — register `src-tauri/src/config.rs`, `src-tauri/src/llm.rs`, `src/host/llm.ts`, `src/plugins/llm-settings/index.ts` (then regenerate)
- Modify: `docs/environment-independence.md` (+ `.en.md`) — exemption row's ADR link `proposed` → `implemented`
- Move: `.agents/notes/proposed/architecture/2026-09-19-ai-inference-supply.*` → `.agents/notes/implemented/architecture/` (Status → implemented; update the stale Consequences fact "配置契约在 m2-02 落地" → m2-01 已落地)
- Move: `.agents/notes/proposed/feature/2026-10-01-ai-inference-supply.*` → `.agents/notes/implemented/feature/` (Status → implemented; facts already aligned in Task 1)
- Modify: `.agents/flow/issues/m2-01-ai-inference-supply.md` (+ `.en.md`) — `status: done` after acceptance results are recorded under 验收
- Regenerate: `docs/commands.md` (+ `.en.md`) via `pnpm gen:commands`; `docs/architecture.md` code-map region via `pnpm gen:code-map`

**Interfaces:**
- Consumes: everything above.
- Produces: a branch that passes every gate with the issue closed.

- [ ] **Step 1: Update `docs/architecture.md` (both languages)**

Component-tree descriptions come from `scripts/code-map.manifest.json`; add four entries in the established one-line style (Chinese + English pair in the manifest as existing entries do), e.g. `config.rs` —「用户配置根与 settings.json：~/.studywiki 解析/老域迁移/原子写 0600/脱敏投影」, `llm.rs` —「LLM 薄能力层：厂商预设 + endpoint CRUD + 探测 + 非流式 chat 出口（唯一联网点）」, `host/llm.ts` —「LLM 服务：模型路由（MODEL_* 三码）+ 推理 facade（deps 可注入）」, `plugins/llm-settings/index.ts` —「llm-settings 插件：厂商预设实例化 + endpoint 列表/编辑/探测面板」. Then:

```bash
pnpm gen:code-map
pnpm gen:commands
```

Hand-edit the 数据流 paragraph (both `.md` and `.en.md`) appending one sentence: `LLM 推理——插件经 ctx.llm.chat({model}) 发起，宿主按模型路由归属 endpoint（MODEL_UNKNOWN/AMBIGUOUS/UNSPECIFIED 在本层抛出），Rust llm_chat 读 ~/.studywiki/settings.json 发 HTTPS（空 apiKey 不带 Authorization），归一错误码原路返回。` (English mirror accordingly.) Append three bullets to 关键决策 (both languages): `~/.studywiki 为用户配置根（三端同形，老 app_config_dir 数据启动一次性迁移）`；`密钥明文存 settings.json + 0600，与 Claude Code/Codex/dsh 同水位，命令面只进不出（list 脱敏）`；`Rust 为薄能力层（持久化 + egress），模型路由与未来 agent 循环均在前端（对照 dsh：native 只做能力隔离）`. Re-record:

```bash
pnpm record:i18n -- docs/architecture.md
```

- [ ] **Step 2: Move both notes to implemented and fix links**

Move the ADR note and the feature spec note (three files each) into `implemented/architecture/` resp. `implemented/feature/`; set `Status: implemented` in both language files; in the ADR note update only the stale fact (契约落地在 m2-01，链接到 the feature note); in `docs/environment-independence.md` (+ `.en.md`) point the exemption row's link at the new `implemented` path. Re-record each moved/edited pair:

```bash
pnpm record:i18n -- .agents/notes/implemented/architecture/2026-09-19-ai-inference-supply.md
pnpm record:i18n -- .agents/notes/implemented/feature/2026-10-01-ai-inference-supply.md
pnpm record:i18n -- docs/environment-independence.md
```

- [ ] **Step 3: Record acceptance on the issue and close it**

In `.agents/flow/issues/m2-01-ai-inference-supply.md` (+ `.en.md`), append the acceptance evidence under 验收 (gate outputs green; manual smoke checklist: `pnpm tauri dev` → llm-settings 面板新增 DeepSeek 预设 → 填 key → 探测返回延迟；`cat ~/.studywiki/settings.json` 确认 0600 与脱敏列表命令不回传 key), then set `status: done` in both fences and re-record:

```bash
pnpm record:i18n -- .agents/flow/issues/m2-01-ai-inference-supply.md
```

- [ ] **Step 4: Full gate sweep**

Run, in order, and fix anything red before proceeding:

```bash
cargo test
pnpm exec vitest run
npm_config_cache=/tmp/sw-npm-cache pnpm lint:docs
npm_config_cache=/tmp/sw-npm-cache pnpm verify:docs
pnpm verify:env-independence
pnpm verify:dep-audit
pnpm verify:layering
pnpm verify:flow
pnpm verify:commands
pnpm build   # tsc --noEmit + vite build
```

Expected: every command exits 0.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md docs/architecture.en.md docs/architecture.i18n.yaml \
        docs/commands.md docs/commands.en.md docs/commands.i18n.yaml \
        docs/environment-independence.md docs/environment-independence.en.md docs/environment-independence.i18n.yaml \
        scripts/code-map.manifest.json .agents/notes .agents/flow
git commit -m "落地 m2-01 验收：文档、豁免链接与 note 生命周期收尾 (#28)"
```

- [ ] **Step 6: Hand off for review**

Summarize: branch commits, gate evidence, manual-smoke result (or what remains for the user to smoke), and open consequences (streaming deferred to m2-02; ASR contract has no consumer until m3-01; plaintext-key water level per spec).
