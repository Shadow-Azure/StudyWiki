//! 用户配置根（~/.studywiki）解析与老 app_config_dir 一次性迁移。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/// 老配置域里需要搬家的条目（插件清单 + 外置插件目录）。
const LEGACY_ENTRIES: [&str; 2] = ["plugins.json", "plugins"];

/// 用户配置根：<home>/.studywiki（三端同形，纯函数便于测试）。
pub fn studywiki_dir(home: &Path) -> PathBuf {
    home.join(".studywiki")
}

/// App 态配置根：home 解析失败即 fail-loud（泛 Runtime 供 MockRuntime 测试复用）。
pub fn app_studywiki_dir<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
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
pub fn migrate_legacy<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let legacy = app.path().app_config_dir().map_err(|e| e.to_string())?;
    migrate_legacy_dirs(&legacy, &app_studywiki_dir(app)?)
}

/// 单个模型的声明（能力：text / vision）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct ModelEntry {
    pub id: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

/// 一条 endpoint 配置（chat = LLM/VLM 共用；asr = 转写，本期仅契约与探测）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct Endpoint {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "apiKey", default)]
    pub api_key: String,
    #[serde(default)]
    pub models: Vec<ModelEntry>,
}

/// settings.json 根结构（版本不兼容 fail-loud，绝不静默覆盖用户文件）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct Settings {
    pub version: u32,
    #[serde(default)]
    pub endpoints: Vec<Endpoint>,
    #[serde(rename = "defaultModel", default)]
    pub default_model: Option<String>,
}

/// 本客户端支持的 settings 版本；高于此值拒绝加载。
pub const SUPPORTED_SETTINGS_VERSION: u32 = 1;

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: SUPPORTED_SETTINGS_VERSION,
            endpoints: Vec::new(),
            default_model: None,
        }
    }
}

/// 前端可见的脱敏投影：只回 hasKey + 掩码预览，完整 key 永不出 Rust。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactedEndpoint {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub base_url: String,
    pub has_key: bool,
    pub key_preview: String,
    pub models: Vec<ModelEntry>,
}

/// 读 settings.json：缺席 → 默认 v1 空配置；损坏/版本过高 → Err（文件保持原样）。
pub fn load_settings(dir: &Path) -> Result<Settings, String> {
    let path = dir.join("settings.json");
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Settings::default()),
        Err(e) => return Err(format!("读 {}: {e}", path.display())),
    };
    let s: Settings = serde_json::from_str(&raw)
        .map_err(|e| format!("settings.json 解析失败：{e}（保持原文件不动）"))?;
    if s.version > SUPPORTED_SETTINGS_VERSION {
        return Err(format!(
            "settings.json 版本 {} 高于本客户端支持的 {}，请升级客户端",
            s.version, SUPPORTED_SETTINGS_VERSION
        ));
    }
    Ok(s)
}

/// 原子写 settings.json：唯一 tmp 名（pid+纳秒）+ 创建即 0600（OpenOptions，
/// 不存在"先 0644 后 chmod"的窗口）+ rename，杜绝半截文件、权限窗口与并发覆盖 tmp。
pub fn save_settings(dir: &Path, s: &Settings) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    let path = dir.join("settings.json");
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!(
        "settings.json.{}.{}.tmp",
        std::process::id(),
        nanos
    ));
    let json = serde_json::to_string_pretty(s).map_err(|e| format!("序列化失败：{e}"))?;
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|e| format!("写 {}: {e}", tmp.display()))?;
        f.write_all(json.as_bytes())
            .map_err(|e| format!("写 {}: {e}", tmp.display()))?;
    }
    #[cfg(not(unix))]
    fs::write(&tmp, json).map_err(|e| format!("写 {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename → {}: {e}", path.display()))
}

/// 配置域判定：路径位于用户配置根内（含 plugins/、settings.json）即 true。
/// 文件树/读写命令据此拒绝——用户配置域不是工作区数据，外置插件不可经 files 服务触达。
/// `root` 由调用方传入（App 态为 app_studywiki_dir），纯函数便于测试。
pub fn is_config_domain_in(p: &Path, root: &Path) -> bool {
    // 双轨比较：canonical（解析符号链接）与词法各比一次，任一命中即域内。
    // macOS /var→/private 等符号链接会让单轨比较漏判；安全侧取"宁可过度拒绝"。
    let root_canon = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let cand_canon = p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    cand_canon.starts_with(&root_canon)
        || cand_canon.starts_with(root)
        || p.starts_with(&root_canon)
        || p.starts_with(root)
}

