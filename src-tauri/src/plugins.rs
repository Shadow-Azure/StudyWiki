use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;
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
    if block.entry == "package.json" {
        return Err(format!(
            "studywiki.entry 不得是 package.json（{}）",
            pkg.name
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

/// npm registry 固定公网 npmjs（不内置镜像；用户侧差异交给系统级代理）。
const REGISTRY: &str = "https://registry.npmjs.org";

/// tarball 大小上限（下载与本地导入共用）：封闭契约下单文件插件远低于此；
/// 超限 fail-loud（DoS 加固面，非安全边界）。
const MAX_TARBALL_BYTES: u64 = 20 * 1024 * 1024;

/// 联网共用 Agent：整体超时，registry/网络挂起时安装命令不再无限等待。
fn http_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(30))
        .build()
}

/// 读入至多 `cap` 字节；超出即 Err（点名上限）。
fn read_capped<R: std::io::Read>(mut r: R, cap: u64) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    r.take(cap + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("读 tarball 失败：{e}"))?;
    if buf.len() as u64 > cap {
        return Err(format!("插件包超过 {cap} 字节上限"));
    }
    Ok(buf)
}

/// 解包校验后的成品：package.json 原文 + 入口字节（落盘时原样写回，不重建）。
#[derive(Debug)]
pub struct ExtractedPlugin {
    pub name: String,
    pub version: Option<String>,
    pub block: StudyWikiBlock,
    pub code: Vec<u8>,
    pub raw_package_json: String,
}

/// dist.integrity 校验（`sha512-<base64>`）；其他算法直接拒（npm 目前只发 sha512）。
pub fn verify_integrity(integrity: &str, bytes: &[u8]) -> Result<(), String> {
    use base64::Engine as _;
    use sha2::{Digest, Sha512};
    let (algo, b64) = integrity
        .split_once('-')
        .ok_or("dist.integrity 缺少 algo-base64 结构")?;
    if algo != "sha512" {
        return Err(format!("不支持的完整性算法 {algo}（仅 sha512）"));
    }
    let expect = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("integrity base64 解码失败：{e}"))?;
    let actual = Sha512::digest(bytes);
    if actual.as_slice() == expect.as_slice() {
        Ok(())
    } else {
        Err("tarball sha512 校验失败（下载损坏或被篡改）".into())
    }
}

/// 安装名拆分：`name` / `name@version`；scoped 包（`@scope/name`）的首个 @ 不算分隔。
pub fn split_spec(spec: &str) -> (String, Option<String>) {
    let at = if spec.starts_with('@') {
        spec[1..].find('@').map(|i| i + 1)
    } else {
        spec.find('@')
    };
    match at {
        Some(i) => (spec[..i].to_string(), Some(spec[i + 1..].to_string())),
        None => (spec.to_string(), None),
    }
}

/// tgz 解包 + 封闭契约校验（纯函数，零网络可测）：条目必须是 `package/` 前缀下
/// 的普通文件（符号链接等非文件条目忽略——我们不落盘 tar 原条目而是重写新文件，
/// 无穿越面），恰好 `package.json` + 声明的入口两个文件；package.json 过严格解析
/// （顶层单文件规则也由它单一决策，本函数不重复判）。
pub fn extract_and_validate(tgz: &[u8]) -> Result<ExtractedPlugin, String> {
    let gz = flate2::read::GzDecoder::new(tgz);
    let mut archive = tar::Archive::new(gz);
    let mut package_json: Option<Vec<u8>> = None;
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for entry in archive
        .entries()
        .map_err(|e| format!("读 tar 条目失败：{e}"))?
    {
        let mut entry = entry.map_err(|e| format!("tar 条目错误：{e}"))?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let path = entry
            .path()
            .map_err(|e| format!("tar 路径错误：{e}"))?
            .to_string_lossy()
            .into_owned();
        if path.contains("..") || path.starts_with('/') {
            return Err(format!("tar 条目路径可疑：{path}"));
        }
        let rel = path
            .strip_prefix("package/")
            .ok_or_else(|| format!("tar 条目不在 package/ 前缀下：{path}"))?
            .to_string();
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| format!("读 {rel} 失败：{e}"))?;
        if rel == "package.json" {
            package_json = Some(bytes.clone());
        }
        files.push((rel, bytes));
    }
    let raw = package_json.ok_or("tgz 缺 package.json")?;
    let raw_package_json =
        String::from_utf8(raw).map_err(|e| format!("package.json 非 UTF-8：{e}"))?;
    let (name, version, block) = parse_package_json(&raw_package_json)?;
    let entry_name = block.entry.clone();
    if !files.iter().any(|(n, _)| n == &entry_name) {
        return Err(format!("tgz 缺入口文件 {entry_name}（{name}）"));
    }
    if files.len() != 2
        || files
            .iter()
            .any(|(n, _)| n != "package.json" && n != &entry_name)
    {
        let names: Vec<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
        return Err(format!(
            "tgz 必须恰好含 package.json 与入口 {entry_name}（{name}），实际：{names:?}"
        ));
    }
    let code = files
        .into_iter()
        .find(|(n, _)| n == &entry_name)
        .map(|(_, b)| b)
        .unwrap();
    Ok(ExtractedPlugin {
        name,
        version,
        block,
        code,
        raw_package_json,
    })
}

