use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// 目录扫描出的插件条目：健康行带元数据，坏行带点名问题（面板据此标"待清理"）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    pub name: String,
    pub version: Option<String>,
    pub api_version: Option<i64>,
    pub entry: Option<String>,
    pub problem: Option<String>,
}

/// read_plugin_module 的返回：入口 ESM 源码 + apiVersion（前端做支持集判定）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginModuleSource {
    pub code: String,
    pub api_version: i64,
}

/// 外置插件 package.json 的 studywiki 块（封闭契约的字面映射）。
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyWikiBlock {
    pub api_version: i64,
    pub entry: String,
}

/// package.json 骨架（只取封闭契约关心的字段，其余忽略）。
#[derive(Deserialize)]
struct PackageJson {
    name: String,
    version: Option<String>,
    #[serde(default)]
    keywords: Vec<String>,
    #[serde(default)]
    dependencies: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(default)]
    studywiki: Option<StudyWikiBlock>,
}

/// 插件目录名安全检查：拒绝空、路径分隔符与任何 `..` 片段（防目录逃逸）。
pub fn safe_plugin_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name == "."
        || name.contains("..")
        || name.contains('/')
        || name.contains('\\')
    {
        Err(format!("非法插件名：{name:?}"))
    } else {
        Ok(())
    }
}

/// 严格解析 package.json（封闭契约）：name 非空、keywords 含 "studywiki-plugin"、
/// dependencies 显式空对象、studywiki 块含正整数 apiVersion 与非空 entry。
/// 任何一条不符即 Err 并点名缺什么——不从坏包里猜。
pub fn parse_package_json(raw: &str) -> Result<(String, Option<String>, StudyWikiBlock), String> {
    let pkg: PackageJson =
        serde_json::from_str(raw).map_err(|e| format!("package.json 解析失败：{e}"))?;
    if pkg.name.trim().is_empty() {
        return Err("package.json 缺少非空 name".into());
    }
    if !pkg.keywords.iter().any(|k| k == "studywiki-plugin") {
        return Err(format!(
            "package.json keywords 缺 \"studywiki-plugin\"（{}）",
            pkg.name
        ));
    }
    match &pkg.dependencies {
        None => {
            return Err(format!(
                "package.json 缺 dependencies（必须显式空对象，{}）",
                pkg.name
            ))
        }
        Some(deps) if !deps.is_empty() => {
            return Err(format!(
                "package.json dependencies 非空（{}，外置插件必须零依赖）",
                pkg.name
            ))
        }
        _ => {}
    }
    let block = pkg
        .studywiki
        .ok_or_else(|| format!("package.json 缺 studywiki 块（{}）", pkg.name))?;
    if block.api_version < 1 {
        return Err(format!("studywiki.apiVersion 非正整数（{}）", pkg.name));
    }
    if block.entry.trim().is_empty() {
        return Err(format!("studywiki.entry 为空（{}）", pkg.name));
    }
    if block.entry.contains('/') || block.entry.contains('\\') || block.entry.contains("..") {
        return Err(format!(
            "studywiki.entry 必须是顶层单文件，收到 {}（{}）",
            block.entry, pkg.name
        ));
    }
    Ok((pkg.name, pkg.version, block))
}

/// 插件根目录（app 配置目录下 plugins/）。
pub fn plugin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("plugins"))
}

