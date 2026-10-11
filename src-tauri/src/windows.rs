use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// 窗口注册表：label → 工作区根与会话级 grants。全局状态的唯一权威（刷新/重载可重查）。
#[derive(Default)]
pub struct WindowRegistry {
    next: u32,
    roots: HashMap<String, Option<String>>,
    grants: HashMap<String, Vec<PathBuf>>,
}

/// 原生关窗守卫就绪表：只有前端聚合守卫完成装载的窗口才由主进程同步取消原生关闭。
#[derive(Default)]
pub struct CloseGuardRegistry {
    ready: HashSet<String>,
}

impl CloseGuardRegistry {
    pub fn set_ready(&mut self, label: &str, ready: bool) {
        if ready {
            self.ready.insert(label.to_string());
        } else {
            self.ready.remove(label);
        }
    }

    pub fn is_ready(&self, label: &str) -> bool {
        self.ready.contains(label)
    }

    pub fn remove(&mut self, label: &str) {
        self.ready.remove(label);
    }
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
        self.grants.remove(label);
    }
    /// 更新（或 upsert，主窗口首开文件夹场景）某窗口的工作区根。
    pub fn set_root(&mut self, label: &str, root: Option<String>) {
        self.roots.insert(label.to_string(), root);
    }
    /// 已设 root 的窗口根集合：文件命令根域校验的准源（None 不算授权）。
    pub fn roots(&self) -> Vec<std::path::PathBuf> {
        self.roots
            .values()
            .filter_map(|r| r.clone())
            .map(std::path::PathBuf::from)
            .collect()
    }

    /// 登记某窗口经用户审批获得的动态只读授权；按窗口归属，窗口关闭即清除。
    pub fn add_grant(&mut self, label: &str, path: String) {
        self.grants
            .entry(label.to_string())
            .or_default()
            .push(PathBuf::from(path));
    }

    /// 单窗口读命令授权集合：该窗口 root（若有）+ 该窗口 grants。
    /// grants 与 root 都是窗口 scope，跨窗口互不可见。
    pub fn authorized_for(&self, label: &str) -> Vec<PathBuf> {
        let mut authorized = Vec::new();
        if let Some(Some(root)) = self.roots.get(label) {
            authorized.push(PathBuf::from(root));
        }
        if let Some(grants) = self.grants.get(label) {
            authorized.extend(grants.iter().cloned());
        }
        authorized
    }
}

/// 路径是否落在任一已注册窗口 root 之下（附件 path 来源的越权防线；无 root 全拒）。
/// 两侧 canonicalize 后做前缀判断；路径或 root 不存在即拒。注册表读取在命令面做。
pub fn path_under_roots(roots: &[String], path: &str) -> bool {
    let p = match std::fs::canonicalize(path) {
        Ok(p) => p,
        Err(_) => return false,
    };
    roots.iter().any(|root| match std::fs::canonicalize(root) {
        Ok(r) => p.starts_with(r),
        Err(_) => false,
    })
}

/// 新建窗口：登记注册表后创建加载同一 bundle 的 WebviewWindow；创建失败回滚登记项。
#[tauri::command]
pub fn create_window<R: tauri::Runtime>(
    app: AppHandle<R>,
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
pub fn set_window_root<R: tauri::Runtime>(
    app: AppHandle<R>,
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

/// 标记窗口聚合关窗守卫是否就绪；就绪后原生关闭由主进程同步取消。
#[tauri::command]
pub fn set_close_guard_ready<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, Mutex<CloseGuardRegistry>>,
    label: String,
    ready: bool,
) -> Result<(), String> {
    crate::native_close::set_ready(&app, &label, ready)?;
    state.lock().unwrap().set_ready(&label, ready);
    Ok(())
}

/// 读插件清单（app 配置目录 plugins.json）；不存在返回 None，由前端生成默认。
#[tauri::command]
pub fn read_manifest(app: AppHandle) -> Result<Option<String>, String> {
    let path = crate::config::app_studywiki_dir(&app)?.join("plugins.json");
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
    let dir = crate::config::app_studywiki_dir(&app)?;
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
    fn registry_roots_collects_set_roots_only() {
        let mut reg = WindowRegistry::default();
        reg.set_root("main", Some("/a".into()));
        reg.set_root("win-1", None);
        reg.set_root("win-2", Some("/b".into()));
        let mut roots = reg.roots();
        roots.sort();
        assert_eq!(
            roots,
            vec![
                std::path::PathBuf::from("/a"),
                std::path::PathBuf::from("/b")
            ]
        );
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

    #[test]
    fn grants_scoped_to_window_and_dropped_on_remove() {
        let mut reg = WindowRegistry::default();
        reg.set_root("w1", Some("/lib".into()));
        reg.add_grant("w1", "/outside/file.md".into());
        reg.add_grant("w2", "/elsewhere".into());
        let auth = reg.authorized_for("w1");
        assert!(auth.iter().any(|p| p.ends_with("file.md")));
        assert!(!auth.iter().any(|p| p.ends_with("elsewhere")));
        reg.add_grant("w1", "/tmp/x".into());
        reg.remove("w1");
        let auth = reg.authorized_for("w1");
        assert!(!auth.iter().any(|p| p.ends_with("file.md")));
        assert!(reg
            .authorized_for("w2")
            .iter()
            .any(|p| p.ends_with("elsewhere")));
    }

    #[test]
    fn path_under_roots_canonicalizes_and_rejects_unrooted_paths() {
        let base = std::env::temp_dir().join(format!("sw-roots-{}", std::process::id()));
        let root = base.join("workspace");
        std::fs::create_dir_all(root.join("docs")).unwrap();
        let inside = root.join("docs/file.txt");
        std::fs::write(&inside, b"ok").unwrap();
        let outside_dir = base.join("outside");
        std::fs::create_dir_all(&outside_dir).unwrap();
        let outside = outside_dir.join("file.txt");
        std::fs::write(&outside, b"no").unwrap();

        let roots = vec![root.to_string_lossy().to_string()];
        assert!(path_under_roots(&roots, &inside.to_string_lossy()));
        assert!(path_under_roots(&roots, &root.to_string_lossy()));
        assert!(!path_under_roots(&roots, &outside.to_string_lossy()));
        assert!(!path_under_roots(
            &roots,
            &(base.join("missing")).to_string_lossy()
        ));
        assert!(!path_under_roots(&[], &inside.to_string_lossy()));
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn close_guard_registry_tracks_ready_windows() {
        let mut registry = CloseGuardRegistry::default();
        assert!(!registry.is_ready("main"));
        registry.set_ready("main", true);
        assert!(registry.is_ready("main"));
        registry.set_ready("main", false);
        assert!(!registry.is_ready("main"));
        registry.set_ready("main", true);
        registry.remove("main");
        assert!(!registry.is_ready("main"));
    }
}