/// 落盘（可测）：staging 先写全量再 rename，插件目录永远是完整形态；
/// 旧目录与同名 staging 残留先清（重装路径）。
pub fn place_plugin(dir: &Path, extracted: &ExtractedPlugin) -> Result<(), String> {
    safe_plugin_name(&extracted.name)?;
    let target = dir.join(&extracted.name);
    let staging = dir.join(format!(".staging-{}", extracted.name));
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_dir_all(&target);
    fs::create_dir_all(&staging).map_err(|e| format!("mkdir {}: {e}", staging.display()))?;
    fs::write(staging.join("package.json"), &extracted.raw_package_json)
        .map_err(|e| format!("write package.json: {e}"))?;
    fs::write(staging.join(&extracted.block.entry), &extracted.code)
        .map_err(|e| format!("write {}: {e}", extracted.block.entry))?;
    fs::rename(&staging, &target).map_err(|e| format!("rename: {e}"))
}

/// registry 元数据解析结果。
struct Resolved {
    name: String,
    version: String,
    tarball: String,
    integrity: String,
}

/// 查 registry 元数据并按 spec 解析 tarball URL 与 integrity（联网薄层，不进单测；
/// 裸名取 dist-tags.latest）。scoped 包名 URL 转义 `/` 为 `%2F`。
fn resolve_registry(spec: &str) -> Result<Resolved, String> {
    let (name, want) = split_spec(spec);
    if name.is_empty() || (name.starts_with('@') && name.matches('@').count() > 1) {
        return Err(format!("非法安装名：{spec}"));
    }
    let url = format!("{REGISTRY}/{}", name.replace('/', "%2F"));
    let body: String = http_agent()
        .get(&url)
        .call()
        .map_err(|e| format!("查 registry {name} 失败：{e}"))?
        .into_string()
        .map_err(|e| format!("读 registry 响应失败：{e}"))?;
    let doc: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("registry 元数据解析失败：{e}"))?;
    let version = match &want {
        Some(v) => v.clone(),
        None => doc["dist-tags"]["latest"]
            .as_str()
            .ok_or("registry 元数据缺 dist-tags.latest")?
            .to_string(),
    };
    let dist = &doc["versions"][&version]["dist"];
    let tarball = dist["tarball"]
        .as_str()
        .ok_or(format!("registry 元数据缺 {version} 的 dist.tarball"))?
        .to_string();
    let integrity = dist["integrity"]
        .as_str()
        .ok_or(format!("registry 元数据缺 {version} 的 dist.integrity"))?
        .to_string();
    Ok(Resolved {
        name,
        version,
        tarball,
        integrity,
    })
}

/// 下载后公共管线：校验（本地导入无 integrity 则跳）→ 解包校验 → 落盘 → 返回插件名。
fn install_bytes(app: &AppHandle, bytes: &[u8], integrity: Option<&str>) -> Result<String, String> {
    if let Some(sig) = integrity {
        verify_integrity(sig, bytes)?;
    }
    let extracted = extract_and_validate(bytes)?;
    let dir = plugin_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    place_plugin(&dir, &extracted)?;
    Ok(extracted.name)
}

