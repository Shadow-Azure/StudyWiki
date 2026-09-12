# Phase 2 外置插件实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付外置插件全链路：npm registry 直拉安装 + 本地 tgz 导入（Rust 侧纯 Rust 栈、sha512 校验、封闭格式契约）、blob URL 装载通道（唯一装载缝）、boot 第二来源与分治、plugin-manager 管理面板、启动错误面板，并收口三笔前置欠账（assetProtocol 收紧、装载通道定案、存量清单迁移）与三项顺路欠账（扫描器盲区、白屏、唯一 home 门禁条目）。

**Architecture:** 宿主把 npm 当仓库用、不当运行时用——安装是 Rust 侧一次性联网动作（ureq+rustls 纯 Rust 栈，禁 OpenSSL dylib），运行期全程离线。装载通道经计划作者裁定取 **blob URL**（两个候选均被 Note 预许；单文件零依赖契约使 blob 弱点归零，且通道可在 vitest 下注入假 import 全链路测试；自定义协议 ESM 只能真实 webview 验证，留作备选），`src/loader/external.ts` 因此成为 Phase 1 以来 `src/` 的第一条、也是唯一一条动态 import 缝。外置清单行命名空间 `ext:<name>`，与内置静态表合并进同一装载流程；资源缺失/形状错误分治：外置坏行跳过装载、面板点名待清理，不阻断启动。管理改动一律写清单后提示重启生效（无热装载）。assetProtocol 配置 scope 收空，选中/建窗携带 root 时由 Rust `allow_directory` 运行期动态授权。

**Tech Stack:** 既有栈不变（Tauri 2 + TS + Vite + 原生 DOM + vendored cordis，npm 依赖零新增）；Rust 侧新增 `ureq`（rustls 系，纯 Rust）、`flate2`（rust_backend）、`tar`、`sha2`、`base64`；测试 vitest + cargo test。

**Spec:** `.agents/notes/proposed/architecture/2026-09-11-phase2-external-plugins.md`（proposed Note，含英文侧三件套；本计划的一切"为什么"以它为准，执行者两份都读）。

## Global Constraints

- 装载缝唯一：`src/loader/external.ts` 是 `src/` 唯一动态 import 点，`scripts/layering-allowlist.json` 的 `files` 恰好这一条；扩缝必须回 Note 修订。
- npm 依赖零新增：本阶段全部新增依赖在 Rust 侧；Rust 栈禁系统 OpenSSL dylib（`verify:native-links` 是看门人，`cargo tree` 里不得出现 openssl）。联网仅 `install_plugin` 一处，registry 固定 `https://registry.npmjs.org`，不内置镜像。
- CSP 只给 `script-src` 增 `blob:`，不开任何 connect-src；`assetProtocol.scope` 收为 `[]`，运行期动态授权。
- 封闭格式契约：tgz 内恰好 `package.json` + 单个入口 `.js`（npm `package/` 前缀剥掉后）；`package.json` 声明 `"studywiki": { "apiVersion": <number>, "entry": "<file>" }`、`keywords` 含 `"studywiki-plugin"`、`dependencies` 为空对象；宿主 apiVersion 支持集 `{1}`，集外拒载；任何不符安装即拒、fail-loud 点名缺什么。
- 外置清单行 id 一律 `ext:<name>`；外置行不迁移不猜，以插件目录为准源；内置缺失行迁移合并（enabled 默认 true）。
- 分层纪律零例外：`src/plugins/**` 禁值导入 `@tauri-apps/*` 与 `../host`（`import type` 放行）；plugin-manager 只经 `ctx.plugins`。
- TS 导出与 Tauri 命令必须带文档注释（门禁校验）；生成区不手编（改 Rust 命令后 `pnpm gen:commands`；新源文件在 `scripts/code-map.manifest.json` 登记后 `pnpm gen:code-map`）；常驻文档改动 = 中英三件套 + `pnpm record:i18n -- <中文侧>` 重录。
- 测试即契约：本计划明列的既有测试改动（boot 返回值形状、app-windows 桩增 setRoot、fakeEnv 增 set_window_root 分支）是 Note 背书的契约演进；除此之外不弱化任何既有断言。
- 提交信息用中文、正文说明动机；每个任务独立提交；中间提交不跑门禁（钩子只查尾随空白与 doc-quick），全量校验收敛在 Task 9。

---

### Task 1: Rust 插件目录命令面（封闭契约解析 + 扫描/读入口/删目录）

**Files:**
- Create: `src-tauri/src/plugins.rs`
- Modify: `src-tauri/src/lib.rs`（`mod plugins;` + 命令注册）
- Modify: `src-tauri/Cargo.toml`（无新依赖，本任务不动）
- Test: `src-tauri/src/plugins.rs` 内 `#[cfg(test)]` 模块
- Modify: `docs/commands.md` + `.en.md`（生成区，经 `pnpm gen:commands`）

**Interfaces:**
- Consumes: 无（地基任务；`parse_package_json` 被 Task 2 安装管线复用）。
- Produces（后续任务依赖的确切签名）:
  - Rust `pub fn parse_package_json(raw: &str) -> Result<(String, Option<String>, StudyWikiBlock), String>`——返回 (name, version, studywiki 块)，错误点名缺什么。
  - Rust `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct PluginEntry { name, version: Option<String>, api_version: Option<i64>, entry: Option<String>, problem: Option<String> }`——序列化为 `{name, version, apiVersion, entry, problem}`。
  - Rust `#[serde(rename_all = "camelCase")] pub struct PluginModuleSource { code: String, api_version: i64 }` → `{code, apiVersion}`。
  - Tauri 命令 `list_plugins() -> Vec<PluginEntry>`、`read_plugin_module(name: String) -> Result<PluginModuleSource, String>`、`remove_plugin(name: String) -> Result<(), String>`（Task 4 的 PluginsService 逐字消费）。
  - 纯函数 `pub fn scan_plugins(dir: &Path) -> Vec<PluginEntry>`、`pub fn read_entry_source(dir: &Path, name: &str) -> Result<PluginModuleSource, String>`、`pub fn remove_plugin_dir(dir: &Path, name: &str) -> Result<(), String>`、`pub fn safe_plugin_name(name: &str) -> Result<(), String>`、`pub fn plugin_dir(app: &AppHandle) -> Result<PathBuf, String>`（app_config_dir/plugins，Task 2 落盘复用）。

- [ ] **Step 1: 写失败测试（封闭契约解析 + 扫描 + 路径安全）**

`src-tauri/src/plugins.rs` 先建骨架（仅结构体与函数签名占位 `todo!()` 会挡编译——直接按 Step 3 的实现一起写；本任务按"先写测试模块、跑红、再填实现"的顺序走，红指编译失败也算红）。`#[cfg(test)] mod tests` 内：

```rust
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
        let (name, version, block) = parse_package_json(&package_json("demo", 1, "index.js")).unwrap();
        assert_eq!(name, "demo");
        assert_eq!(version.as_deref(), Some("1.0.0"));
        assert_eq!(block.entry, "index.js");
        // 每缺一条点名一条（fail-loud，不从坏包里猜）
        assert!(parse_package_json(&package_json("demo", 1, "index.js").replace("\"studywiki-plugin\"", "\"other\"")).unwrap_err().contains("studywiki-plugin"));
        assert!(parse_package_json(&r#"{"name":"demo","keywords":["studywiki-plugin"],"studywiki":{"apiVersion":1,"entry":"i.js"}}"#.to_string()).unwrap_err().contains("dependencies"));
        assert!(parse_package_json(&package_json("demo", 1, "i.js").replace("\"dependencies\":{}", "\"dependencies\":{\"x\":\"1\"}")).unwrap_err().contains("零依赖"));
        assert!(parse_package_json(&package_json("demo", 1, "i.js").replace(",\"studywiki\":{\"apiVersion\":1,\"entry\":\"i.js\"}", "")).unwrap_err().contains("studywiki"));
        assert!(parse_package_json(&package_json("", 1, "i.js")).is_err());
        assert!(parse_package_json(&package_json("demo", 0, "i.js")).unwrap_err().contains("apiVersion"));
        assert!(parse_package_json(&package_json("demo", 1, "  ")).unwrap_err().contains("entry"));
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
        assert!(entries[0].problem.as_deref().unwrap().contains("package.json"));
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
        assert!(read_entry_source(&dir, "ghost").unwrap_err().contains("ghost/package.json")); // 目录缺失点名
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
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd src-tauri && cargo test plugins`
Expected: 编译失败（函数与结构体未定义）——本任务的"红"。

- [ ] **Step 3: 写实现**

`src-tauri/src/plugins.rs`：

```rust
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
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginModuleSource {
    pub code: String,
    pub api_version: i64,
}

/// 外置插件 package.json 的 studywiki 块（封闭契约的字面映射）。
#[derive(Deserialize, Serialize)]
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
```

`src-tauri/src/lib.rs` 改动（两处）：

```rust
mod plugins;   // 加在 mod windows; 之后
```

`invoke_handler` 列表加三项（`windows::write_manifest` 之后）：

```rust
            plugins::list_plugins,
            plugins::read_plugin_module,
            plugins::remove_plugin
```

- [ ] **Step 4: 跑测试确认绿 + fmt + 重建命令目录**

Run: `cd src-tauri && cargo fmt && cargo test`
Expected: 全绿（含既有测试）。

Run: `cd /Users/zn-ice/2026/StudyWiki && pnpm gen:commands && pnpm record:i18n -- docs/commands.md`
Expected: `docs/commands.md` 与 `.en.md` 生成区新增三条命令（带 /// 文档注释），配对重录通过。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugins.rs src-tauri/src/lib.rs docs/commands.md docs/commands.en.md docs/commands.i18n.yaml
git commit -m "Rust 插件目录命令面：封闭契约解析 + 扫描/读入口/删目录

