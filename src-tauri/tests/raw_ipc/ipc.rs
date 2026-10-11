//! Raw binary IPC in-process integration tests: requests traverse Tauri's real
//! command resolver (`Request` body/headers), not just helper functions.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use study_wiki_lib::{raw_binary_builder, windows::WindowRegistry};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{
    get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY,
};
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};

fn fixture() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "sw-raw-ipc-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("book.xlsx"), b"xlsx-bytes").unwrap();
    dir
}

fn app_with_root(root: &Path) -> (tauri::App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let app = raw_binary_builder(mock_builder())
        .build(mock_context(noop_assets()))
        .expect("build mock app");
    app.state::<Mutex<WindowRegistry>>()
        .lock()
        .unwrap()
        .set_root("main", Some(root.to_string_lossy().into_owned()));
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build mock webview");
    (app, webview)
}

fn request(cmd: &str, body: InvokeBody, path: Option<&str>) -> tauri::webview::InvokeRequest {
    let mut headers = tauri::http::HeaderMap::new();
    if let Some(path) = path {
        headers.insert(
            "x-studywiki-path",
            tauri::http::HeaderValue::from_str(path).expect("ASCII path header"),
        );
    }
    tauri::webview::InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }
        .parse()
        .expect("valid origin"),
        body,
        headers,
        invoke_key: INVOKE_KEY.to_string(),
    }
}

pub fn raw_ipc_read_and_write_round_trip() {
    let dir = fixture();
    let (_app, webview) = app_with_root(&dir);
    let path = dir.join("book.xlsx").to_string_lossy().into_owned();

    let read = get_ipc_response(
        &webview,
        request("read_binary_file", InvokeBody::Raw(Vec::new()), Some(&path)),
    )
    .expect("read command succeeds");
    match read {
        InvokeResponseBody::Raw(bytes) => assert_eq!(bytes, b"xlsx-bytes"),
        InvokeResponseBody::Json(value) => panic!("read returned JSON: {value}"),
    }

    let write = get_ipc_response(
        &webview,
        request(
            "write_binary_file",
            InvokeBody::Raw(b"edited-bytes".to_vec()),
            Some(&path),
        ),
    )
    .expect("write command succeeds");
    assert!(matches!(write, InvokeResponseBody::Json(_)));
    assert_eq!(fs::read(&path).unwrap(), b"edited-bytes");
    let leftovers = fs::read_dir(&dir)
        .unwrap()
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".book.xlsx")
        })
        .count();
    assert_eq!(leftovers, 0, "atomic write left a temp file");

    fs::remove_dir_all(&dir).unwrap();
}

pub fn raw_ipc_write_rejects_json_body_and_unauthorized_paths() {
    let dir = fixture();
    let (_app, webview) = app_with_root(&dir);
    let json = serde_json::json!([1, 2, 3]);

    let json_error = get_ipc_response(
        &webview,
        request(
            "write_binary_file",
            InvokeBody::Json(json),
            Some(&dir.join("book.xlsx").to_string_lossy()),
        ),
    )
    .expect_err("JSON body must be rejected");
    assert!(
        json_error
            .to_string()
            .contains("write_binary_file 需要 Tauri raw IPC bytes"),
        "unexpected error: {json_error}"
    );

    let unauthorized = get_ipc_response(
        &webview,
        request(
            "read_binary_file",
            InvokeBody::Raw(Vec::new()),
            Some("/outside/book.xlsx"),
        ),
    )
    .expect_err("outside root must be rejected");
    assert!(
        unauthorized.to_string().contains("UNAUTHORIZED_PATH|"),
        "unexpected error: {unauthorized}"
    );

    fs::remove_dir_all(&dir).unwrap();
}

fn json_response(response: InvokeResponseBody) -> serde_json::Value {
    match response {
        InvokeResponseBody::Json(raw) => {
            serde_json::from_str(&raw).unwrap_or(serde_json::Value::String(raw))
        }
        other => panic!("expected JSON response: {other:?}"),
    }
}

pub fn raw_ipc_window_state_authorizes_text_reads() {
    let dir = fixture();
    fs::write(dir.join("note.md"), "hello").unwrap();
    let root = dir.to_string_lossy().into_owned();
    let note = dir.join("note.md").to_string_lossy().into_owned();

    let app = raw_binary_builder(mock_builder())
        .build(mock_context(noop_assets()))
        .expect("build mock app");
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build mock webview");

    let initial = get_ipc_response(
        &webview,
        request(
            "get_window_state",
            InvokeBody::Json(serde_json::json!({ "label": "main" })),
            None,
        ),
    )
    .expect("initial state command succeeds");
    assert_eq!(json_response(initial), serde_json::json!(null));

    let granted = get_ipc_response(
        &webview,
        request(
            "set_window_root",
            InvokeBody::Json(serde_json::json!({ "label": "main", "root": root.clone() })),
            None,
        ),
    )
    .expect("set root command succeeds");
    assert!(matches!(granted, InvokeResponseBody::Json(_)));

    let state = get_ipc_response(
        &webview,
        request(
            "get_window_state",
            InvokeBody::Json(serde_json::json!({ "label": "main" })),
            None,
        ),
    )
    .expect("state command succeeds");
    assert_eq!(json_response(state), serde_json::json!(root));

    let read = get_ipc_response(
        &webview,
        request(
            "read_text_file",
            InvokeBody::Json(serde_json::json!({ "path": note.clone() })),
            None,
        ),
    )
    .expect("authorized text read succeeds");
    assert_eq!(json_response(read), serde_json::json!("hello"));

    let unauthorized = get_ipc_response(
        &webview,
        request(
            "read_text_file",
            InvokeBody::Json(serde_json::json!({ "path": "/outside/note.md" })),
            None,
        ),
    )
    .expect_err("outside root must be rejected");
    assert!(
        unauthorized.to_string().contains("UNAUTHORIZED_PATH|"),
        "unexpected error: {unauthorized}"
    );

    let cleared = get_ipc_response(
        &webview,
        request(
            "set_window_root",
            InvokeBody::Json(serde_json::json!({ "label": "main", "root": null })),
            None,
        ),
    )
    .expect("clear root command succeeds");
    assert!(matches!(cleared, InvokeResponseBody::Json(_)));

    let after_clear = get_ipc_response(
        &webview,
        request(
            "get_window_state",
            InvokeBody::Json(serde_json::json!({ "label": "main" })),
            None,
        ),
    )
    .expect("state after clear succeeds");
    assert_eq!(json_response(after_clear), serde_json::json!(null));

    let revoked = get_ipc_response(
        &webview,
        request(
            "read_text_file",
            InvokeBody::Json(serde_json::json!({ "path": note })),
            None,
        ),
    )
    .expect_err("cleared root must revoke text reads");
    assert!(
        revoked.to_string().contains("UNAUTHORIZED_PATH|"),
        "unexpected error: {revoked}"
    );

    fs::remove_dir_all(&dir).unwrap();
}
