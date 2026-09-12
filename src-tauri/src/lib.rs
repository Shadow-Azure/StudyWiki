use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::{Emitter, Manager};

mod plugins;
mod windows;

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

fn kind_of(path: &Path, file_type: std::fs::FileType) -> String {
    if file_type.is_dir() {
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
/// 目录性取自 `read_dir` 条目的 `file_type()`（不解析符号链接）：
/// 指向目录的符号链接按普通条目列出（走扩展名分派）且不递归，杜绝循环。
fn walk_dir(root: &Path) -> Result<Vec<FileNode>, String> {
    let mut out = Vec::new();
    for item in fs::read_dir(root).map_err(|e| format!("open {}: {e}", root.display()))? {
        let item = item.map_err(|e| format!("read entry: {e}"))?;
        let path = item.path();
        let file_type = item
            .file_type()
            .map_err(|e| format!("file_type {}: {e}", path.display()))?;
        let mut node = FileNode {
            name: item.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            kind: kind_of(&path, file_type),
            children: None,
        };
        if file_type.is_dir() {
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

/// 命令面根域校验（单一决策点）：路径须落在某个已授权 root 之内。
/// 词法 starts_with（路径组件级），与 assetProtocol 的 allow_directory 授权
/// 同源；symlink 跟随不在本层防线（停机坪）。
fn path_authorized(reg: &windows::WindowRegistry, path: &str) -> Result<(), String> {
    let p = Path::new(path);
    for root in reg.roots() {
        if p.starts_with(&root) {
            return Ok(());
        }
    }
    Err(format!(
        "路径不在任何已授权文件夹内：{path}（先打开文件夹）"
    ))
}

fn ensure_authorized(
    state: &tauri::State<'_, std::sync::Mutex<windows::WindowRegistry>>,
    path: &str,
) -> Result<(), String> {
    path_authorized(&state.lock().unwrap(), path)
}

/// 递归扫描打开的库根，返回整棵文件树。错误携带 OS 失败原文。
/// 路径必须落在窗口注册表已授权 root 之内（欢迎态无授权即拒——
/// 命令面与 assetProtocol 运行期授权同源收口）。
#[tauri::command]
fn read_tree(
    state: tauri::State<'_, std::sync::Mutex<windows::WindowRegistry>>,
    root: String,
) -> Result<Vec<FileNode>, String> {
    ensure_authorized(&state, &root)?;
    walk_dir(Path::new(&root))
}

/// 整文件写入（markdown 编辑器的保存通道）。落盘成功后广播 `fs://changed`
/// （payload 为路径），各窗口据此重读受影响目录。
/// 路径须在已授权文件夹内（欢迎态无授权即拒）。
#[tauri::command]
fn write_text_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Mutex<windows::WindowRegistry>>,
    path: String,
    contents: String,
) -> Result<(), String> {
    ensure_authorized(&state, &path)?;
    std_write(Path::new(&path), &contents)?;
    app.emit("fs://changed", &path)
        .map_err(|e| format!("emit: {e}"))
}

/// Reads a whole file as a UTF-8 string — the markdown viewer's data source.
/// Errors carry the OS failure verbatim.
/// 路径须在已授权文件夹内（欢迎态无授权即拒）。
#[tauri::command]
fn read_text_file(
    state: tauri::State<'_, std::sync::Mutex<windows::WindowRegistry>>,
    path: String,
) -> Result<String, String> {
    ensure_authorized(&state, &path)?;
    fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(std::sync::Mutex::new(windows::WindowRegistry::default()))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let label = window.label().to_string();
                let app = window.app_handle().clone();
                if let Some(state) = app.try_state::<std::sync::Mutex<windows::WindowRegistry>>() {
                    state.lock().unwrap().remove(&label);
                }
                let _ = app.emit("win://closed", &label);
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_tree,
            read_text_file,
            write_text_file,
            windows::create_window,
            windows::get_window_state,
            windows::set_window_root,
            windows::read_manifest,
            windows::write_manifest,
            plugins::list_plugins,
            plugins::read_plugin_module,
            plugins::remove_plugin,
            plugins::install_plugin,
            plugins::import_plugin
        ])
        .run(tauri::generate_context!())
        .expect("error while running StudyWiki");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::windows::WindowRegistry;

    #[test]
    fn path_authorized_accepts_root_and_nested() {
        let mut reg = WindowRegistry::default();
        reg.set_root("main", Some("/lib/root".into()));
        assert!(path_authorized(&reg, "/lib/root").is_ok());
        assert!(path_authorized(&reg, "/lib/root/sub/a.md").is_ok());
        // 词法按路径组件比对：前缀字符串相同但组件不同不算在内。
        assert!(path_authorized(&reg, "/lib/rootx/a.md").is_err());
    }

    #[test]
    fn path_authorized_rejects_outside_and_empty_registry() {
        let mut reg = WindowRegistry::default();
        reg.set_root("main", Some("/lib/root".into()));
        let err = path_authorized(&reg, "/etc/passwd").unwrap_err();
        assert!(err.contains("先打开文件夹"), "{err}");
        reg.set_root("main", None);
        assert!(path_authorized(&reg, "/lib/root/a.md").is_err());
    }

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
        // 指向 fixture 根自身的目录符号链接：验证遍历不跟随、不递归（防循环）。
        #[cfg(unix)]
        std::os::unix::fs::symlink(&dir, dir.join("self-loop")).unwrap();
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
        // 符号链接列作普通条目：kind=other、无 children、树有限（能返回即未递归成环）。
        #[cfg(unix)]
        {
            assert_eq!(tree[2].name, "self-loop");
            assert_eq!(tree[2].kind, "other");
            assert!(tree[2].children.is_none());
        }
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