/// 联网安装外置插件（产品唯一用户可见联网动作，豁免登记见
/// docs/environment-independence.md）：查元数据 → 拉 tarball → sha512 校验 →
/// 解包校验封闭契约 → 入插件目录。成功返回插件名。
#[tauri::command]
pub fn install_plugin(app: AppHandle, spec: String) -> Result<String, String> {
    let resolved = resolve_registry(&spec)?;
    let bytes = http_agent()
        .get(&resolved.tarball)
        .call()
        .map_err(|e| format!("下载 tarball 失败：{e}"))?
        .into_reader();
    let bytes = read_capped(bytes, MAX_TARBALL_BYTES)?;
    install_bytes(&app, &bytes, Some(&resolved.integrity))
}

/// 本地导入 tgz（同校验管线，免联网）；成功返回插件名。
#[tauri::command]
pub fn import_plugin(app: AppHandle, path: String) -> Result<String, String> {
    let file = fs::File::open(&path).map_err(|e| format!("读 {path} 失败：{e}"))?;
    let bytes = read_capped(file, MAX_TARBALL_BYTES)?;
    install_bytes(&app, &bytes, None)
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

    #[test]
    fn parse_rejects_entry_equal_package_json() {
        let raw = package_json("demo", 1, "package.json");
        let err = parse_package_json(&raw).unwrap_err();
        assert!(err.contains("不得是 package.json"), "{err}");
    }

    #[test]
    fn read_capped_rejects_over_cap() {
        use std::io::Cursor;
        let big = vec![0u8; 101];
        assert!(read_capped(Cursor::new(big), 100).is_err());
        let ok = vec![0u8; 100];
        assert_eq!(read_capped(Cursor::new(ok), 100).unwrap().len(), 100);
    }

    mod install {
        use super::*;

        /// 在测试内构造 npm 形态 tgz（package/ 前缀），零网络。
        fn build_tgz(files: &[(&str, &[u8])]) -> Vec<u8> {
            let mut builder = tar::Builder::new(Vec::new());
            for (path, bytes) in files {
                let mut header = tar::Header::new_gnu();
                header.set_size(bytes.len() as u64);
                header.set_mode(0o644);
                header.set_cksum();
                builder.append_data(&mut header, path, *bytes).unwrap();
            }
            let tar_bytes = builder.into_inner().unwrap();
            let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            std::io::Write::write_all(&mut gz, &tar_bytes).unwrap();
            gz.finish().unwrap()
        }

        #[test]
        fn extract_validates_closed_contract() {
            let pkg = package_json("demo", 1, "index.js");
            let files: Vec<(&str, &[u8])> = vec![
                ("package/package.json", pkg.as_bytes()),
                ("package/index.js", b"export const name = 'demo';"),
            ];
            let tgz = build_tgz(&files);
            let got = extract_and_validate(&tgz).unwrap();
            assert_eq!(got.name, "demo");
            assert_eq!(got.block.api_version, 1);
            assert_eq!(got.code, b"export const name = 'demo';");

            // 缺入口点名
            let no_entry = build_tgz(&[(
                "package/package.json",
                package_json("demo", 1, "index.js").as_bytes(),
            )]);
            assert!(extract_and_validate(&no_entry)
                .unwrap_err()
                .contains("index.js"));
            // 多余文件点名
            let extra = build_tgz(&[
                (
                    "package/package.json",
                    package_json("demo", 1, "index.js").as_bytes(),
                ),
                ("package/index.js", b"x"),
                ("package/extra.js", b"y"),
            ]);
            assert!(extract_and_validate(&extra).unwrap_err().contains("实际"));
            // 目录穿越拒（tar::Builder 拒绝写含 `..` 的路径，恶意样本直接改写条目头 name 字段构造）
            let mut evil_header = tar::Header::new_gnu();
            evil_header.set_size(1);
            evil_header.set_mode(0o644);
            let mut evil_name = [0u8; 100];
            evil_name[..18].copy_from_slice(b"package/../evil.js");
            evil_header.as_old_mut().name = evil_name;
            evil_header.set_cksum();
            let mut evil_builder = tar::Builder::new(Vec::new());
            let pkg_evil = package_json("demo", 1, "../evil.js");
            let mut pj_header = tar::Header::new_gnu();
            pj_header.set_size(pkg_evil.len() as u64);
            pj_header.set_mode(0o644);
            pj_header.set_cksum();
            evil_builder
                .append_data(&mut pj_header, "package/package.json", pkg_evil.as_bytes())
                .unwrap();
            evil_builder
                .append(&mut evil_header, "x".as_bytes())
                .unwrap();
            let evil_tar = evil_builder.into_inner().unwrap();
            let mut gz_evil =
                flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            std::io::Write::write_all(&mut gz_evil, &evil_tar).unwrap();
            let evil = gz_evil.finish().unwrap();
            assert!(extract_and_validate(&evil).unwrap_err().contains("可疑"));
            // 无 package/ 前缀拒
            let bare = build_tgz(&[("package.json", package_json("demo", 1, "i.js").as_bytes())]);
            assert!(extract_and_validate(&bare)
                .unwrap_err()
                .contains("package/"));
            // 入口不允许子目录（封闭契约：顶层单文件）
            let nested = build_tgz(&[
                (
                    "package/package.json",
                    package_json("demo", 1, "sub/index.js").as_bytes(),
                ),
                ("package/sub/index.js", b"x"),
            ]);
            assert!(extract_and_validate(&nested).unwrap_err().contains("顶层"));
            // 坏 package.json 的解析错误原样透传（点名）
            let broken_raw: Vec<u8> = br#"{"name":"demo"}"#.to_vec();
            let badpj = build_tgz(&[
                ("package/package.json", &broken_raw),
                ("package/i.js", b"x"),
            ]);
            assert!(extract_and_validate(&badpj)
                .unwrap_err()
                .contains("studywiki-plugin"));
        }

        #[test]
        fn integrity_sha512_only() {
            use base64::Engine as _;
            use sha2::{Digest, Sha512};
            let bytes = b"tarball-bytes";
            let good = format!(
                "sha512-{}",
                base64::engine::general_purpose::STANDARD.encode(Sha512::digest(bytes))
            );
            verify_integrity(&good, bytes).unwrap();
            assert!(verify_integrity(
                &format!(
                    "sha512-{}",
                    base64::engine::general_purpose::STANDARD.encode([0u8; 64])
                ),
                bytes
            )
            .is_err());
            assert!(verify_integrity("sha1-AAAA", bytes)
                .unwrap_err()
                .contains("sha1"));
        }

        #[test]
        fn place_writes_raw_package_json_and_entry_atomically() {
            let dir = tmp_plugins_dir("place");
            let pkg = package_json("demo", 1, "index.js");
            let files: Vec<(&str, &[u8])> = vec![
                ("package/package.json", pkg.as_bytes()),
                ("package/index.js", b"export const name = 'demo';"),
            ];
            let extracted = extract_and_validate(&build_tgz(&files)).unwrap();
            place_plugin(&dir, &extracted).unwrap();
            // package.json 原样落盘（不重建，保留作者字段）
            assert_eq!(
                std::fs::read_to_string(dir.join("demo/package.json")).unwrap(),
                package_json("demo", 1, "index.js")
            );
            // 重复安装（旧目录已存在）直接替换，且无 staging 残留
            place_plugin(&dir, &extracted).unwrap();
            assert!(dir.join(".staging-demo").exists() == false);
            let entries = scan_plugins(&dir);
            assert_eq!(entries.len(), 1);
            assert!(entries[0].problem.is_none());
            std::fs::remove_dir_all(&dir).unwrap();
        }

        #[test]
        fn split_spec_handles_scoped_names() {
            assert_eq!(split_spec("demo"), ("demo".into(), None));
            assert_eq!(
                split_spec("demo@1.2.3"),
                ("demo".into(), Some("1.2.3".into()))
            );
            assert_eq!(split_spec("@scope/demo"), ("@scope/demo".into(), None));
            assert_eq!(
                split_spec("@scope/demo@1.2.3"),
                ("@scope/demo".into(), Some("1.2.3".into()))
            );
        }
    }
}
