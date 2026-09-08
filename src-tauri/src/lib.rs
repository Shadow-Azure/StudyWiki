use serde::Serialize;
use std::fs;
use std::path::Path;

/// One item the frontend can open. `kind` dispatches the viewer; keeping it
/// server-side means the extension lists below are the single decision point.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
}

const MARKDOWN_EXTS: &[&str] = &["md", "markdown"];
const VIDEO_EXTS: &[&str] = &["mp4", "webm", "mov", "m4v", "mkv"];

fn kind_for_ext(ext: &str) -> Option<&'static str> {
    let ext = ext.to_ascii_lowercase();
    if MARKDOWN_EXTS.contains(&ext.as_str()) {
        Some("markdown")
    } else if VIDEO_EXTS.contains(&ext.as_str()) {
        Some("video")
    } else {
        None
    }
}

/// Lists every openable entry (markdown note or playable video) directly
/// inside the opened library root, sorted case-insensitively by file name.
/// Files whose extension is neither are skipped silently. Errors carry the
/// OS failure verbatim (root unopenable, directory entry unreadable).
#[tauri::command]
fn list_library(root: String) -> Result<Vec<LibraryEntry>, String> {
    let root_path = Path::new(&root);
    let mut entries = Vec::new();
    let dir = fs::read_dir(root_path).map_err(|e| format!("open {root}: {e}"))?;
    for item in dir {
        let item = item.map_err(|e| format!("read entry: {e}"))?;
        let path = item.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase());
        let Some(ext) = ext else { continue };
        let Some(kind) = kind_for_ext(&ext) else {
            continue;
        };
        entries.push(LibraryEntry {
            name: item.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            kind: kind.to_string(),
        });
    }
    entries.sort_by_key(|a| a.name.to_lowercase());
    Ok(entries)
}

/// Reads a whole file as a UTF-8 string — the markdown viewer's data source.
/// Errors carry the OS failure verbatim.
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![list_library, read_text_file])
        .run(tauri::generate_context!())
        .expect("error while running StudyWiki");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_known_extensions() {
        assert_eq!(kind_for_ext("md"), Some("markdown"));
        assert_eq!(kind_for_ext("MP4"), Some("video"));
        assert_eq!(kind_for_ext("txt"), None);
    }
}