/// 目录扫描（可测）：子目录逐个读 package.json；坏目录降级为 problem 行，
/// 不让单个坏插件炸掉整个列表（面板点名待清理）；staging 残留与非目录不入列。
pub fn scan_plugins(dir: &Path) -> Vec<PluginEntry> {
    let mut out = Vec::new();
    let Ok(items) = fs::read_dir(dir) else {
        return out; // 目录不存在 = 没装任何外置插件
    };
    for item in items.flatten() {
        let path = item.path();
        if !path.is_dir() {
            continue;
        }
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let entry = match fs::read_to_string(path.join("package.json")) {
            Err(e) => PluginEntry {
                name,
                version: None,
                api_version: None,
                entry: None,
                problem: Some(format!("读 package.json 失败：{e}")),
            },
            Ok(raw) => match parse_package_json(&raw) {
                Ok((_, version, block)) => PluginEntry {
                    name,
                    version,
                    api_version: Some(block.api_version),
                    entry: Some(block.entry),
                    problem: None,
                },
                Err(e) => PluginEntry {
                    name,
                    version: None,
                    api_version: None,
                    entry: None,
                    problem: Some(e),
                },
            },
        };
        out.push(entry);
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// 纯读入口（可测）：安全名检查 → package.json 严格解析 → 读入口源码。
pub fn read_entry_source(dir: &Path, name: &str) -> Result<PluginModuleSource, String> {
    safe_plugin_name(name)?;
    let plugin = dir.join(name);
    let raw = fs::read_to_string(plugin.join("package.json"))
        .map_err(|e| format!("读 {name}/package.json 失败：{e}"))?;
    let (_, _, block) = parse_package_json(&raw)?;
    let code = fs::read_to_string(plugin.join(&block.entry))
        .map_err(|e| format!("读 {name}/{} 失败：{e}", block.entry))?;
    Ok(PluginModuleSource {
        code,
        api_version: block.api_version,
    })
}

/// 纯删目录（可测）：幂等，目录已不在视为成功。
pub fn remove_plugin_dir(dir: &Path, name: &str) -> Result<(), String> {
    safe_plugin_name(name)?;
    let target = dir.join(name);
    match fs::remove_dir_all(&target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除 {} 失败：{e}", target.display())),
    }
}

/// 扫描插件目录：健康行带元数据，坏行带 problem（面板标待清理）。
#[tauri::command]
pub fn list_plugins(app: AppHandle) -> Vec<PluginEntry> {
    match plugin_dir(&app) {
        Ok(dir) => scan_plugins(&dir),
        Err(e) => vec![PluginEntry {
            name: String::new(),
            version: None,
            api_version: None,
            entry: None,
            problem: Some(e),
        }],
    }
}

/// 读外置插件入口 ESM 源码 + 其 apiVersion（前端 blob 装载与支持集判定的原料）。
#[tauri::command]
pub fn read_plugin_module(app: AppHandle, name: String) -> Result<PluginModuleSource, String> {
    read_entry_source(&plugin_dir(&app)?, &name)
}

/// 删除外置插件目录（面板"移除"）；目录已不在视为幂等成功。
#[tauri::command]
pub fn remove_plugin(app: AppHandle, name: String) -> Result<(), String> {
    remove_plugin_dir(&plugin_dir(&app)?, &name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_plugins_dir(tag: &str) -> std::path::PathBuf {
        // 与 lib.rs fixture 同款：线程 id 隔离，防并行测试互删。
        let dir = std::env::temp_dir().join(format!(
            "sw-plugin-test-{}-{:?}-{tag}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn package_json(name: &str, api: i64, entry: &str) -> String {
        format!(
            r#"{{"name":"{name}","version":"1.0.0","keywords":["studywiki-plugin"],"dependencies":{{}},"studywiki":{{"apiVersion":{api},"entry":"{entry}"}}}}"#
        )
    }

    fn write_plugin(dir: &std::path::Path, name: &str) {
        let p = dir.join(name);
        std::fs::create_dir_all(&p).unwrap();
        std::fs::write(p.join("package.json"), package_json(name, 1, "index.js")).unwrap();
        std::fs::write(p.join("index.js"), b"export const name = 'x';").unwrap();
    }

    #[test]
    fn parse_accepts_contract_and_rejects_each_missing_piece() {
        let (name, version, block) =
            parse_package_json(&package_json("demo", 1, "index.js")).unwrap();
        assert_eq!(name, "demo");
        assert_eq!(version.as_deref(), Some("1.0.0"));
        assert_eq!(block.entry, "index.js");
        // 每缺一条点名一条（fail-loud，不从坏包里猜）
        assert!(parse_package_json(
            &package_json("demo", 1, "index.js").replace("\"studywiki-plugin\"", "\"other\"")
        )
        .unwrap_err()
        .contains("studywiki-plugin"));
        assert!(parse_package_json(&r#"{"name":"demo","keywords":["studywiki-plugin"],"studywiki":{"apiVersion":1,"entry":"i.js"}}"#.to_string()).unwrap_err().contains("dependencies"));
        assert!(parse_package_json(
            &package_json("demo", 1, "i.js")
                .replace("\"dependencies\":{}", "\"dependencies\":{\"x\":\"1\"}")
        )
        .unwrap_err()
        .contains("零依赖"));
        assert!(parse_package_json(
            &package_json("demo", 1, "i.js")
                .replace(",\"studywiki\":{\"apiVersion\":1,\"entry\":\"i.js\"}", "")
        )
        .unwrap_err()
        .contains("studywiki"));
        assert!(parse_package_json(&package_json("", 1, "i.js")).is_err());
        assert!(parse_package_json(&package_json("demo", 0, "i.js"))
            .unwrap_err()
            .contains("apiVersion"));
        assert!(parse_package_json(&package_json("demo", 1, "  "))
            .unwrap_err()
            .contains("entry"));
        assert!(parse_package_json(&package_json("demo", 1, "sub/index.js"))
            .unwrap_err()
            .contains("顶层"));
        assert!(parse_package_json(&package_json("demo", 1, "../evil.js"))
            .unwrap_err()
            .contains("顶层"));
    }

    #[test]
    fn scan_reports_broken_rows_and_skips_staging() {
        let dir = tmp_plugins_dir("scan");
        write_plugin(&dir, "zeta");
        let broken = dir.join("broken");
        std::fs::create_dir_all(&broken).unwrap();
        std::fs::write(broken.join("package.json"), "{oops").unwrap();
        std::fs::create_dir_all(dir.join(".staging-x")).unwrap(); // staging 残留不入列
        std::fs::write(dir.join("loose.tgz"), b"x"); // 非目录不入列
        let entries = scan_plugins(&dir);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "broken"); // 排序：broken < zeta
        assert!(entries[0]
            .problem
            .as_deref()
            .unwrap()
            .contains("package.json"));
        assert_eq!(entries[1].name, "zeta");
        assert_eq!(entries[1].api_version, Some(1));
        assert!(entries[1].problem.is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn safe_name_rejects_traversal() {
        assert!(safe_plugin_name("../evil").is_err());
        assert!(safe_plugin_name("a/b").is_err());
        assert!(safe_plugin_name("a\\b").is_err());
        assert!(safe_plugin_name("").is_err());
        assert!(safe_plugin_name("..").is_err());
        assert!(safe_plugin_name("a..b").is_err()); // 保守：任何 .. 片段都拒
        assert!(safe_plugin_name("demo-hello").is_ok());
    }

    #[test]
    fn read_entry_source_validates_and_reads() {
        let dir = tmp_plugins_dir("read");
        write_plugin(&dir, "demo");
        let src = read_entry_source(&dir, "demo").unwrap();
        assert_eq!(src.code, "export const name = 'x';");
        assert_eq!(src.api_version, 1);
        assert!(read_entry_source(&dir, "../evil").is_err()); // 路径逃逸拒
        assert!(read_entry_source(&dir, "ghost")
            .unwrap_err()
            .contains("ghost/package.json")); // 目录缺失点名
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn remove_plugin_dir_is_idempotent() {
        let dir = tmp_plugins_dir("rm");
        write_plugin(&dir, "demo");
        remove_plugin_dir(&dir, "demo").unwrap();
        remove_plugin_dir(&dir, "demo").unwrap(); // 再删（目录已不在）也成功
        assert!(read_entry_source(&dir, "demo").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