外置插件动工的第一块地基：package.json 严格解析（fail-loud 点名缺什么，
坏目录降级为 problem 行不炸列表），路径逃逸拒绝，三命令供前端宿主服务
封装。封闭契约（keywords/零依赖/studywiki 块）在此单一决策点定死。"
```

### Task 2: Rust 安装管线（registry 直拉 + sha512 + tgz 解包校验 + 落盘）

**Files:**
- Modify: `src-tauri/Cargo.toml`（新增 5 个纯 Rust 依赖）
- Modify: `src-tauri/src/plugins.rs`（安装管线纯函数 + 两命令）
- Modify: `src-tauri/src/lib.rs`（注册两命令）
- Test: `src-tauri/src/plugins.rs` 测试模块追加
- Modify: `docs/commands.md` + `.en.md`（生成区）

**Interfaces:**
- Consumes: Task 1 的 `parse_package_json` / `safe_plugin_name` / `plugin_dir`。
- Produces:
  - Tauri 命令 `install_plugin(spec: String) -> Result<String, String>`（spec = `name` 或 `name@version`，支持 scoped 包；成功返回插件名）、`import_plugin(path: String) -> Result<String, String>`（本地 tgz 同管线免联网）。
  - 纯函数 `pub fn extract_and_validate(tgz: &[u8]) -> Result<ExtractedPlugin, String>`、`pub fn verify_integrity(integrity: &str, bytes: &[u8]) -> Result<(), String>`、`pub fn place_plugin(dir: &Path, extracted: &ExtractedPlugin) -> Result<(), String>`。
  - `pub struct ExtractedPlugin { pub name: String, pub version: Option<String>, pub block: StudyWikiBlock, pub code: Vec<u8>, pub raw_package_json: String }`。

- [ ] **Step 1: 加依赖并确认纯 Rust 栈**

`src-tauri/Cargo.toml` `[dependencies]` 追加：

```toml
ureq = { version = "2", default-features = false, features = ["tls", "gzip"] }
flate2 = { version = "1", default-features = false, features = ["rust_backend"] }
tar = "0.4"
sha2 = "0.10"
base64 = "0.22"
```

Run: `cd src-tauri && cargo build 2>&1 | tail -5 && cargo tree --quiet | grep -ci openssl || echo "无 openssl"`
Expected: 构建成功；`grep -ci openssl` 输出 0 或直接落到 echo（cargo tree 里不得出现 openssl——rustls 系纯 Rust 栈，`verify:native-links` 的前置保证）。

- [ ] **Step 2: 写失败测试（fixture tgz 在测试内构造，零网络）**

`src-tauri/src/plugins.rs` 测试模块追加：

```rust
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
            let files: Vec<(&str, &[u8])> = vec![
                ("package/package.json", package_json("demo", 1, "index.js").as_bytes()),
                ("package/index.js", b"export const name = 'demo';"),
            ];
            let tgz = build_tgz(&files);
            let got = extract_and_validate(&tgz).unwrap();
            assert_eq!(got.name, "demo");
            assert_eq!(got.block.api_version, 1);
            assert_eq!(got.code, b"export const name = 'demo';");

            // 缺入口点名
            let no_entry = build_tgz(&[("package/package.json", package_json("demo", 1, "index.js").as_bytes())]);
            assert!(extract_and_validate(&no_entry).unwrap_err().contains("index.js"));
            // 多余文件点名
            let extra = build_tgz(&[
                ("package/package.json", package_json("demo", 1, "index.js").as_bytes()),
                ("package/index.js", b"x"),
                ("package/extra.js", b"y"),
            ]);
            assert!(extract_and_validate(&extra).unwrap_err().contains("实际"));
            // 目录穿越拒
            let evil = build_tgz(&[
                ("package/package.json", package_json("demo", 1, "../evil.js").as_bytes()),
                ("package/../evil.js", b"x"),
            ]);
            assert!(extract_and_validate(&evil).unwrap_err().contains("可疑"));
            // 无 package/ 前缀拒
            let bare = build_tgz(&[("package.json", package_json("demo", 1, "i.js").as_bytes())]);
            assert!(extract_and_validate(&bare).unwrap_err().contains("package/"));
            // 入口不允许子目录（封闭契约：顶层单文件）
            let nested = build_tgz(&[
                ("package/package.json", package_json("demo", 1, "sub/index.js").as_bytes()),
                ("package/sub/index.js", b"x"),
            ]);
            assert!(extract_and_validate(&nested).unwrap_err().contains("顶层"));
            // 坏 package.json 的解析错误原样透传（点名）
            let broken_raw: Vec<u8> = br#"{"name":"demo"}"#.to_vec();
            let badpj = build_tgz(&[
                ("package/package.json", &broken_raw),
                ("package/i.js", b"x"),
            ]);
            assert!(extract_and_validate(&badpj).unwrap_err().contains("studywiki-plugin"));
        }

        #[test]
        fn integrity_sha512_only() {
            use base64::Engine as _;
            use sha2::{Digest, Sha512};
            let bytes = b"tarball-bytes";
            let good = format!("sha512-{}", base64::engine::general_purpose::STANDARD.encode(Sha512::digest(bytes)));
            verify_integrity(&good, bytes).unwrap();
            assert!(verify_integrity(&format!("sha512-{}", base64::engine::general_purpose::STANDARD.encode([0u8; 64])), bytes).is_err());
            assert!(verify_integrity("sha1-AAAA", bytes).unwrap_err().contains("sha1"));
        }

        #[test]
        fn place_writes_raw_package_json_and_entry_atomically() {
            let dir = tmp_plugins_dir("place");
            let files: Vec<(&str, &[u8])> = vec![
                ("package/package.json", package_json("demo", 1, "index.js").as_bytes()),
                ("package/index.js", b"export const name = 'demo';"),
            ];
            let extracted = extract_and_validate(&build_tgz(&files)).unwrap();
            place_plugin(&dir, &extracted).unwrap();
            // package.json 原样落盘（不重建，保留作者字段）
            assert_eq!(std::fs::read_to_string(dir.join("demo/package.json")).unwrap(), package_json("demo", 1, "index.js"));
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
            assert_eq!(split_spec("demo@1.2.3"), ("demo".into(), Some("1.2.3".into())));
            assert_eq!(split_spec("@scope/demo"), ("@scope/demo".into(), None));
            assert_eq!(split_spec("@scope/demo@1.2.3"), ("@scope/demo".into(), Some("1.2.3".into())));
        }
    }
```

- [ ] **Step 3: 跑测试确认红**

Run: `cd src-tauri && cargo test install`
Expected: 编译失败（`extract_and_validate` 等未定义）。

- [ ] **Step 4: 写实现**

`src-tauri/src/plugins.rs` 追加（放在纯函数区之后、命令区之前）：

```rust
/// npm registry 固定公网 npmjs（不内置镜像；用户侧差异交给系统级代理）。
const REGISTRY: &str = "https://registry.npmjs.org";

/// 解包校验后的成品：package.json 原文 + 入口字节（落盘时原样写回，不重建）。
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
/// 无穿越面），恰好 `package.json` + 声明的入口两个文件；package.json 过严格解析。
pub fn extract_and_validate(tgz: &[u8]) -> Result<ExtractedPlugin, String> {
    use std::io::Read;
    let gz = flate2::read::GzDecoder::new(tgz);
    let mut archive = tar::Archive::new(gz);
    let mut package_json: Option<Vec<u8>> = None;
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for entry in archive.entries().map_err(|e| format!("读 tar 条目失败：{e}"))? {
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
    let raw_package_json = String::from_utf8(raw).map_err(|e| format!("package.json 非 UTF-8：{e}"))?;
    let (name, version, block) = parse_package_json(&raw_package_json)?;
    let entry_name = block.entry.clone();
    if entry_name.contains('/') || entry_name.contains('\\') {
        return Err(format!("studywiki.entry 必须是顶层单文件，收到 {entry_name}（{name}）"));
    }
    if !files.iter().any(|(n, _)| n == &entry_name) {
        return Err(format!("tgz 缺入口文件 {entry_name}（{name}）"));
    }
    if files.len() != 2 || files.iter().any(|(n, _)| n != "package.json" && n != &entry_name) {
        let names: Vec<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
        return Err(format!(
            "tgz 必须恰好含 package.json 与入口 {entry_name}（{name}），实际：{names:?}"
        ));
    }
    let code = files
        .into_iter()
        .find(|(n, _)| n == entry_name)
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
    let body: String = ureq::get(&url)
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
    use std::io::Read;
    let resolved = resolve_registry(&spec)?;
    let mut bytes = Vec::new();
    ureq::get(&resolved.tarball)
        .call()
        .map_err(|e| format!("下载 tarball 失败：{e}"))?
        .into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读 tarball 失败：{e}"))?;
    install_bytes(&app, &bytes, Some(&resolved.integrity))
}

/// 本地导入 tgz（同校验管线，免联网）；成功返回插件名。
#[tauri::command]
pub fn import_plugin(app: AppHandle, path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("读 {path} 失败：{e}"))?;
    install_bytes(&app, &bytes, None)
}
```

`src-tauri/src/lib.rs`：`std_write` 不动（place_plugin 直接 `fs::write`，无需复用）；`invoke_handler` 加：

```rust
            plugins::install_plugin,
            plugins::import_plugin
```

（放在 `plugins::remove_plugin` 之后。）

- [ ] **Step 5: 跑测试确认绿 + fmt + 重建命令目录**

Run: `cd src-tauri && cargo fmt && cargo test`
Expected: 全绿。

Run: `cd /Users/zn-ice/2026/StudyWiki && pnpm gen:commands && pnpm record:i18n -- docs/commands.md`
Expected: 生成区新增 `install_plugin` / `import_plugin`。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/plugins.rs src-tauri/src/lib.rs docs/commands.md docs/commands.en.md docs/commands.i18n.yaml
git commit -m "Rust 安装管线：registry 直拉 + sha512 + tgz 解包校验 + 原子落盘

宿主把 npm 当仓库用、不当运行时用：安装是一次性联网动作（ureq+rustls
纯 Rust 栈，零 OpenSSL），封闭契约在解包处单一决策点校验（恰好两个文件、
无穿越、package.json 严格解析），落盘 staging+rename 保证目录永远完整。
本地导入走同一管线免联网，作为第二入口。"
```

### Task 3: 装载通道（扫描器盲区顺修 + blob 装载缝 + CSP + 白名单开缝）

**Files:**
- Modify: `scripts/verify-layering.mjs`（IMPORT_FROM / EXPORT_FROM 无空白形态）
- Modify: `scripts/verify-layering.spec.mjs`（真阳 fixture）
- Create: `src/loader/external.ts`
- Create: `tests/loader-external.test.ts`
- Modify: `src-tauri/tauri.conf.json`（CSP `script-src` 增 `blob:`）
- Modify: `scripts/layering-allowlist.json`（第一条缝）

**Interfaces:**
- Consumes: 无（独立于 Task 1/2，可与它们并行）。
- Produces: `export async function loadExternalModule(code: string, importFn?: (url: string) => Promise<Record<string, unknown>>): Promise<Record<string, unknown>>`——Task 4 的 PluginsService 与 Task 6 的 bootstrap 消费；缺省 importFn 即真实 `import(/* @vite-ignore */ url)`（blob 通道本体）。

- [ ] **Step 1: 写扫描器失败的测试（无空白 import 盲区）**

`scripts/verify-layering.spec.mjs` 追加：

```js
test("插件层: 无空白 import/export 同样红（盲区顺修）", () => {
  expect(scanPluginSource("src/plugins/a/index.ts", `import{invoke}from"@tauri-apps/api/core";`).length).toBe(1);
  expect(scanPluginSource("src/plugins/a/index.ts", `import*as ns from"@tauri-apps/api/core";`).length).toBe(1);
  expect(scanPluginSource("src/plugins/a/index.ts", `export{invoke}from"@tauri-apps/api/core";`).length).toBe(1);
  // 不误伤：import/export 作标识符片段（lookbehind 挡）
  expect(scanPluginSource("src/plugins/a/index.ts", `const imported = { from: 1 };`).length).toBe(0);
  expect(scanPluginSource("src/plugins/a/index.ts", `const exports2 = 1; exports2.from("x");`).length).toBe(0);
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm test -- scripts/verify-layering.spec.mjs`
Expected: 新用例 FAIL（`import{…}from"…"` 当前不被 IMPORT_FROM 命中——`\s+` 要求至少一个空白）。

- [ ] **Step 3: 修扫描器**

`scripts/verify-layering.mjs` 两行正则（保持行号不变，仅替换定义）：

```js
const IMPORT_FROM = /(?<![\w.$])import\s*(type\s+)?[^"';]*?from\s*["']([^"']+)["']/g;
const EXPORT_FROM = /(?<![\w.$])export\s*(type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*["']([^"']+)["']/g;
```

改动点：`\s+` → `\s*`（无空白形态入网）、加 `(?<![\w.$])` lookbehind（`imported`/`reimport` 等标识符片段不误伤；与 SIDE_EFFECT_IMPORT 的既有 lookbehind 同款）。

Run: `pnpm test -- scripts/verify-layering.spec.mjs`
Expected: 全绿（新旧用例都过——既有用例钉住带空白形态与 `steps.from` 误伤护栏，必须仍然绿）。

