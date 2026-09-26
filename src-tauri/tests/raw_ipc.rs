//! Raw IPC integration driver. Tauri's MockRuntime Webview integration
//! executable currently fails to load on Windows CI with STATUS_ENTRYPOINT_NOT_FOUND;
//! macOS/Linux run the real-resolver tests while Windows keeps the library test suite.

#[cfg(not(windows))]
#[path = "raw_ipc/ipc.rs"]
mod ipc;

#[cfg(not(windows))]
fn main() {
    ipc::raw_ipc_read_and_write_round_trip();
    ipc::raw_ipc_write_rejects_json_body_and_unauthorized_paths();
}

#[cfg(windows)]
fn main() {
    println!("raw_ipc: skipped on Windows (Tauri MockRuntime test executable loader limitation)");
}