/// 脱敏投影：掩码规则 = 前 4 + … + 后 2；短 key 统一 ****；空 key 无预览。
pub fn redact(e: &Endpoint) -> RedactedEndpoint {
    let chars: Vec<char> = e.api_key.chars().collect();
    let preview = if chars.is_empty() {
        String::new()
    } else if chars.len() > 7 {
        format!(
            "{}…{}",
            chars[..4].iter().collect::<String>(),
            chars[chars.len() - 2..].iter().collect::<String>()
        )
    } else {
        "****".into()
    };
    RedactedEndpoint {
        id: e.id.clone(),
        name: e.name.clone(),
        kind: e.kind.clone(),
        base_url: e.base_url.clone(),
        has_key: !e.api_key.is_empty(),
        key_preview: preview,
        models: e.models.clone(),
    }
}

/// endpoint 校验：写盘前最后一道闸；错误信息点名违规字段。
pub fn validate_endpoint(e: &Endpoint) -> Result<(), String> {
    if e.id.trim().is_empty() {
        return Err("endpoint id 不能为空".into());
    }
    if e.name.trim().is_empty() {
        return Err("endpoint name 不能为空".into());
    }
    if !(e.base_url.starts_with("http://") || e.base_url.starts_with("https://")) {
        return Err("baseUrl 必须以 http:// 或 https:// 开头".into());
    }
    if e.kind != "chat" && e.kind != "asr" {
        return Err("kind 只允许 chat 或 asr".into());
    }
    if e.models.is_empty() {
        return Err("至少要有一个模型".into());
    }
    let mut seen = std::collections::HashSet::new();
    for m in &e.models {
        if m.id.trim().is_empty() {
            return Err("模型 id 不能为空".into());
        }
        if !seen.insert(&m.id) {
            return Err(format!("模型 id 重复：{}", m.id));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn studywiki_dir_joins_dot_dir() {
        assert_eq!(
            studywiki_dir(Path::new("/home/u")),
            PathBuf::from("/home/u/.studywiki")
        );
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
        assert_eq!(
            std::fs::read_to_string(new.join("plugins.json")).unwrap(),
            "new"
        );
        assert!(legacy.join("plugins.json").exists()); // 老条目保留不删
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    fn sample_endpoint() -> Endpoint {
        Endpoint {
            id: "deepseek".into(),
            name: "DeepSeek".into(),
            kind: "chat".into(),
            base_url: "https://api.deepseek.com/v1".into(),
            api_key: "sk-1234567890abcdef".into(),
            models: vec![ModelEntry {
                id: "deepseek-v4-flash".into(),
                capabilities: vec!["text".into()],
            }],
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
        std::fs::write(
            dir.join("settings.json"),
            r#"{"version":99,"endpoints":[]}"#,
        )
        .unwrap();
        assert!(load_settings(&dir).is_err());
        assert_eq!(
            std::fs::read_to_string(dir.join("settings.json")).unwrap(),
            r#"{"version":99,"endpoints":[]}"#
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn atomic_write_roundtrip_with_0600_and_no_tmp_residue() {
        let dir = std::env::temp_dir().join(format!("sw-set3-{}", std::process::id()));
        let mut s = Settings {
            version: 1,
            endpoints: vec![sample_endpoint()],
            default_model: Some("deepseek-v4-flash".into()),
        };
        save_settings(&dir, &s).unwrap();
        s.endpoints.push(sample_endpoint());
        save_settings(&dir, &s).unwrap(); // 交错二次写，结果必须仍是完整 JSON
        let back = load_settings(&dir).unwrap();
        assert_eq!(back.endpoints.len(), 2);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join("settings.json"))
                .unwrap()
                .permissions()
                .mode();
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
    fn is_config_domain_flags_studywiki_paths() {
        let tmp = std::env::temp_dir().join(format!("sw-domain-{}", std::process::id()));
        let root = studywiki_dir(&tmp);
        std::fs::create_dir_all(root.join("plugins")).unwrap();
        assert!(is_config_domain_in(&root.join("settings.json"), &root));
        assert!(is_config_domain_in(
            &root.join("plugins/a/package.json"),
            &root
        ));
        assert!(!is_config_domain_in(&tmp.join("elsewhere/note.md"), &root));
        std::fs::remove_dir_all(&tmp).unwrap();
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
}
