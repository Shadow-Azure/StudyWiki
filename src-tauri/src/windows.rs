use std::collections::HashMap;
use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// 窗口注册表：label → 工作区根。全局状态的唯一权威（刷新/重载可重查）。
#[derive(Default)]
pub struct WindowRegistry {
    next: u32,
    roots: HashMap<String, Option<String>>,
}

impl WindowRegistry {
    pub fn register(&mut self, root: Option<String>) -> String {
        self.next += 1;
        let label = format!("win-{}", self.next);
        self.roots.insert(label.clone(), root);
        label
    }
    pub fn get(&self, label: &str) -> Option<Option<String>> {
        self.roots.get(label).cloned()
    }
    pub fn remove(&mut self, label: &str) {
        self.roots.remove(label);
    }
}

/// 新建窗口：登记注册表后创建加载同一 bundle 的 WebviewWindow。
#[tauri::command]
pub fn create_window(
    app: AppHandle,
    state: tauri::State<'_, Mutex<WindowRegistry>>,
    root: Option<String>,
) -> Result<String, String> {
    let label = state.lock().unwrap().register(root.clone());
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::default())
        .title("StudyWiki")
        .inner_size(1180.0, 760.0)
        .build()
        .map_err(|e| format!("create window {label}: {e}"))?;
    Ok(label)
}

/// 查询某窗口的工作区根（main 窗口启动时为 None）。
#[tauri::command]
pub fn get_window_state(
    state: tauri::State<'_, Mutex<WindowRegistry>>,
    label: String,
) -> Option<Option<String>> {
    state.lock().unwrap().get(&label)
}

/// 读插件清单（app 配置目录 plugins.json）；不存在返回 None，由前端生成默认。
#[tauri::command]
pub fn read_manifest(app: AppHandle) -> Result<Option<String>, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("plugins.json");
    fs::read_to_string(&path).map(Some).or_else(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            Ok(None)
        } else {
            Err(format!("read {}: {e}", path.display()))
        }
    })
}

/// 原子写插件清单（tmp + rename，避免半截 JSON）。
#[tauri::command]
pub fn write_manifest(app: AppHandle, json: String) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let path = dir.join("plugins.json");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_generates_labels_and_tracks_roots() {
        let mut reg = WindowRegistry::default();
        let a = reg.register(None);
        let b = reg.register(Some("/tmp/x".into()));
        assert_eq!(a, "win-1");
        assert_eq!(b, "win-2");
        assert_eq!(reg.get("win-2"), Some(Some("/tmp/x".into())));
        reg.remove("win-2");
        assert_eq!(reg.get("win-2"), None);
    }
}
