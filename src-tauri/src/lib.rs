use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::Emitter;

/// 递归树节点：`kind` 由扩展名分派（单一决策点），目录递归展开。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub children: Option<Vec<FileNode>>,
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

fn kind_of(path: &Path) -> String {
    if path.is_dir() {
        return "dir".into();
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match ext.as_deref().and_then(kind_for_ext) {
        Some(kind) => kind.into(),
        None => "other".into(),
    }
}

/// 纯遍历（可测）：目录在前、同级大小写不敏感排序；读取失败原样上抛。
fn walk_dir(root: &Path) -> Result<Vec<FileNode>, String> {
    let mut out = Vec::new();
    for item in fs::read_dir(root).map_err(|e| format!("open {}: {e}", root.display()))? {
        let item = item.map_err(|e| format!("read entry: {e}"))?;
        let path = item.path();
        let mut node = FileNode {
            name: item.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            kind: kind_of(&path),
            children: None,
        };
        if path.is_dir() {
            node.children = Some(walk_dir(&path)?);
        }
        out.push(node);
    }
    out.sort_by(|a, b| {
        (a.kind != "dir", a.name.to_lowercase()).cmp(&(b.kind != "dir", b.name.to_lowercase()))
    });
    Ok(out)
}

fn std_write(path: &Path, contents: &str) -> Result<(), String> {
    fs::write(path, contents).map_err(|e| format!("write {}: {e}", path.display()))
}

/// 递归扫描打开的库根，返回整棵文件树。错误携带 OS 失败原文。
#[tauri::command]
fn read_tree(root: String) -> Result<Vec<FileNode>, String> {
    walk_dir(Path::new(&root))
}

/// 整文件写入（markdown 编辑器的保存通道）。落盘成功后广播 `fs://changed`
/// （payload 为路径），各窗口据此重读受影响目录。
#[tauri::command]
fn write_text_file(app: tauri::AppHandle, path: String, contents: String) -> Result<(), String> {
    std_write(Path::new(&path), &contents)?;
    app.emit("fs://changed", &path)
        .map_err(|e| format!("emit: {e}"))
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
        .invoke_handler(tauri::generate_handler![
            read_tree,
            read_text_file,
            write_text_file
        ])
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

    fn fixture_tree() -> std::path::PathBuf {
        // 两个测试并行跑：目录名带上线程 id，避免互删对方的 fixture。
        let dir = std::env::temp_dir().join(format!(
            "sw-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("Sub")).unwrap();
        std::fs::write(dir.join("Readme.md"), "# hi").unwrap();
        std::fs::write(dir.join("Sub/b.MP4"), b"x").unwrap();
        std::fs::write(dir.join("Sub/a.md"), b"x").unwrap();
        std::fs::write(dir.join("Sub/notes.txt"), b"x").unwrap();
        dir
    }

    #[test]
    fn read_tree_walks_and_sorts_dirs_first() {
        let dir = fixture_tree();
        let tree = walk_dir(&dir).unwrap();
        assert_eq!(tree[0].kind, "dir"); // 目录排前
        assert_eq!(tree[0].name, "Sub");
        let children = tree[0].children.as_ref().unwrap();
        assert_eq!(children[0].name, "a.md"); // 目录内大小写不敏感排序
        assert_eq!(children[1].name, "b.MP4");
        assert_eq!(children[1].kind, "video");
        assert_eq!(children.len(), 3); // notes.txt 非可打开类型仍列出，kind=other
        assert_eq!(children[2].name, "notes.txt");
        assert_eq!(children[2].kind, "other");
        assert_eq!(tree[1].name, "Readme.md");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn write_text_file_roundtrip() {
        let dir = fixture_tree();
        let p = dir.join("Sub/a.md");
        std_write(&p, "new body").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "new body");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
