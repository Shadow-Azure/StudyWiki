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
    /// 更新（或 upsert，主窗口首开文件夹场景）某窗口的工作区根。
    pub fn set_root(&mut self, label: &str, root: Option<String>) {
        self.roots.insert(label.to_string(), root);
    }
}

/// 新建窗口：登记注册表后创建加载同一 bundle 的 WebviewWindow；创建失败回滚登记项。
#[tauri::command]
pub fn create_window(
    app: AppHandle,
    state: tauri::State<'_, Mutex<WindowRegistry>>,
    root: Option<String>,
) -> Result<String, String> {
    let label = state.lock().unwrap().register(root.clone());
    if let Some(root) = &root {
        if let Err(e) = app.asset_protocol_scope().allow_directory(root, true) {
            state.lock().unwrap().remove(&label);
            return Err(format!("授权 asset 访问 {root} 失败：{e}"));
        }
    }
    if let Err(e) = WebviewWindowBuilder::new(&app, &label, WebviewUrl::default())
        .title("StudyWiki")
        .inner_size(1180.0, 760.0)
        .build()
    {
        // build 失败的窗口不会触发 Destroyed 事件，登记项必须手动回滚。
        state.lock().unwrap().remove(&label);
        return Err(format!("create window {label}: {e}"));
    }
    Ok(label)
}

/// 查询某窗口的工作区根；未登记或未设 root 均返回 None（前端归一为欢迎态）。
#[tauri::command]
pub fn get_window_state(
    state: tauri::State<'_, Mutex<WindowRegistry>>,
    label: String,
) -> Option<String> {
    state.lock().unwrap().get(&label).flatten()
}

/// 更新窗口工作区根并把该目录加入 asset protocol 运行期白名单（recursive）。
/// 配置 scope 已收空，这是唯一授权点；启动时重设同值即重新授权（幂等）。
#[tauri::command]
pub fn set_window_root(
    app: AppHandle,
    state: tauri::State<'_, Mutex<WindowRegistry>>,
    label: String,
    root: Option<String>,
) -> Result<(), String> {
    if let Some(root) = &root {
        app.asset_protocol_scope()
            .allow_directory(root, true)
            .map_err(|e| format!("授权 asset 访问 {root} 失败：{e}"))?;
    }
    state.lock().unwrap().set_root(&label, root);
    Ok(())
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
        // 注册表层保留两层语义：未设 root = Some(None)，未知窗口 = None。
        assert_eq!(reg.get("win-1"), Some(None));
        reg.remove("win-2");
        assert_eq!(reg.get("win-2"), None);
    }

    #[test]
    fn command_view_flattens_rootless_and_unknown_to_none() {
        // get_window_state 对 wire 的契约：两层压平后未设 root 与未登记同形。
        let mut reg = WindowRegistry::default();
        let rootless = reg.register(None);
        assert_eq!(reg.get(&rootless).flatten(), None);
        assert_eq!(reg.get("ghost").flatten(), None);
        let rooted = reg.register(Some("/tmp/y".into()));
        assert_eq!(reg.get(&rooted).flatten(), Some("/tmp/y".into()));
    }

    #[test]
    fn registry_set_root_upserts_known_and_unknown_labels() {
        let mut reg = WindowRegistry::default();
        let a = reg.register(None);
        reg.set_root(&a, Some("/new".into()));
        assert_eq!(reg.get(&a), Some(Some("/new".into())));
        // 主窗口（windows[] 配置窗）从未登记过：upsert 让"打开文件夹"也持久化
        reg.set_root("main", Some("/first".into()));
        assert_eq!(reg.get("main"), Some(Some("/first".into())));
    }
}
