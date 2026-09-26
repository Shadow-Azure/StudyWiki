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

fn raw_ipc_read_and_write_round_trip() {
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

fn raw_ipc_write_rejects_json_body_and_unauthorized_paths() {
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
        unauthorized.to_string().contains("先打开文件夹"),
        "unexpected error: {unauthorized}"
    );

    fs::remove_dir_all(&dir).unwrap();
}

fn main() {
    raw_ipc_read_and_write_round_trip();
    raw_ipc_write_rejects_json_body_and_unauthorized_paths();
}