- [ ] **Step 4: 写 external.ts 失败测试**

`tests/loader-external.test.ts`：

```ts
import { afterEach, expect, test, vi } from "vitest";
import { loadExternalModule } from "../src/loader/external";

afterEach(() => vi.restoreAllMocks());

test("blob 通道：createObjectURL → import → revoke，命名空间原样返回", async () => {
  const code = "export const name = 'ext-demo'; export const apply = () => {};";
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const importFn = vi.fn(async (url: string) => {
    expect(url).toBe("blob:fake-url");
    return { name: "ext-demo", apply: () => {} };
  });
  const mod = await loadExternalModule(code, importFn);
  expect(mod.name).toBe("ext-demo");
  // Blob 内容逐字传递、类型是 JS 模块
  const blob = create.mock.calls[0][0] as Blob;
  expect(blob.type).toBe("text/javascript");
  await expect(blob.text()).resolves.toBe(code);
  expect(importFn).toHaveBeenCalledWith("blob:fake-url");
  expect(revoke).toHaveBeenCalledWith("blob:fake-url");
});

test("装载失败也回收 blob URL（finally 兜底）", async () => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:boom");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const importFn = vi.fn(async () => {
    throw new SyntaxError("bad module");
  });
  await expect(loadExternalModule("export broken", importFn)).rejects.toThrow("bad module");
  expect(revoke).toHaveBeenCalledWith("blob:boom");
});
```

- [ ] **Step 5: 跑测试确认红**

Run: `pnpm test -- tests/loader-external.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 6: 写实现 + 开缝**

`src/loader/external.ts`：

```ts
/** 外置模块装载缝：全前端唯一动态 import 点（layering-allowlist.json 单条登记）。
 * blob URL 通道（Phase 2 Note 决策 1 落定形态）：Rust 命令读入口源码 → JS 端
 * Blob → 动态 import → 用后即回收。单文件零依赖契约使 blob 的常见弱点
 * （相对导入解析、URL 生命周期）归零。
 * @param code 插件入口 ESM 源码（UTF-8 文本，来自 read_plugin_module）。
 * @param importFn 动态 import 实现；缺省为真实 import（webview 内 blob: 生效），
 *   测试注入假实现以离线全链路测试。
 * @returns 模块命名空间对象（形状校验在调用方 PluginsService.loadModule）。 */
export async function loadExternalModule(
  code: string,
  importFn: (url: string) => Promise<Record<string, unknown>> = (url) => import(/* @vite-ignore */ url),
): Promise<Record<string, unknown>> {
  const blob = new Blob([code], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    return await importFn(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

`scripts/layering-allowlist.json` 整文件替换：

```json
{
  "//": "动态装载缝白名单（相对仓库根路径）。Phase 2 起 src/loader/external.ts 是全前端唯一动态 import 点（blob 通道装外置插件 ESM）；任何第二条缝必须回 .agents/notes/proposed/architecture/2026-09-11-phase2-external-plugins.md 修订并说明理由。",
  "files": ["src/loader/external.ts"]
}
```

`src-tauri/tauri.conf.json` CSP 片段（只动 script-src，其余逐字保留）：

```json
"csp": "default-src 'self' ipc: http://ipc.localhost; img-src 'self' asset: http://asset.localhost data:; media-src 'self' asset: http://asset.localhost blob:; style-src 'self' 'unsafe-inline'; script-src 'self' blob:"
```

- [ ] **Step 7: 全量验证 + 门禁**

Run: `pnpm test && pnpm verify:layering && pnpm verify:env-independence`
Expected: vitest 全绿（含既有装载缝用例——白名单空数组时 external.ts 会红，这是白名单生效的证明，开缝后绿）；layering 通过（缝登记单条）；env-independence 通过（src/ 无 http 引用）。

- [ ] **Step 8: Commit**

```bash
git add scripts/verify-layering.mjs scripts/verify-layering.spec.mjs src/loader/external.ts tests/loader-external.test.ts scripts/layering-allowlist.json src-tauri/tauri.conf.json
git commit -m "装载通道定案：blob URL 装载缝 + 扫描器无空白盲区顺修 + CSP 增 blob:

外置装载缝从零到一（Note 预许的两候选中裁定取 blob：单文件零依赖契约
使 blob 弱点归零，且通道可注入假 import 在 vitest 下全链路测试；自定义
协议 ESM 只能真实 webview 验证，留作备选）。开缝前先补扫描器
import{x}from\"…\" 无空白盲区——缝的门禁先于缝存在。CSP 只给 script-src
增 blob:，不开任何 connect-src（联网仅限 Rust 安装动作）。"
```

### Task 4: 宿主服务 ctx.plugins（包管理命令封装 + 装载通道取模块 + 支持集判定）

**Files:**
- Create: `src/host/plugins.ts`
- Modify: `src/host/context.d.ts`（挂第五服务）
- Create: `tests/host-plugins.test.ts`

**Interfaces:**
- Consumes: Task 1/2 的 Tauri 命令（`install_plugin{spec}` / `import_plugin{path}` / `list_plugins` / `remove_plugin{name}` / `read_plugin_module{name}`）、Task 3 的 `loadExternalModule(code)`。
- Produces（Task 6/7 消费的确切签名）:
  - `export class PluginsService`：`install(spec: string): Promise<string>`、`importFromTgz(): Promise<string | null>`（弹选框，取消返回 null）、`list(): Promise<PluginEntry[]>`、`remove(name: string): Promise<void>`、`readManifest(): Promise<string | null>`、`writeManifest(manifest: Manifest): Promise<void>`、`loadModule(name: string): Promise<PluginModule>`、字段 `bootBroken: BrokenRow[]`。
  - `export interface PluginEntry { name: string; version: string | null; apiVersion: number | null; entry: string | null; problem: string | null }`。
  - `export interface BrokenRow { id: string; reason: string }`。
  - `export const SUPPORTED_API_VERSIONS: readonly number[] = [1]`。
  - `export interface PluginsDeps { invoke; loadExternal: (code: string) => Promise<Record<string, unknown>>; pickTgz: () => Promise<string | null> }` + `defaultPluginsDeps`（真实 Tauri 绑定）。

- [ ] **Step 1: 写失败测试**

`tests/host-plugins.test.ts`：

```ts
import { expect, test, vi } from "vitest";
import { PluginsService, SUPPORTED_API_VERSIONS } from "../src/host/plugins";

const deps = (invoke: ReturnType<typeof vi.fn>, loadExternal?: (code: string) => Promise<Record<string, unknown>>) => ({
  invoke,
  loadExternal: loadExternal ?? (async () => ({})),
  pickTgz: vi.fn(async () => "/x/demo.tgz"),
});

test("install/remove/list/readManifest/writeManifest 透传参数与错误", async () => {
  const invoke = vi.fn().mockResolvedValue("demo");
  const p = new PluginsService(deps(invoke));
  await expect(p.install("demo@1.0.0")).resolves.toBe("demo");
  expect(invoke).toHaveBeenCalledWith("install_plugin", { spec: "demo@1.0.0" });
  await p.remove("demo");
  expect(invoke).toHaveBeenCalledWith("remove_plugin", { name: "demo" });
  await p.list();
  expect(invoke).toHaveBeenCalledWith("list_plugins");
  await p.readManifest();
  expect(invoke).toHaveBeenCalledWith("read_manifest");
  await p.writeManifest({ plugins: [] });
  expect(invoke).toHaveBeenLastCalledWith("write_manifest", { json: JSON.stringify({ plugins: [] }, null, 2) });
});

test("importFromTgz：选文件后走 import_plugin；取消返回 null 不调命令", async () => {
  const invoke = vi.fn().mockResolvedValue("demo");
  const d = deps(invoke);
  await expect(new PluginsService(d).importFromTgz()).resolves.toBe("demo");
  expect(invoke).toHaveBeenCalledWith("import_plugin", { path: "/x/demo.tgz" });
  const cancelled = deps(vi.fn());
  cancelled.pickTgz = vi.fn(async () => null);
  await expect(new PluginsService(cancelled).importFromTgz()).resolves.toBeNull();
  expect(cancelled.invoke).not.toHaveBeenCalled();
});

test("loadModule：apiVersion 支持集外拒载（点名版本）", async () => {
  const invoke = vi.fn().mockResolvedValue({ code: "export const name='d'", apiVersion: 2 });
  const p = new PluginsService(deps(invoke));
  await expect(p.loadModule("d")).rejects.toThrow(/apiVersion 2.*支持集/);
});

test("loadModule：形状校验 fail-loud 点名缺什么", async () => {
  const invoke = vi.fn().mockResolvedValue({ code: "x", apiVersion: 1 });
  const noName = new PluginsService(deps(invoke, async () => ({ apply: () => {} })));
  await expect(noName.loadModule("d")).rejects.toThrow(/缺.*name/);
  const noApply = new PluginsService(deps(invoke, async () => ({ name: "d" })));
  await expect(noApply.loadModule("d")).rejects.toThrow(/缺.*apply/);
  const badInject = new PluginsService(deps(invoke, async () => ({ name: "d", apply: () => {}, inject: [1] })));
  await expect(badInject.loadModule("d")).rejects.toThrow(/inject/);
});

test("loadModule：支持集内 + 形状合法即返回模块（blob 原料逐字传递）", async () => {
  const code = "export const name = 'demo-hello';";
  const invoke = vi.fn().mockResolvedValue({ code, apiVersion: 1 });
  const loadExternal = vi.fn(async (c: string) => {
    expect(c).toBe(code);
    return { name: "demo-hello", inject: ["slots"], apply: () => {} };
  });
  const mod = await new PluginsService(deps(invoke, loadExternal)).loadModule("demo-hello");
  expect(mod.name).toBe("demo-hello");
  expect(SUPPORTED_API_VERSIONS).toEqual([1]);
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm test -- tests/host-plugins.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

`src/host/plugins.ts`：

```ts
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Manifest } from "../loader/manifest";
import { loadExternalModule } from "../loader/external";
import type { PluginModule } from "../loader/types";

/** 宿主支持的外置插件 apiVersion 支持集；扩集必须回 Phase 2 Note 修订。 */
export const SUPPORTED_API_VERSIONS: readonly number[] = [1];

/** list_plugins() 的行：健康行带元数据，坏行带 problem（面板标待清理）。 */
export interface PluginEntry {
  name: string;
  version: string | null;
  apiVersion: number | null;
  entry: string | null;
  problem: string | null;
}

/** boot 期间外置行装载失败的分治记录（面板待清理的数据来源）。 */
export interface BrokenRow {
  id: string;
  reason: string;
}

/** Tauri bindings this service wraps; injectable for tests. */
export interface PluginsDeps {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  loadExternal: (code: string) => Promise<Record<string, unknown>>;
  pickTgz: () => Promise<string | null>;
}

/** Real bindings; the loading seam lives in loader/external.ts. */
export const defaultPluginsDeps: PluginsDeps = {
  invoke,
  loadExternal: (code) => loadExternalModule(code),
  pickTgz: () =>
    open({
      multiple: false,
      filters: [{ name: "插件 tarball", extensions: ["tgz", "tar.gz"] }],
    }) as Promise<string | null>,
};

/** 宿主插件包服务：外置插件安装/导入/列出/移除 + 装载通道取模块 + 清单读写
 * 的唯一入口；plugin-manager 是其唯一消费者（Phase 2 内）。 */
export class PluginsService {
  readonly #deps: PluginsDeps;
  /** boot 报告的外置坏行；bootstrap 在 boot 后回填，面板读它点名待清理。 */
  bootBroken: BrokenRow[] = [];

  constructor(deps: PluginsDeps = defaultPluginsDeps) {
    this.#deps = deps;
  }

  /** 按名安装（`name` 或 `name@version`，registry 直拉；产品唯一联网动作）。 */
  async install(spec: string): Promise<string> {
    return this.#deps.invoke("install_plugin", { spec }) as Promise<string>;
  }

  /** 弹选本地 tgz 并导入（同校验管线免联网）；取消返回 null。 */
  async importFromTgz(): Promise<string | null> {
    const path = await this.#deps.pickTgz();
    if (path === null) return null;
    return this.#deps.invoke("import_plugin", { path }) as Promise<string>;
  }

  /** 扫描插件目录：健康行带元数据，坏行带 problem。 */
  async list(): Promise<PluginEntry[]> {
    return this.#deps.invoke("list_plugins") as Promise<PluginEntry[]>;
  }

  /** 删除外置插件目录（幂等：目录已不在也成功）。 */
  async remove(name: string): Promise<void> {
    await this.#deps.invoke("remove_plugin", { name });
  }

  /** 读清单原文（null = 首启未生成）。 */
  async readManifest(): Promise<string | null> {
    return this.#deps.invoke("read_manifest") as Promise<string | null>;
  }

  /** 写回清单（面板开关/移除后的持久化通道）。 */
  async writeManifest(manifest: Manifest): Promise<void> {
    await this.#deps.invoke("write_manifest", {
      json: JSON.stringify(manifest, null, 2),
    });
  }

  /** 经装载通道取外置模块：apiVersion 支持集判定 + 形状校验，不符即拒
   * （fail-loud 点名缺什么；boot 侧把它分治为待清理行而非崩溃）。 */
  async loadModule(name: string): Promise<PluginModule> {
    const src = (await this.#deps.invoke("read_plugin_module", { name })) as {
      code: string;
      apiVersion: number;
    };
    if (!SUPPORTED_API_VERSIONS.includes(src.apiVersion)) {
      throw new Error(`外置插件 ${name} 的 apiVersion ${src.apiVersion} 不在支持集 {${SUPPORTED_API_VERSIONS.join(", ")}} 内`);
    }
    const mod = (await this.#deps.loadExternal(src.code)) as Partial<PluginModule>;
    if (typeof mod.name !== "string" || mod.name.length === 0) {
      throw new Error(`外置插件 ${name} 缺少非空 name 导出`);
    }
    if (typeof mod.apply !== "function") {
      throw new Error(`外置插件 ${name}（${mod.name}）缺少 apply 函数导出`);
    }
    if (Array.isArray(mod.inject) && mod.inject.some((k) => typeof k !== "string")) {
      throw new Error(`外置插件 ${name}（${mod.name}）的 inject 必须是字符串数组`);
    }
    return mod as PluginModule;
  }
}
```

`src/host/context.d.ts`：import 区加 `import type { PluginsService } from "./plugins";`，`interface Context` 增成员（带注释）：

```ts
    /** 外置插件包管理 + 装载通道（plugin-manager 唯一消费者）。 */
    plugins: PluginsService;
```

- [ ] **Step 4: 跑测试确认绿 + 门禁**

Run: `pnpm test && pnpm build && pnpm verify:layering && pnpm verify:docs`
Expected: 全绿（host 层允许 import @tauri-apps/*；export 文档注释齐）。

- [ ] **Step 5: Commit**

```bash
git add src/host/plugins.ts src/host/context.d.ts tests/host-plugins.test.ts
git commit -m "宿主服务 ctx.plugins：包管理命令封装 + 装载通道取模块

外置插件管理与装载走宿主服务的既定纪律落到第五个服务上：四个包管理
命令 + read/write 清单 + loadModule（apiVersion 支持集 {1} 与形状校验的
运行期侧，fail-loud 点名）。src/plugins/** 分层纪律零例外——plugin-manager
将是它的唯一消费者。"
```

### Task 5: 存量清单迁移 + boot 第二来源（BootReport 与分治）

**Files:**
- Modify: `src/loader/manifest.ts`（迁移合并）
- Modify: `src/loader/boot.ts`（ext: 行 + BootReport）
- Modify: `tests/loader.test.ts`（既有用例适配 + 新用例）

**Interfaces:**
- Consumes: Task 4 的 `PluginModule`（loader/types 既有）。
- Produces（Task 6/7 消费）:
  - `boot(ctx: Context, manifest: Manifest, table: ModuleTable, loadExternal: (name: string) => Promise<PluginModule>): Promise<BootReport>`——第 4 参从无到有（必填）。
  - `export interface BootReport { loaded: string[]; broken: Array<{ id: string; reason: string }> }`。
  - `loadManifest` 行为变化：读到存量清单时合并静态表新增而清单缺失的内置行（enabled 默认 true）并写回落盘；外置行（`ext:`）不迁移不猜。

- [ ] **Step 1: 更新既有测试 + 写新测试（先红）**

`tests/loader.test.ts` 改动——既有 boot 用例补第 4 参（一个抛错的桩，确保"没有外置行时通道不被调用"）并适配返回值：

```ts
const noExt = async () => {
  throw new Error("不应触达外置装载");
};

test("boot: 注入缺失 fail-loud 点名", async () => {
  const table: ModuleTable = { "p-orphan": entry({ name: "p-orphan", inject: ["nope"], apply() {} }) };
  await expect(boot(new Context(), { plugins: [{ id: "p-orphan", enabled: true, config: {} }] }, table, noExt))
    .rejects.toThrow(/p-orphan/);
});

test("boot: enabled=false 跳过；未知 id 报错；返回报告形状", async () => {
  const table: ModuleTable = { "p-on": entry({ name: "p-on", apply() {} }) };
  await expect(boot(new Context(), { plugins: [{ id: "p-on", enabled: false, config: {} }] }, table, noExt))
    .resolves.toEqual({ loaded: [], broken: [] });
  await expect(boot(new Context(), { plugins: [{ id: "ghost", enabled: true, config: {} }] }, table, noExt))
    .rejects.toThrow(/ghost/);
});

test("boot: defaults 与 config 合并后传入 apply", async () => {
  const seen: unknown[] = [];
  const table: ModuleTable = { "p-cfg": entry({ name: "p-cfg", apply(_c, cfg) { seen.push(cfg); } }, { a: 1, b: 1 }) };
  await boot(new Context(), { plugins: [{ id: "p-cfg", enabled: true, config: { b: 2 } }] }, table, noExt);
  expect(seen).toEqual([{ a: 1, b: 2 }]);
});
```

追加新用例：

```ts
test("boot: ext: 行经 loadExternal 装载，row.config 直传（无 defaults 合并）", async () => {
  const table: ModuleTable = { "p-on": entry({ name: "p-on", apply() {} }) };
  const configs: unknown[] = [];
  const loadExternal = async (name: string) => ({
    name: `ext-${name}`,
    apply(_c: unknown, cfg: unknown) { configs.push(cfg); },
  });
  const report = await boot(
    new Context(),
    { plugins: [{ id: "p-on", enabled: true, config: {} }, { id: "ext:demo", enabled: true, config: { x: 1 } }] },
    table,
    loadExternal,
  );
  expect(report).toEqual({ loaded: ["p-on", "ext:demo"], broken: [] });
  expect(configs).toEqual([{ x: 1 }]);
});

test("boot: ext: 行装载失败分治为坏行，不阻断其余插件", async () => {
  const table: ModuleTable = { "p-on": entry({ name: "p-on", apply() {} }) };
  const loadExternal = async () => {
    throw new Error("读 demo/package.json 失败：NotFound");
  };
  const report = await boot(
    new Context(),
    { plugins: [{ id: "ext:demo", enabled: true, config: {} }, { id: "p-on", enabled: true, config: {} }] },
    table,
    loadExternal,
  );
  expect(report.loaded).toEqual(["p-on"]);
  expect(report.broken).toEqual([{ id: "ext:demo", reason: "读 demo/package.json 失败：NotFound" }]);
});

test("boot: ext: 行审计卡死也归坏行；内置卡死仍 fail-loud", async () => {
  const table: ModuleTable = { "p-bad": entry({ name: "p-bad", inject: ["nope"], apply() {} }) };
  const stuck = async () => ({ name: "ext-stuck", inject: ["nope"], apply() {} });
  // 外置卡死：不抛，进 broken
  const r1 = await boot(new Context(), { plugins: [{ id: "ext:stuck", enabled: true, config: {} }] }, {}, stuck);
  expect(r1.broken[0].id).toBe("ext:stuck");
  expect(r1.broken[0].reason).toMatch(/未激活/);
  // 内置卡死：照旧抛（契约不变）
  await expect(boot(new Context(), { plugins: [{ id: "p-bad", enabled: true, config: {} }] }, table, noExt))
    .rejects.toThrow(/装载审计失败/);
});

test("boot: 禁用的 ext: 行不触达装载通道", async () => {
  const table: ModuleTable = { "p-on": entry({ name: "p-on", apply() {} }) };
  await expect(
    boot(new Context(), { plugins: [{ id: "ext:off", enabled: false, config: {} }] }, table, noExt),
  ).resolves.toEqual({ loaded: [], broken: [] });
});

test("loadManifest: 存量清单合并静态表新增内置行（enabled true）并写回；ext: 行不动", async () => {
  const table: ModuleTable = {
    "p-old": entry({ name: "p-old", apply() {} }),
    "p-new": entry({ name: "p-new", apply() {} }, { k: 1 }),
  };
  const raw = JSON.stringify({
    plugins: [
      { id: "p-old", enabled: false, config: {} },
      { id: "ext:demo", enabled: true, config: { x: 1 } },
    ],
  });
  const written: string[] = [];
  const m = await loadManifest(async () => raw, async (j) => { written.push(j); }, table);
  expect(m.plugins.map((r) => r.id)).toEqual(["p-old", "ext:demo", "p-new"]);
  expect(m.plugins[2]).toEqual({ id: "p-new", enabled: true, config: { k: 1 } });
  expect(written).toHaveLength(1); // 合并发生才写回
  expect(JSON.parse(written[0]).plugins[2].enabled).toBe(true);
});

test("loadManifest: 清单已含全部内置行则不写回（无谓写盘）", async () => {
  const table: ModuleTable = { "p-x": entry({ name: "p-x", apply() {} }) };
  const raw = JSON.stringify({ plugins: [{ id: "p-x", enabled: false, config: {} }] });
  const written: string[] = [];
  const m = await loadManifest(async () => raw, async (j) => { written.push(j); }, table);
  expect(m.plugins[0].enabled).toBe(false); // 既有开关不被迁移覆盖
  expect(written).toHaveLength(0);
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm test -- tests/loader.test.ts`
Expected: 新用例与改签名后的既有用例 FAIL（boot 无第 4 参 / 返回 void；loadManifest 无迁移）。

- [ ] **Step 3: 写实现**

`src/loader/manifest.ts`：行校验通过后、`return parsed` 前，替换为迁移段（`write` 与 `parsed` 之间的既有代码不动）：

```ts
    // 存量迁移：静态表新增而清单缺失的内置行合并进去（enabled 默认 true，与首启
    // 一致——版本升级带新内置属行为一致条款的设计内变化）；外置行（ext:）不迁移
    // 不猜，以插件目录为准源。合并发生即写回落盘。
    const known = new Set(plugins.map((row) => row.id));
    const missing = Object.keys(table)
      .filter((id) => !known.has(id))
      .map((id) => ({ id, enabled: true, config: { ...table[id].defaults } }));
    if (missing.length) {
      const merged: Manifest = { plugins: [...plugins, ...missing] };
      await write(JSON.stringify(merged, null, 2));
      return merged;
    }
    return parsed as Manifest;
```

`src/loader/boot.ts` 整文件替换：

```ts
import { Context, FiberState } from "cordis";
import type { Manifest } from "./manifest";
import type { ModuleTable } from "./table";
import type { PluginModule } from "./types";

/** boot 结果报告：成功激活的 id 与分治跳过的外置坏行（面板待清理）。 */
export interface BootReport {
  loaded: string[];
  /** 外置行装载失败（目录缺失/入口损坏/形状不符/审计卡死）：跳过不阻断，面板点名。 */
  broken: Array<{ id: string; reason: string }>;
}

/** Boot every enabled row, then audit fiber states: built-in failures stay
 * fail-loud; external (ext:*) failures are quarantined into the report —
 * external resources are user-side state and must not block the whole app.
 * @param ctx Host context the plugins attach to.
 * @param manifest Persisted manifest rows driving what gets loaded.
 * @param table Static module table resolving built-in ids to plugins.
 * @param loadExternal Resolves an external plugin name to its module
 *   (Rust 读入口 + blob 装载 + 支持集/形状校验，见 host/plugins.ts).
 * @returns The boot report (activated ids + quarantined external rows). */
export async function boot(
  ctx: Context,
  manifest: Manifest,
  table: ModuleTable,
  loadExternal: (name: string) => Promise<PluginModule>,
): Promise<BootReport> {
  const loaded: string[] = [];
  const broken: Array<{ id: string; reason: string }> = [];
  const states: Array<{ id: string; state: () => number }> = [];
  for (const row of manifest.plugins) {
    if (!row.enabled) continue;
    if (row.id.startsWith("ext:")) {
      const name = row.id.slice(4);
      try {
        const plugin = await loadExternal(name);
        const fiber = ctx.plugin(plugin, row.config);
        states.push({ id: row.id, state: () => fiber.state });
        loaded.push(row.id);
      } catch (e) {
        // 资源缺失/入口损坏/形状不符：跳过并点名，不阻断其余插件。
        broken.push({ id: row.id, reason: (e as Error).message });
      }
      continue;
    }
    const entry = table[row.id];
    if (!entry) throw new Error(`装载失败：清单条目 "${row.id}" 不在静态模块表中`);
    const fiber = ctx.plugin(entry.plugin, { ...entry.defaults, ...row.config });
    states.push({ id: row.id, state: () => fiber.state });
    loaded.push(row.id);
  }
  await new Promise((r) => setTimeout(r, 50)); // 全树静默（注入等待 + 激活）
  const stuck = states.filter((s) => s.state() !== FiberState.ACTIVE);
  const stuckBuiltin = stuck
    .filter((s) => !s.id.startsWith("ext:"))
    .map((s) => `${s.id}（state=${s.state()}）`);
  if (stuckBuiltin.length) {
    throw new Error(`装载审计失败：${stuckBuiltin.join("、")} 未激活——声明的服务未提供？`);
  }
  for (const s of stuck) {
    // 外置行审计卡死（声明的服务未提供等）同样分治为坏行。
    broken.push({ id: s.id, reason: `审计未激活（state=${s.state()}）：声明的服务未提供？` });
    const i = loaded.indexOf(s.id);
    if (i >= 0) loaded.splice(i, 1);
  }
  return { loaded, broken };
}
```

注意：此时 `src/bootstrap.ts` 的 `boot(ctx, manifest, table)` 调用会编译红——本任务**同时**把 bootstrap 的调用点补上第 4 参（临时桩即可，Task 6 才正式接线）：

```ts
  const report = await boot(ctx, manifest, table, async () => {
    throw new Error("外置装载通道未接线（Task 6）");
  });
  void report;
```

`tests/bootstrap.test.ts` 既有用例不受影响（默认清单无 ext: 行，桩不会被调用）。

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm test && pnpm build`
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/loader/manifest.ts src/loader/boot.ts src/bootstrap.ts tests/loader.test.ts
git commit -m "清单迁移 + boot 第二来源：ext: 行分治为坏行，内置 fail-loud 不变

升级用户的存量清单自动补新内置行（enabled true，与首启同形——版本升级
带新内置是设计内变化），外置行以插件目录为准源不迁移不猜。boot 返回
BootReport：外置坏行（目录缺失/入口损坏/形状不符/审计卡死）跳过装载、
报告点名，不再有权让整个应用起不来；内置行的 fail-loud 契约逐字不变。"
```

### Task 6: bootstrap 接线 + 启动错误面板（白屏收口）

**Files:**
- Modify: `src/bootstrap.ts`（PluginsService 接线 + loadExternal + bootBroken 回填）
- Create: `src/boot-error.ts`
- Modify: `src/main.ts`（catch → renderBootError）
- Modify: `src/styles.css`（.boot-error 最小样式）
- Modify: `tests/bootstrap.test.ts`（外置行 happy path 追加）
- Create: `tests/boot-error.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `PluginsService` / `defaultPluginsDeps`、Task 5 的 `boot`（4 参 + BootReport）。
- Produces: `export function renderBootError(error: unknown): void`（main.ts 消费）；`BootstrapEnv` 增两个可选注入 `loadExternal?: (code: string) => Promise<Record<string, unknown>>` 与 `openTgz?: () => Promise<string | null>`（测试注桩用；缺省为真实绑定）。

- [ ] **Step 1: 写失败测试**

`tests/boot-error.test.ts`：

```ts
// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { renderBootError } from "../src/boot-error";

afterEach(() => vi.restoreAllMocks());

test("renderBootError: 向 #app 内联渲染错误与指引，替代白屏；错误进 console", () => {
  document.body.innerHTML = '<div id="app"></div>';
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  renderBootError(new Error("装载审计失败：p-x（state=1）未激活"));
  const app = document.querySelector<HTMLElement>("#app")!;
  expect(app.querySelector("h1")!.textContent).toBe("StudyWiki 启动失败");
  expect(app.querySelector("pre")!.textContent).toContain("p-x");
  expect(app.querySelector("p")!.textContent!.length).toBeGreaterThan(0); // 清理指引非空
  expect(err).toHaveBeenCalled();
});

test("renderBootError: 非 Error 值 String 化；无 #app 不抛", () => {
  document.body.innerHTML = '<div id="app"></div>';
  vi.spyOn(console, "error").mockImplementation(() => {});
  renderBootError("boom");
  expect(document.querySelector("pre")!.textContent).toBe("boom");
  document.body.innerHTML = "";
  expect(() => renderBootError(new Error("x"))).not.toThrow();
});
```

`tests/bootstrap.test.ts` 追加（既有 fakeEnv 不动——默认清单无 ext: 行，新链路不会被触达）：

```ts
test("bootstrap: ext: 行经宿主服务装载，坏行回填 plugins.bootBroken", async () => {
  const f = fakeEnv({});
  const okModule = { name: "ext-demo", inject: ["slots"], apply() {} };
  f.env.loadExternal = async (code: string) => {
    expect(code).toBe("export const name = 'ext-demo';");
    return okModule as unknown as Record<string, unknown>;
  };
  f.env.invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "read_manifest") {
      return JSON.stringify({
        plugins: [
          { id: "app-shell", enabled: true, config: {} },
          { id: "ext:demo", enabled: true, config: {} },
          { id: "ext:gone", enabled: true, config: {} },
        ],
      });
    }
    if (cmd === "write_manifest") return null;
    if (cmd === "get_window_state") return null;
    if (cmd === "read_tree") return [];
    if (cmd === "read_plugin_module") {
      return args?.name === "demo"
        ? { code: "export const name = 'ext-demo';", apiVersion: 1 }
        : Promise.reject(new Error("读 gone/package.json 失败：NotFound"));
    }
    throw new Error(`unexpected ${cmd}`);
  });
  const ctx = await bootstrap(f.env);
  expect((ctx as any).plugins).toBeDefined();
  expect((ctx as any).plugins.bootBroken).toEqual([
    { id: "ext:gone", reason: "读 gone/package.json 失败：NotFound" },
  ]);
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm test -- tests/boot-error.test.ts tests/bootstrap.test.ts`
Expected: boot-error FAIL（模块不存在）；新 bootstrap 用例 FAIL（ext:demo 未装载成功——loadExternal 未接线）。

- [ ] **Step 3: 写实现**

`src/boot-error.ts`：

```ts
/** bootstrap 拒绝时的最小可见出口：向 #app 内联渲染错误文本与清理指引，
 * 替代白屏；错误仍同时进 console。外置装载失败不走到这里（boot 分治为
 * 坏行），这里兜的是清单损坏、内置审计失败这类致命错。 */
export function renderBootError(error: unknown): void {
  console.error("bootstrap 失败：", error);
  const app = document.querySelector<HTMLElement>("#app");
  if (!app) return;
  app.replaceChildren();
  const box = document.createElement("div");
  box.className = "boot-error";
  const title = document.createElement("h1");
  title.textContent = "StudyWiki 启动失败";
  const detail = document.createElement("pre");
  detail.textContent = error instanceof Error ? error.message : String(error);
  const hint = document.createElement("p");
  hint.textContent = "可尝试：删除应用配置目录下损坏的 plugins.json（及 plugins/ 目录）后重启；或提交 issue 附上上方信息。";
  box.append(title, detail, hint);
  app.append(box);
}
```

`src/main.ts` 整文件替换：

```ts
import { bootstrap } from "./bootstrap";
import { renderBootError } from "./boot-error";
import "./styles.css";

void bootstrap().catch(renderBootError);
```

`src/bootstrap.ts` 改动（import 区 + PluginsService 构造 + boot 调用替换 Task 5 的临时桩）：

import 区加：

```ts
import { PluginsService, defaultPluginsDeps } from "./host/plugins";
import { loadExternalModule } from "./loader/external";
```

`BootstrapEnv` 增两个可选成员（`table?: ModuleTable;` 之后）：

```ts
  /** 外置装载通道注桩（测试用）；缺省为真实 blob 通道。 */
  loadExternal?: (code: string) => Promise<Record<string, unknown>>;
  /** 本地导入 tgz 的选框注桩（测试用）；缺省为真实 dialog。 */
  openTgz?: () => Promise<string | null>;
```

`bootstrap()` 体内：`const slots = new SlotsService();` 之后加：

```ts
  const plugins = new PluginsService({
    invoke: env.invoke,
    loadExternal: env.loadExternal ?? loadExternalModule,
    pickTgz: env.openTgz ?? defaultPluginsDeps.pickTgz,
  });
```

`ctx.reflect.provide` 序列加 `ctx.reflect.provide("plugins", plugins);`（slots 之后）。Task 5 的临时桩调用替换为：

```ts
  const report = await boot(ctx, manifest, table, (name) => plugins.loadModule(name));
  plugins.bootBroken = report.broken;
  return ctx;
```

`src/styles.css` 末尾追加：

```css
/* 启动错误面板（boot-error.ts）：白屏的最小可见出口 */
.boot-error {
  max-width: 40em;
  margin: 4em auto;
  padding: 1em 1.5em;
  font: inherit;
}
.boot-error pre {
  white-space: pre-wrap;
  user-select: text;
}
```

- [ ] **Step 4: 跑测试确认绿**

Run: `pnpm test && pnpm build`
Expected: 全绿（既有 bootstrap 用例不动即绿——默认清单无 ext: 行）。

- [ ] **Step 5: Commit**

```bash
git add src/bootstrap.ts src/boot-error.ts src/main.ts src/styles.css tests/bootstrap.test.ts tests/boot-error.test.ts
git commit -m "bootstrap 接线外置装载 + 启动错误面板：白屏收口

PluginsService 进 ctx（第五服务），boot 的外置装载通道接通真实链路
（read_plugin_module → blob → import → 形状校验），坏行回填
plugins.bootBroken 供面板点名。bootstrap 拒绝时 #app 内联渲染错误与
清理指引，替代白屏——M1 收口，外置装载失败从此有可见出口。"
```

### Task 7: plugin-manager 内置插件（第六件：管理面板）

**Files:**
- Create: `src/plugins/plugin-manager/model.ts`（纯逻辑）
- Create: `src/plugins/plugin-manager/index.ts`（UI 接线）
- Modify: `src/loader/table.ts`（第六行）
- Modify: `src/styles.css`（面板样式）
- Create: `tests/plugin-manager.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `ctx.plugins`（PluginsService 全部方法 + `bootBroken`）、`ctx.slots.register("topbar.left", render)`。
- Produces: 内置插件 `plugin-manager`（name/inject/apply）；纯函数 `computePanelRows(manifest, entries, bootBroken): PanelRow[]`、`withEnabled(manifest, id, enabled): Manifest`、`withoutRow(manifest, id): Manifest`。

- [ ] **Step 1: 写失败测试**

`tests/plugin-manager.test.ts`：

```ts
// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { apply } from "../src/plugins/plugin-manager";
import { computePanelRows, withEnabled, withoutRow } from "../src/plugins/plugin-manager/model";
import type { Manifest } from "../src/loader/manifest";

const manifest = (rows: Array<[string, boolean]>): Manifest => ({
  plugins: rows.map(([id, enabled]) => ({ id, enabled, config: {} })),
});

test("model: 三源合一——boot 坏行优先，目录扫描 problem 次之，目录缺失兜底", () => {
  const m = manifest([["app-shell", true], ["ext:demo", true], ["ext:gone", false]]);
  const entries = [
    { name: "demo", version: "1.2.0", apiVersion: 1, entry: "index.js", problem: null },
    { name: "sick", version: null, apiVersion: null, entry: null, problem: "package.json 解析失败" },
  ];
  const rows = computePanelRows(m, entries, [{ id: "ext:demo", reason: "入口导出缺 apply" }]);
  expect(rows[0]).toEqual({ id: "app-shell", externalName: null, enabled: true, version: null, problem: null, removable: false });
  expect(rows[1]).toMatchObject({ externalName: "demo", version: "1.2.0", problem: "入口导出缺 apply", removable: true });
  expect(rows[2]).toMatchObject({ externalName: "gone", problem: "插件目录缺失", enabled: false, removable: true });
});

test("model: 开关与移除是纯变换", () => {
  const m = manifest([["a", true], ["ext:b", false]]);
  expect(withEnabled(m, "a", false).plugins[0].enabled).toBe(false);
  expect(withoutRow(m, "ext:b").plugins.map((r) => r.id)).toEqual(["a"]);
});

function fakePlugins() {
  const written: string[] = [];
  return {
    written,
    plugins: {
      readManifest: vi.fn(async () =>
        JSON.stringify(manifest([["app-shell", true], ["ext:demo", true]]))),
      list: vi.fn(async () => [
        { name: "demo", version: "1.0.0", apiVersion: 1, entry: "index.js", problem: null },
      ]),
      bootBroken: [] as Array<{ id: string; reason: string }>,
      writeManifest: vi.fn(async (m: Manifest) => {
        written.push(JSON.stringify(m));
      }),
      remove: vi.fn(async () => {}),
      install: vi.fn(async () => "demo"),
      importFromTgz: vi.fn(async () => null),
    },
  };
}

test("面板: 列行 + 开关写清单 + 移除走 ctx.plugins + 重启提示", async () => {
  const f = fakePlugins();
  const slots = {
    register: (_s: string, render: (el: HTMLElement) => void) => {
      render(document.body);
      return () => {};
    },
  };
  apply({ plugins: f.plugins, slots } as never, {});
  document.querySelector<HTMLButtonElement>("button")!.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(document.querySelector(".plugin-panel")).not.toBeNull();
  expect(document.querySelectorAll(".plugin-row").length).toBe(2);

  // 开关内置行：writeManifest 收到 enabled=false + 重启提示可见
  const toggle = document.querySelectorAll<HTMLInputElement>(".plugin-row input[type=checkbox]")[0];
  toggle.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(JSON.parse(f.written[0]).plugins[0].enabled).toBe(false);
  expect(document.querySelector<HTMLElement>(".plugin-restart-hint")!.hidden).toBe(false);

  // 移除外置行：remove + 清单过滤该行
  document.querySelectorAll<HTMLButtonElement>(".plugin-row button")[0].click();
  await new Promise((r) => setTimeout(r, 0));
  expect(f.plugins.remove).toHaveBeenCalledWith("demo");
  expect(JSON.parse(f.written.at(-1)!).plugins.map((r: { id: string }) => r.id)).toEqual(["app-shell"]);
});

test("面板: 安装失败内联显示错误（fail-loud 不静默）", async () => {
  const f = fakePlugins();
  f.plugins.install = vi.fn(async () => {
    throw new Error("查 registry demo-x 失败：404");
  });
  const slots = {
    register: (_s: string, render: (el: HTMLElement) => void) => {
      render(document.body);
      return () => {};
    },
  };
  apply({ plugins: f.plugins, slots } as never, {});
  document.querySelector<HTMLButtonElement>("button")!.click();
  await new Promise((r) => setTimeout(r, 0));
  const input = document.querySelector<HTMLInputElement>(".plugin-panel-head input")!;
  input.value = "demo-x";
  [...document.querySelectorAll<HTMLButtonElement>(".plugin-panel-head button")]
    .find((b) => b.textContent === "安装")!.click();
  await new Promise((r) => setTimeout(r, 0));
  const err = document.querySelector<HTMLElement>(".plugin-error");
  expect(err).not.toBeNull();
  expect(err!.textContent).toContain("demo-x");
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm test -- tests/plugin-manager.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

`src/plugins/plugin-manager/model.ts`：

```ts
import type { Manifest, ManifestRow } from "../../loader/manifest";
import type { BrokenRow, PluginEntry } from "../../host/plugins";

/** 面板单行：三源（manifest × 目录扫描 × boot 坏行）合一的纯投影。 */
export interface PanelRow {
  /** manifest 行 id（外置带 ext: 前缀）。 */
  id: string;
  /** 外置目录名（内置为 null）。 */
  externalName: string | null;
  /** manifest enabled。 */
  enabled: boolean;
  /** 版本（目录扫描带出；内置或未知为 null）。 */
  version: string | null;
  /** 待清理原因（boot 坏行 > 扫描 problem > 目录缺失）；null = 健康。 */
  problem: string | null;
  /** 可移除（仅外置）。 */
  removable: boolean;
}

/** 三源合一：manifest 供 id/enabled，目录扫描供版本与 problem，boot 坏行
 * 优先作 problem（装载失败的运行期事实最准）。纯函数，可测。 */
export function computePanelRows(
  manifest: Manifest,
  entries: PluginEntry[],
  bootBroken: BrokenRow[],
): PanelRow[] {
  const byName = new Map(entries.map((e) => [e.name, e]));
  const brokenById = new Map(bootBroken.map((b) => [b.id, b.reason]));
  return manifest.plugins.map((row: ManifestRow) => {
    if (row.id.startsWith("ext:")) {
      const name = row.id.slice(4);
      const entry = byName.get(name);
      return {
        id: row.id,
        externalName: name,
        enabled: row.enabled,
        version: entry?.version ?? null,
        problem: brokenById.get(row.id) ?? entry?.problem ?? (entry ? null : "插件目录缺失"),
        removable: true,
      };
    }
    return {
      id: row.id,
      externalName: null,
      enabled: row.enabled,
      version: null,
      problem: null,
      removable: false,
    };
  });
}

/** 开关一行 enabled 后的新清单（纯变换，落盘归调用方）。 */
export function withEnabled(manifest: Manifest, id: string, enabled: boolean): Manifest {
  return { plugins: manifest.plugins.map((row) => (row.id === id ? { ...row, enabled } : row)) };
}

/** 移除一行后的新清单（纯变换，落盘归调用方）。 */
export function withoutRow(manifest: Manifest, id: string): Manifest {
  return { plugins: manifest.plugins.filter((row) => row.id !== id) };
}
```

`src/plugins/plugin-manager/index.ts`：

```ts
import type { Context } from "cordis";
import type { Manifest } from "../../loader/manifest";
import { computePanelRows, withEnabled, withoutRow, type PanelRow } from "./model";

/** Plugin id in the manifest and the static module table. */
export const name = "plugin-manager";
/** Service keys awaited before apply runs. */
export const inject = ["plugins", "slots"];

/** 插件管理面板（第六内置插件）：顶栏"插件"按钮开合；列已装（内置+外置）、
 * 按名安装、本地导入、启用开关、外置移除；一切改动写清单后提示重启生效
 * （Phase 2 无热装载）。操作失败内联显示错误，不静默。
 * @param ctx Host context（plugins/slots injected）。
 * @returns Teardown removing the topbar button. */
export function apply(ctx: Context): () => void {
  return ctx.slots.register("topbar.left", (el) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "插件";
    btn.addEventListener("click", () => void openPanel(ctx));
    el.append(btn);
  });
}

/** 面板本体：固定覆盖层；每次操作后整体重渲染（状态简单，不值得细粒度更新）。 */
async function openPanel(ctx: Context): Promise<void> {
  document.querySelector(".plugin-panel")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "plugin-panel";
  const box = document.createElement("div");
  box.className = "plugin-panel-box";
  overlay.append(box);
  document.body.append(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  const showError = (e: unknown) => {
    const p = document.createElement("p");
    p.className = "plugin-error";
    p.textContent = `操作失败：${e instanceof Error ? e.message : String(e)}`;
    box.append(p);
  };
  const render = async () => {
    const raw = await ctx.plugins.readManifest();
    let manifest: Manifest;
    try {
      manifest = JSON.parse(raw ?? '{"plugins":[]}') as Manifest;
    } catch (e) {
      box.replaceChildren(errorLine(`清单读取失败：${(e as Error).message}`));
      return;
    }
    const entries = await ctx.plugins.list();
    const rows = computePanelRows(manifest, entries, ctx.plugins.bootBroken);
    const list = document.createElement("div");
    list.className = "plugin-list";
    for (const row of rows) list.append(rowEl(ctx, row, manifest, render, showError));
    const head = document.createElement("div");
    head.className = "plugin-panel-head";
    const installInput = document.createElement("input");
    installInput.placeholder = "包名或 包名@版本";
    head.append(
      installInput,
      button("安装", async () => {
        const spec = installInput.value.trim();
        if (!spec) return;
        try {
          await ctx.plugins.install(spec);
          hint.hidden = false;
        } catch (e) {
          showError(e);
        }
        await render();
      }),
      button("本地导入…", async () => {
        try {
          await ctx.plugins.importFromTgz();
          hint.hidden = false;
        } catch (e) {
          showError(e);
        }
        await render();
      }),
      button("关闭", close),
    );
    box.replaceChildren(head, list, hint);
  };
  const hint = document.createElement("p");
  hint.className = "plugin-restart-hint";
  hint.hidden = true;
  hint.textContent = "已保存——重启应用后生效。";
  await render();
}

/** 单行：名称/版本/问题 + 开关 + 外置移除；改动走纯变换后写回。 */
function rowEl(
  ctx: Context,
  row: PanelRow,
  manifest: Manifest,
  rerender: () => Promise<void>,
  showError: (e: unknown) => void,
): HTMLElement {
  const line = document.createElement("div");
  line.className = `plugin-row${row.problem ? " plugin-row-broken" : ""}`;
  const label = document.createElement("span");
  label.textContent = row.id + (row.version ? `（${row.version}）` : "");
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = row.enabled;
  toggle.addEventListener("change", async () => {
    try {
      await ctx.plugins.writeManifest(withEnabled(manifest, row.id, toggle.checked));
      showHint();
    } catch (e) {
      showError(e);
    }
    await rerender();
  });
  line.append(label, toggle);
  if (row.problem) {
    const problem = document.createElement("span");
    problem.className = "plugin-problem";
    problem.textContent = `待清理：${row.problem}`;
    line.append(problem);
  }
  if (row.removable && row.externalName) {
    line.append(
      button("移除", async () => {
        try {
          await ctx.plugins.remove(row.externalName!);
          await ctx.plugins.writeManifest(withoutRow(manifest, row.id));
          showHint();
        } catch (e) {
          showError(e);
        }
        await rerender();
      }),
    );
  }
  return line;
}

/** 显示"重启后生效"提示（面板重渲染后仍在）。 */
function showHint(): void {
  const hint = document.querySelector<HTMLElement>(".plugin-restart-hint");
  if (hint) hint.hidden = false;
}

/** 最小按钮工厂。 */
function button(text: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.addEventListener("click", () => void onClick());
  return b;
}

/** 错误行（面板内联显示，不白屏）。 */
function errorLine(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "plugin-error";
  p.textContent = text;
  return p;
}
```

`src/loader/table.ts`：import 区加 `import * as pluginManager from "../plugins/plugin-manager";`，`Object.assign` 块加一行：

```ts
  "plugin-manager": { plugin: pluginManager as PluginModule, defaults: {} },
```

`src/styles.css` 末尾追加：

```css
/* plugin-manager 面板 */
.plugin-panel {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 6em;
}
.plugin-panel-box {
  background: #fff;
  color: #1a1a1a;
  border-radius: 8px;
  padding: 1em 1.5em;
  min-width: 28em;
  max-height: 60vh;
  overflow: auto;
}
.plugin-panel-head {
  display: flex;
  gap: 0.5em;
  margin-bottom: 0.8em;
}
.plugin-panel-head input {
  flex: 1;
}
.plugin-row {
  display: flex;
  gap: 0.8em;
  align-items: baseline;
  padding: 0.15em 0;
}
.plugin-row .plugin-problem {
  color: #b00020;
}
.plugin-restart-hint {
  color: #8a6d3b;
}
.plugin-error {
  color: #b00020;
}
```

- [ ] **Step 4: 跑测试确认绿 + 门禁**

Run: `pnpm test && pnpm build && pnpm verify:layering`
Expected: 全绿（plugin-manager 只触 ctx.plugins/ctx.slots，无 @tauri-apps / ../host 值导入；`import type { Manifest }` 与 `import type { BrokenRow, PluginEntry }` 均为 type-only，扫描放行）。

- [ ] **Step 5: Commit**

```bash
git add src/plugins/plugin-manager src/loader/table.ts src/styles.css tests/plugin-manager.test.ts
git commit -m "plugin-manager 第六内置插件：最简管理面板

列已装（内置+外置）、按名安装、本地导入、启用开关、外置移除；面板
模型是三源（manifest × 目录扫描 × boot 坏行）合一的纯投影，问题行点名
待清理并可一键移除。一切改动写清单后提示重启生效——热装载留后续阶段，
重启换审计/清单一致性的最简正确形态。"
```

### Task 8: assetProtocol 收紧（配置 scope 收空 + 运行期动态授权）

**Files:**
- Modify: `src-tauri/tauri.conf.json`（scope `["**"]` → `[]`）
- Modify: `src-tauri/src/windows.rs`（registry `set_root` + `set_window_root` 命令 + create_window 授权）
- Modify: `src-tauri/src/lib.rs`（注册命令）
- Modify: `src/host/windows.ts`（`setRoot(label, root)`）
- Modify: `src/bootstrap.ts`（启动时对持久 root 重授权）
- Modify: `src/plugins/app-windows/index.ts`（打开文件夹走 windows.setRoot + workspace.setRoot）
- Modify: `tests/host-services.test.ts`、`tests/bootstrap.test.ts`、`tests/app-windows.test.ts`（桩链 + 新用例）
- Modify: `docs/commands.md` + `.en.md`（生成区）

**Interfaces:**
- Consumes: 无前置任务依赖（与 Task 1–7 并行安全，但按序执行避免合并冲突）。
- Produces: Tauri 命令 `set_window_root(label: String, root: Option<String>) -> Result<(), String>`（更新注册表 + `allow_directory(root, true)` 运行期授权，幂等）；TS `WindowsService.setRoot(label: string, root: string | null): Promise<void>`。

- [ ] **Step 1: 写失败测试**

`tests/host-services.test.ts` 追加：

```ts
test("windows: setRoot 透传 label+root（注册表更新 + asset 授权的命令面）", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const win = new WindowsService({ invoke, currentLabel: () => "main", onCloseRequested: vi.fn(), confirmDialog: vi.fn() });
  await win.setRoot("main", "/picked");
  expect(invoke).toHaveBeenCalledWith("set_window_root", { label: "main", root: "/picked" });
});
```

`tests/bootstrap.test.ts` 追加：

```ts
test("bootstrap: 持久 root 启动时重授权 asset scope（set_window_root）", async () => {
  const f = fakeEnv({});
  f.env.invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "read_manifest") return null;
    if (cmd === "write_manifest") { f.written.push(String(args?.json)); return null; }
    if (cmd === "get_window_state") return "/had-root";
    if (cmd === "set_window_root") return null;
    if (cmd === "read_tree") return [];
    throw new Error(`unexpected ${cmd}`);
  });
  const ctx = await bootstrap(f.env);
  expect(ctx.workspace.root).toBe("/had-root");
  expect(f.env.invoke).toHaveBeenCalledWith("set_window_root", { label: "main", root: "/had-root" });
});
```

`tests/app-windows.test.ts` 整文件替换（桩链增 setRoot/currentLabel）：

```ts
// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { apply } from "../src/plugins/app-windows";

test("DOM: 新建窗口传当前 root；打开文件夹走 pickFolder → windows.setRoot → workspace.setRoot", async () => {
  const created: Array<string | undefined> = [];
  const winSetRoot = vi.fn(async () => {});
  const windows = {
    create: vi.fn(async (root?: string) => { created.push(root); return "win-2"; }),
    currentLabel: () => "main",
    setRoot: winSetRoot,
  };
  const files = { pickFolder: vi.fn(async () => "/picked") };
  const workspace = { root: "/x", setRoot: vi.fn() };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ windows, files, workspace, slots } as never, {});
  const [newBtn, openBtn] = [...document.querySelectorAll<HTMLButtonElement>("button")];
  newBtn.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(created).toEqual(["/x"]);
  openBtn.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(files.pickFolder).toHaveBeenCalled();
  // Rust 侧先登记注册表并授权 asset，前端再切工作区（顺序：持久化优先）
  expect(winSetRoot).toHaveBeenCalledWith("main", "/picked");
  expect(workspace.setRoot).toHaveBeenCalledWith("/picked");
});
```

`src-tauri/src/windows.rs` 测试模块追加：

```rust
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
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm test -- tests/host-services.test.ts tests/bootstrap.test.ts tests/app-windows.test.ts && cd src-tauri && cargo test windows`
Expected: TS 三处 FAIL（setRoot 未实现 / set_window_root 未被调）；Rust FAIL（set_root 不存在）。

- [ ] **Step 3: 写实现**

`src-tauri/src/windows.rs`：

`WindowRegistry` 增方法（`remove` 之后）：

```rust
    /// 更新（或 upsert，主窗口首开文件夹场景）某窗口的工作区根。
    pub fn set_root(&mut self, label: &str, root: Option<String>) {
        self.roots.insert(label.to_string(), root);
    }
```

新命令（`get_window_state` 之后）：

```rust
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
```

`create_window` 改动——`register` 与 `WebviewWindowBuilder` 之间插入授权（失败回滚登记项，与 build 失败同形）：

```rust
    let label = state.lock().unwrap().register(root.clone());
    if let Some(root) = &root {
        if let Err(e) = app.asset_protocol_scope().allow_directory(root, true) {
            state.lock().unwrap().remove(&label);
            return Err(format!("授权 asset 访问 {root} 失败：{e}"));
        }
    }
```

`src-tauri/src/lib.rs` `invoke_handler` 加 `windows::set_window_root`（`windows::get_window_state` 之后）。

`src-tauri/tauri.conf.json`：`"scope": ["**"]` → `"scope": []`（`assetProtocol` 其余字段不动）。

`src/host/windows.ts`：`fetchRoot` 之后加方法：

```ts
  /** Persist this window's workspace root Rust-side (registry upsert + asset
   * scope grant, recursive). Idempotent; also called at boot to re-grant. */
  async setRoot(label: string, root: string | null): Promise<void> {
    await this.#deps.invoke("set_window_root", { label, root });
  }
```

`src/bootstrap.ts`：`workspace.setRoot(await windows.fetchRoot(windows.currentLabel()));` 替换为：

```ts
  // 持久 root 启动即重授权（配置 scope 已收空，运行期动态注入是唯一通道）。
  const label = windows.currentLabel();
  const root = await windows.fetchRoot(label);
  if (root !== null) await windows.setRoot(label, root);
  workspace.setRoot(root);
```

`src/plugins/app-windows/index.ts`："打开文件夹…" 的 click 处理替换为：

```ts
    openBtn.addEventListener("click", async () => {
      const root = await ctx.files.pickFolder();
      if (root) {
        // 先 Rust 侧登记注册表 + 授权 asset（刷新后 root 不丢），再切前端工作区。
        await ctx.windows.setRoot(ctx.windows.currentLabel(), root);
        ctx.workspace.setRoot(root);
      }
    });
```

- [ ] **Step 4: 跑测试确认绿 + fmt + 命令目录**

Run: `pnpm test && pnpm build && cd src-tauri && cargo fmt && cargo test`
Expected: 全绿。

Run: `pnpm gen:commands && pnpm record:i18n -- docs/commands.md`
Expected: 生成区新增 `set_window_root`。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/src/windows.rs src-tauri/src/lib.rs src/host/windows.ts src/bootstrap.ts src/plugins/app-windows/index.ts tests/host-services.test.ts tests/bootstrap.test.ts tests/app-windows.test.ts docs/commands.md docs/commands.en.md docs/commands.i18n.yaml
git commit -m "assetProtocol 收紧：配置 scope 收空，运行期动态授权

收掉 Phase 1 的 [\"**\"] 欠账：配置面不再预开任何目录，选中/建窗携带
root 时 Rust allow_directory（recursive）动态注入；启动时对持久 root
重授权（幂等）。顺带修一个潜在缺陷——主窗口\"打开文件夹\"现在回写注册表，
刷新/重载不再丢 root（此前仅前端状态，注册表是旧值）。"
```

### Task 9: 文档连锁 + Note 收口 + 全量门禁

**Files:**
- Modify: `docs/environment-independence.md` + `.en.md` + 重录（机械门禁条目、豁免转生效、欠账区更新）
- Modify: `docs/architecture.md` + `.en.md` + 重录（数据流、决策表）
- Modify: `scripts/code-map.manifest.json` → `pnpm gen:code-map`（生成区，两侧）
- Modify: `.agents/notes/proposed/architecture/2026-09-11-phase2-external-plugins.md` + `.en.md`（Decision 1 通道落定记录）→ `pnpm archive:note` 收口 implemented
- 不动：`AGENTS.md`（命令清单零新增——本阶段没有新脚本；分层与文档惯例措辞已覆盖新形态，词数预算不动）

**Interfaces:**
- Consumes: Task 1–8 的全部产物。
- Produces: 全量绿的门禁基线（PR 交付态）。

- [ ] **Step 1: environment-independence 三件套**

`docs/environment-independence.md`（`.en.md` 逐段对译同改）：

1. §约束定义 条款 5 的"（Phase 2 生效）"标签删除（Phase 2 已落地，标签过时）：

```
5. **外置插件**：用户主动安装的本地资源；安装可联网、仅限 registry tarball 直拉，运行全程离线；一律预打包零依赖单文件，宿主拒载其他形态。
```

2. §机械门禁 在 `verify:env-independence` 条目之后插入两条：

```
- `pnpm verify:dep-audit`（[scripts/verify-dep-audit.mjs](../scripts/verify-dep-audit.mjs)）：`dependencies` 白名单 diff——未登记包新增即红；传递闭包扫 `node:` 内建引用。
- `pnpm verify:layering`（[scripts/verify-layering.mjs](../scripts/verify-layering.mjs)）：`src/plugins/` 触达 `@tauri-apps/*` 或宿主实现即红（type-only 放行）；`src/` 动态 `import()` / `eval` / `new Function` 只许白名单单条缝（`src/loader/external.ts`，外置插件 blob 装载通道）。
```

3. §豁免登记 该行更新（预登转生效 + 依据指向 Phase 2 Note）：

```
| 外置插件安装联网（已生效） | 安装 = registry tarball 直拉，运行仍全程离线 | [.agents/notes/implemented/architecture/2026-09-11-phase2-external-plugins.md](../.agents/notes/implemented/architecture/2026-09-11-phase2-external-plugins.md) |
```

4. §已知欠账 整节替换为：

```
## 已知欠账

- linux 面的 ureq/rustls 链接扫描：纯 Rust 栈理论零新增 dylib（native-links 白名单覆盖系统 C 运行时），待首个真实 linux 发布验证。
```

- [ ] **Step 2: architecture 三件套（手写区）**

`docs/architecture.md`（`.en.md` 同步对译）：

1. §数据流 段落（"命令面权威清单…"之后那段）末尾追加：

```
外置插件——安装（plugin-manager → ctx.plugins.install → install_plugin：查元数据→拉 tarball→sha512→解包校验封闭契约→入插件目录，产品唯一联网动作）；装载（boot 对 ext: 行 → read_plugin_module → blob URL 动态 import（唯一装载缝 src/loader/external.ts）→ 支持集/形状校验 → 与静态表同流程激活；坏行分治跳过、面板点名待清理）；管理（面板改动写清单、重启生效，无热装载）。
```

2. §关键决策点 的 assetProtocol 条目替换为：

```
- **assetProtocol 配置 scope 为空，运行期动态授权**：选中/建窗/启动携带 root 时 Rust `allow_directory`（recursive）注入——视频与图片仍走 asset protocol，但配置面不再预开任意目录。
```

3. §关键决策点 末尾追加两条：

```
- **外置插件装载走 blob URL**：Rust 命令读入口源码 → JS Blob → 动态 import；单文件零依赖契约使 blob 的常见弱点（相对导入、URL 生命周期）归零，且通道可在 vitest 注入假 import 全链路测试；自定义协议 ESM 只能真实 webview 验证，留作备选（Phase 2 Note 决策 1 落定记录）。
- **npm 当仓库用、不当运行时用**：联网只发生在 Rust 安装命令（ureq+rustls 纯 Rust 栈），运行全程离线（[environment-independence.md](environment-independence.md) 豁免登记）。
```

§组成 是生成区——本任务 Step 3 处理。

- [ ] **Step 3: code-map 登记 + 重建生成区**

`scripts/code-map.manifest.json` 增改条目（新增 5 文件 + 4 条职责更新）：

```json
  "src/boot-error.ts": "启动错误面板：bootstrap 拒绝时向 #app 内联渲染错误与清理指引（白屏收口）",
  "src/host/plugins.ts": "插件包服务：安装/导入/列出/移除 + blob 装载通道取模块（apiVersion 支持集 + 形状校验）+ 清单读写（deps 可注入）",
  "src/loader/external.ts": "外置模块装载缝：全前端唯一动态 import 点（blob URL 通道，importFn 可注入测试）",
  "src/plugins/plugin-manager/index.ts": "plugin-manager 插件：顶栏按钮 + 管理面板（列装/安装/导入/开关/移除，改动写清单提示重启）",
  "src/plugins/plugin-manager/model.ts": "plugin-manager 纯函数：三源（manifest×目录扫描×boot 坏行）面板投影 + 开关/移除纯变换",
```

更新既有四条（职责变化）：

```json
  "src/bootstrap.ts": "每窗口启动流程：五宿主服务入 ctx + 清单迁移装载 + 插件激活 + 外置坏行回填（Tauri 绑定可注入）",
  "src/host/context.d.ts": "cordis Context 声明合并：files/windows/workspace/slots/plugins 五服务类型挂入",
  "src/loader/boot.ts": "装载器：内置行 fail-loud + ext: 行分治坏行（BootReport），全树激活审计",
  "src-tauri/src/windows.rs": "窗口注册表（label→root，upsert）+ create/get/set 窗口命令 + asset 运行期授权 + plugins.json 清单 IO",
```

（`src/plugins.rs` 若 Task 1 未登记则补：`"src-tauri/src/plugins.rs": "插件目录命令面：封闭契约解析 + 扫描/读入口/删目录 + 安装管线（registry 直拉/sha512/tgz 校验/原子落盘）"`。）

Run: `pnpm gen:code-map && pnpm gen:commands && pnpm record:i18n -- docs/architecture.md && pnpm record:i18n -- docs/environment-independence.md && pnpm record:i18n -- docs/commands.md`
Expected: 两侧生成区一致，配对重录通过。

- [ ] **Step 4: Note 通道落定 + 收口 implemented**

`.agents/notes/proposed/architecture/2026-09-11-phase2-external-plugins.md` Decision 第 1 条末尾追加（英文侧对译）：

```
**落定（2026-09-11）**：通道取 blob URL——单文件零依赖契约使 blob 的弱点（相对导入解析、URL 生命周期）归零，且通道可在 vitest/Node 下注入假 import 全链路测试；自定义协议的 ESM 装载只能真实 webview 验证，作为预许备选保留。CSP `script-src` 增 `blob:`，未开任何 connect-src。技术验证任务被此裁定吸收（两候选均预许形态，裁定只决定取哪个）。
```

随后收口（顺序：先改内容再归档，归档冻结）：

```sh
pnpm record:i18n -- .agents/notes/proposed/architecture/2026-09-11-phase2-external-plugins.md
pnpm archive:note -- .agents/notes/proposed/architecture/2026-09-11-phase2-external-plugins.md
```

Expected: Note 移入 `implemented/`，Status 与目录一致（门禁校验）；豁免表 Step 1 的链接指向随之有效。

- [ ] **Step 5: 全量门禁**

```sh
pnpm test && pnpm build && pnpm verify:dep-audit && pnpm verify:layering && pnpm verify:env-independence && pnpm verify:commands && pnpm verify:docs
cd src-tauri && cargo test && cd ..
pnpm route:gates --base multi-window-file-tree   # 改动面对账（建议组应全部被本轮覆盖）
```

Expected: 全绿。release 档（重，PR 前跑一次）：

```sh
pnpm tauri build && pnpm verify:release
```

Expected: 构建通过；native-links 扫描无新增系统 dylib（ureq/rustls 纯 Rust 栈的机械背书；linux 面留欠账登记）。

- [ ] **Step 6: Commit**

```bash
git add docs/environment-independence.md docs/environment-independence.en.md docs/architecture.md docs/architecture.en.md scripts/code-map.manifest.json .agents/notes
git commit -m "文档连锁收口：豁免转生效、门禁条目入 home、Note 转 implemented

唯一 home 补 dep-audit/layering 机械门禁条目（M2），\"外置插件安装联网\"
豁免从预登转生效；欠账区三清（assetProtocol/通道验证/清单迁移）换一条
linux 链接扫描预期欠账。architecture 数据流与决策表记 blob 通道落定理由；
Phase 2 Note 带 Decision 1 落定记录转 implemented。AGENTS.md 零改动——
命令清单无新增，词数预算不动。"
```

---

## 全链路手工验收清单（PR 描述随附，用户检视时走一遍）

前置：`pnpm tauri dev`。造一个测试插件 tgz：

```sh
mkdir -p package
cat > package/package.json <<'JSON'
{"name":"demo-hello","version":"1.0.0","keywords":["studywiki-plugin"],"dependencies":{},"studywiki":{"apiVersion":1,"entry":"index.js"}}
JSON
cat > package/index.js <<'JS'
export const name = "demo-hello";
export const inject = ["slots"];
export function apply(ctx) {
  return ctx.slots.register("topbar.left", (el) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "hello";
    el.append(b);
  });
}
JS
tar czf demo-hello.tgz package
```

1. **面板与导入**：顶栏出现"插件"按钮 → 面板列 6 个内置（plugin-manager 迁移自动出现）→ "本地导入…"选 `demo-hello.tgz` → 提示重启 → 重启后顶栏出现 "hello" 按钮（外置插件激活，清单行 `ext:demo-hello`）。
2. **registry 红路径**：面板安装输入 `this-package-does-not-exist-sw` → 内联显示错误（点名 404/查 registry 失败），应用不崩。
3. **禁用/移除**：关掉 doc-video → 重启 → md 正常、视频入口消失；移除 demo-hello → 重启 → 待清理与 hello 按钮均消失。
4. **坏目录分治**：手动删除配置目录 `plugins/demo-hello/`（保留清单行）→ 重启 → 应用正常起，面板该行标"待清理：…目录缺失"，一键移除干净。
5. **离线不变**：断网状态下正常打开/编辑/预览/播放（运行期零网络）；断网安装 → 内联报错。
6. **asset 授权链**：打开含视频的文件夹 → 视频正常播放（动态授权生效）；新建窗口携带 root → 同样正常。
7. **启动错误面板**：配置目录 plugins.json 写坏 JSON → 启动显示错误面板而非白屏。
8. **存量迁移**：手工删清单里 plugin-manager 行 → 重启 → 行自动补回且 enabled。

## 执行注意

- 任务顺序 1→9；Task 3 与 Task 1/2 无依赖可在等待间隙并行派发，但提交落同一个分支、按任务独立提交。
- `pnpm test` 是门禁自测试 + 应用测试的总和；任何既有用例的红都不是"测试问题"，先怀疑实现（测试即契约，本计划明列的桩链更新除外）。
- 蓝本代码均以 2026-09-11 分支 `phase2-external-plugins`（基点 797c658）现状为准推导；执行中发现签名漂移（尤其 `asset_protocol_scope` 的 Tauri 小版本形态），以编译器/文档为准微调调用形态，语义不变即不算偏离计划。
- Rust 测试 fixture 均落 `std::env::temp_dir()`（线程 id 隔离，测后自清），不碰仓库工作树。
