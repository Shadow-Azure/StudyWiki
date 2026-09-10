# Phase 1 插件化架构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 StudyWiki 重构为 vendored cordis 插件架构，交付 Phase 1 全部功能：多窗口、文件夹文件树（展开/折叠）、markdown 编辑（CodeMirror 6）/预览切换、视频查看，以及配套门禁与文档连锁。

**Architecture:** 取 cordis v4 契约弃 Node 装载器：插件 = `name`/`inject`/`apply`，宿主服务层（files/windows/workspace/slots）是前端唯一有权 import `@tauri-apps/*` 的层，装载器按 JSON 清单从静态模块表组装并 fail-loud 审计。Rust 壳是全局单例权威（文件命令 + 窗口注册表 + 事件总线），每 webview 一棵独立 cordis 树。

**Tech Stack:** Tauri 2（Rust 壳 + 系统 webview）、TypeScript + Vite（无 UI 框架，原生 DOM）、vendored cordis v4.0.0-rc.10（自有 fork 源码收编）、CodeMirror 6（`@codemirror/state|view|commands|language|lang-markdown`）、markdown-it（沿用）、vitest + cargo test。

**Spec:** `.agents/notes/proposed/architecture/2026-09-10-plugin-architecture.md`（已获批的 proposed Note；本计划的一切"为什么"以它为准，执行者两份都读）。

## Global Constraints

- 环境无关硬约束：`dependencies` 只进白名单登记过的包；`src/` 禁止任何动态 `import()`、`eval(`、`new Function(`；CSP 与 asset protocol 配置本阶段不动。
- 分层纪律：`src/plugins/**` 禁止 import `@tauri-apps/*` 与 `../host` 的值导入（`import type` 放行）；宿主能力只经 `ctx.files` / `ctx.windows` / `ctx.workspace` / `ctx.slots`。
- vendored cordis/cosmokit 不进 `package.json` 依赖；`vendor/` 不受 src 级扫描约束。
- 提交信息用中文，正文说明动机；每个任务独立提交。
- 生成区不手编：改 `lib.rs` 命令后跑 `pnpm gen:commands`；改源文件结构后在 `scripts/code-map.manifest.json` 登记并跑 `pnpm gen:code-map`（两脚本同时写 `.md` 与 `.en.md` 两侧）。
- 常驻文档改动 = 中英三件套一起动 + `pnpm record:i18n` 重录；本计划文件位于 `plans/`（语料之外），无三件套义务。
- 本地 git 钩子只查尾随空白（pre-commit）与 doc-quick（pre-push）；中间提交不跑门禁，全量校验收敛在 Task 15/16。

---

### Task 1: Vendor cordis + cosmokit，构建接线，API 冒烟测试

**Files:**
- Create: `vendor/cordis/src/*`（复制自 `~/2026/cordis/packages/core/src`）、`vendor/cordis/package.json`
- Create: `vendor/cosmokit/lib/*`、`vendor/cosmokit/package.json`
- Create: `vendor/VENDORED.md`
- Modify: `tsconfig.json`、`vite.config.ts`、`package.json`（devDependencies）
- Test: `tests/cordis-smoke.test.ts`

**Interfaces:**
- Consumes: 无（地基任务）。
- Produces: 裸说明符 `cordis` 与 `cosmokit` 在 tsc 与 Vite（含 vitest）下可解析；`Context`、`FiberState` 可从 `"cordis"` import。后续所有任务依赖这一点。

- [ ] **Step 1: 复制 cordis core 源码并登记来源**

```bash
mkdir -p vendor/cordis
cp -R ~/2026/cordis/packages/core/src vendor/cordis/src
cp ~/2026/cordis/packages/core/package.json vendor/cordis/package.json
git -C ~/2026/cordis rev-parse HEAD
```

用上一步输出的 commit 哈希写 `vendor/VENDORED.md`：

```markdown
# Vendored 上游登记

| 包 | 来源 | 版本 | 上游 commit | 收编日期 | 本地改动 |
|---|---|---|---|---|---|
| cordis | github.com/Shadow-Azure/cordis（fork of cordiverse/cordis）packages/core | 4.0.0-rc.10 | <Step1 哈希> | 2026-09-11 | 无 |
| cosmokit | npm registry tarball | 1.8.1 | npm pack sha256 见下 | 2026-09-11 | 无 |

规则：升级 = 手动 diff + 在本表登记改动；`src/` 级扫描规则覆盖 vendor 源码（零 node: 引用由 Task 1 冒烟与门禁共同看住）。
```

- [ ] **Step 2: 收编 cosmokit（cordis 唯一运行时依赖）**

```bash
cd "$(mktemp -d)" && npm pack cosmokit@1.8.1 && tar xzf cosmokit-1.8.1.tgz
shasum -a 256 package/lib/index.js   # 记入 VENDORED.md 的 sha256 处
cd <仓库根>
mkdir -p vendor/cosmokit
cp -R <临时目录>/package/lib vendor/cosmokit/lib
cp <临时目录>/package/package.json vendor/cosmokit/package.json
```

- [ ] **Step 3: 类型与构建接线**

`tsconfig.json` 的 `compilerOptions` 增补：

```json
"paths": {
  "cordis": ["./vendor/cordis/src/index.ts"],
  "cosmokit": ["./vendor/cosmokit/lib/index.d.ts"]
}
```

`vite.config.ts` 增补（vitest 复用同一配置，测试同样生效）：

```ts
import path from "node:path";
// export default defineConfig({ ... 既有字段, 新增:
  resolve: {
    alias: {
      cordis: path.resolve(__dirname, "vendor/cordis/src/index.ts"),
      cosmokit: path.resolve(__dirname, "vendor/cosmokit/lib/index.js"),
    },
  },
```

devDependencies 补 vendored 源码的类型引用：`pnpm add -D @standard-schema/spec`（纯类型包，不进产物）。

- [ ] **Step 4: 写失败冒烟测试（同时钉死 cordis API 用法）**

`tests/cordis-smoke.test.ts`：

```ts
import { Context, FiberState } from "cordis";

test("vendored cordis: provide 使服务占 ctx.<key>，inject 插件激活为 ACTIVE", async () => {
  const ctx = new Context();
  const service = { value: 42 };
  ctx.reflect.provide("answer", service);
  expect((ctx as any).answer).toBe(service);

  let seen = 0;
  const plugin = {
    name: "probe",
    inject: ["answer"],
    apply(c: any) {
      seen = c.answer.value;
      return () => {}; // 可逆副作用：清理函数
    },
  };
  const fiber = ctx.plugin(plugin, {});
  await new Promise((r) => setTimeout(r, 20)); // fiber 异步激活
  expect(seen).toBe(42);
  expect(fiber.state).toBe(FiberState.ACTIVE);
});

test("vendored cordis: 注入缺失时 fiber 停在非 ACTIVE", async () => {
  const ctx = new Context();
  const plugin = { name: "orphan", inject: ["missing"], apply() {} };
  const fiber = ctx.plugin(plugin, {});
  await new Promise((r) => setTimeout(r, 20));
  expect(fiber.state).not.toBe(FiberState.ACTIVE);
});
```

- [ ] **Step 5: 跑测试校准**

Run: `pnpm test -- cordis-smoke`
Expected: PASS。**若 import 名或签名与 vendored 源码不符（rc 线可能微调），以 `vendor/cordis/src/*.ts` 实际导出为准修正测试与本计划后续任务的调用方式**——本任务的目的就是把 API 用法钉死在测试里，这是唯一允许的校准点。

- [ ] **Step 6: 构建验证**

Run: `pnpm build`
Expected: tsc + vite build 通过（vendored 源码进 bundle）。

- [ ] **Step 7: Commit**

```bash
git add vendor/ tsconfig.json vite.config.ts package.json pnpm-lock.yaml tests/cordis-smoke.test.ts
git commit -m "vendor cordis v4.0.0-rc.10 + cosmokit 1.8.1（构建接线 + API 冒烟）

插件化 Phase 1 地基：cordis 从自有 fork 收编、cosmokit 从 npm tarball 收编，
tsconfig paths + vite alias 双接线，冒烟测试钉死 provide/inject/fiber 用法。"
```

---

### Task 2: Rust 文件命令面：read_tree / write_text_file + fs://changed，退役 list_library

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `docs/commands.md`、`docs/commands.en.md`（生成区，跑 `pnpm gen:commands`）

**Interfaces:**
- Consumes: 无。
- Produces（后续 Task 4/7 依赖的命令签名，camelCase 参数由 Tauri 自动转换）:
  - `read_tree(root: String) -> Result<Vec<FileNode>, String>`；`FileNode { name, path, kind: "dir"|"markdown"|"video"|"other", children: Option<Vec<FileNode>> }`（serde camelCase）
  - `write_text_file(path: String, contents: String) -> Result<(), String>`；成功落盘后向全部窗口广播事件 `fs://changed`，payload 为文件路径字符串
  - `list_library` 与 `LibraryEntry` 删除

- [ ] **Step 1: 写失败测试（fixture 树）**

在 `lib.rs` 的 `#[cfg(test)] mod tests` 中追加：

```rust
fn fixture_tree() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("sw-test-{}", std::process::id()));
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
    assert_eq!(children.len(), 2); // notes.txt 非可打开类型仍列出，kind=other
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test`
Expected: FAIL——`walk_dir` / `std_write` 未定义。

- [ ] **Step 3: 实现**

`lib.rs` 中（替换原 `LibraryEntry` 与 `list_library`；保留 `MARKDOWN_EXTS`/`VIDEO_EXTS`/`kind_for_ext` 及其测试）：

```rust
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

fn kind_of(path: &Path) -> String {
    if path.is_dir() { return "dir".into(); }
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase());
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
    out.sort_by(|a, b| (a.kind != "dir", a.name.to_lowercase()).cmp(&(b.kind != "dir", b.name.to_lowercase())));
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
    app.emit("fs://changed", &path).map_err(|e| format!("emit: {e}"))
}
```

`invoke_handler` 改为 `tauri::generate_handler![read_tree, read_text_file, write_text_file]`；删除 `LibraryEntry` 结构体与 `list_library`。

- [ ] **Step 4: 跑测试通过 + 命令目录重生成**

Run: `cd src-tauri && cargo test` → PASS；`cargo fmt`。
Run: `pnpm gen:commands`
Expected: `docs/commands.md` 与 `.en.md` 生成区更新为三条命令。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs docs/commands.md docs/commands.en.md
git commit -m "Rust 文件面：read_tree 递归树 + write_text_file 落盘广播 fs://changed

list_library 退役：文件树需要目录递归与展开折叠，平铺清单不够用；
写文件是编辑器的保存通道，广播事件供跨窗口树刷新。"
```

---

### Task 3: Rust 窗口注册表 + manifest IO 命令

**Files:**
- Create: `src-tauri/src/windows.rs`
- Modify: `src-tauri/src/lib.rs`（mod + manage + on_window_event + handler 注册）
- Modify: `docs/commands.md`、`docs/commands.en.md`（gen:commands）

**Interfaces:**
- Consumes: 无。
- Produces:
  - `create_window(root: Option<String>) -> Result<String, String>`：生成 label（`win-N`）、登记注册表、创建同 bundle 的 WebviewWindow，返回 label
  - `get_window_state(label: String) -> Option<String>`：注册表查询（root 或 null）
  - `read_manifest() -> Option<String>`：读 app 配置目录 `plugins.json`，不存在返回 None
  - `write_manifest(json: String) -> Result<(), String>`：原子写（tmp + rename）同路径
  - 窗口销毁时广播 `win://closed`（payload 为 label）并清理注册表

- [ ] **Step 1: 写失败测试（注册表纯逻辑）**

`src-tauri/src/windows.rs`：

```rust
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
        assert_eq!(reg.get("win-2"), Some("/tmp/x".into()));
        reg.remove("win-2");
        assert_eq!(reg.get("win-2"), None);
    }
}
```

Run: `cd src-tauri && cargo test`
Expected: FAIL——`WindowRegistry` 未定义。

- [ ] **Step 2: 实现 windows.rs**

```rust
use std::collections::HashMap;
use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

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
pub fn create_window(app: AppHandle, state: tauri::State<'_, Mutex<WindowRegistry>>, root: Option<String>) -> Result<String, String> {
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
pub fn get_window_state(state: tauri::State<'_, Mutex<WindowRegistry>>, label: String) -> Option<Option<String>> {
    state.lock().unwrap().get(&label)
}

/// 读插件清单（app 配置目录 plugins.json）；不存在返回 None，由前端生成默认。
#[tauri::command]
pub fn read_manifest(app: AppHandle) -> Result<Option<String>, String> {
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("plugins.json");
    fs::read_to_string(&path).map(Some).or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Ok(None) } else { Err(format!("read {}: {e}", path.display())) })
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
```

- [ ] **Step 3: lib.rs 接线**

```rust
mod windows;

// run() 内 Builder 增补：
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
        read_tree, read_text_file, write_text_file,
        windows::create_window, windows::get_window_state, windows::read_manifest, windows::write_manifest
    ])
```

- [ ] **Step 4: 测试 + 生成 + 提交**

Run: `cd src-tauri && cargo test` → PASS；`cargo fmt`；`pnpm gen:commands`。

```bash
git add src-tauri/src/ docs/commands.md docs/commands.en.md
git commit -m "Rust 窗口注册表 + manifest IO：label→root 权威、win://closed、原子清单

多窗口的根基：窗口由 Rust 创建，root 的唯一权威在注册表（重载不丢）；
插件清单落 app 配置目录，读写都走命令，前端不碰文件路径。"
```

---

### Task 4: 宿主服务 files / windows（可注入依赖）

**Files:**
- Create: `src/host/emitter.ts`、`src/host/files.ts`、`src/host/windows.ts`
- Modify: `src/types.ts`（`LibraryEntry` → `FileNode`；architecture.md 的 type-equiv 围栏到 Task 16 才同步，期间 doc-sync 会红，属计划内的最终收口）
- Test: `tests/host-services.test.ts`

**Interfaces:**
- Consumes: Task 2/3 的 Rust 命令签名。
- Produces（后续所有插件与 bootstrap 依赖）:
  - `createEmitter<M>(): Emitter<M>`，`Emitter.on(key, fn) → 反订阅`、`emit(key, payload)`
  - `FilesService`：`readTree(root) / readText(path) / writeText(path, contents) / pickFolder() / assetUrl(path) / start() / stop() / onFsChanged(fn)`
  - `WindowsService`：`currentLabel() / create(root?) / fetchRoot(label) / confirmDialog(message) / guardClose(isDirty, confirmDiscard)`
  - `FileNode`（types.ts）：`{ name; path; kind: "dir"|"markdown"|"video"|"other"; children? }`
  - 两个服务构造函数都收 deps 参数（默认真实 Tauri 绑定），测试注入假实现——这是全前端唯一 mock 点。

- [ ] **Step 1: 写失败测试**

`tests/host-services.test.ts`：

```ts
import { expect, test, vi } from "vitest";
import { createEmitter } from "../src/host/emitter";
import { FilesService } from "../src/host/files";
import { WindowsService } from "../src/host/windows";

test("emitter: 订阅/触发/退订", () => {
  const e = createEmitter<{ ch: number }>();
  const seen: number[] = [];
  const off = e.on("ch", (p) => seen.push(p));
  e.emit("ch", 1); off(); e.emit("ch", 2);
  expect(seen).toEqual([1]);
});

test("files: readTree 透传参数、返回结果", async () => {
  const invoke = vi.fn().mockResolvedValue([{ name: "a.md", path: "/x/a.md", kind: "markdown" }]);
  const files = new FilesService({ invoke, listen: vi.fn(), openDialog: vi.fn(), assetUrl: (p) => `a:${p}` });
  await expect(files.readTree("/x")).resolves.toEqual([{ name: "a.md", path: "/x/a.md", kind: "markdown" }]);
  expect(invoke).toHaveBeenCalledWith("read_tree", { root: "/x" });
});

test("files: 命令错误原样上抛", async () => {
  const invoke = vi.fn().mockRejectedValue(new Error("boom"));
  const files = new FilesService({ invoke, listen: vi.fn(), openDialog: vi.fn(), assetUrl: (p) => p });
  await expect(files.writeText("/x/a", "t")).rejects.toThrow("boom");
});

test("files: fs://changed 桥接为 onFsChanged", async () => {
  let bridge!: (e: { payload: unknown }) => void;
  const listen = vi.fn(async (_e: string, cb: (e: { payload: unknown }) => void) => { bridge = cb; return () => {}; });
  const files = new FilesService({ invoke: vi.fn(), listen, openDialog: vi.fn(), assetUrl: (p) => p });
  await files.start();
  const seen: string[] = [];
  files.onFsChanged((p) => seen.push(p));
  bridge({ payload: "/x/a.md" });
  expect(seen).toEqual(["/x/a.md"]);
});

test("windows: fetchRoot 对 null 状态安全；confirmDialog 透传", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const confirmDialog = vi.fn().mockResolvedValue(true);
  const win = new WindowsService({ invoke, currentLabel: () => "main", onCloseRequested: vi.fn(), confirmDialog });
  await expect(win.fetchRoot("main")).resolves.toBeNull();
  expect(invoke).toHaveBeenCalledWith("get_window_state", { label: "main" });
  await expect(win.confirmDialog("放弃修改？")).resolves.toBe(true);
  expect(confirmDialog).toHaveBeenCalledWith("放弃修改？");
});
```

Run: `pnpm test -- host-services` → FAIL（模块不存在）。

- [ ] **Step 2: 实现**

`src/types.ts` 整体替换为：

```ts
/** One node of the opened library's file tree. */
export type FileNode = {
  /** File or directory name including extension. */
  name: string;
  /** Absolute path — used for reads/writes and asset-protocol URLs. */
  path: string;
  /** Dispatches handling: directories expand; markdown/video open; other lists only. */
  kind: "dir" | "markdown" | "video" | "other";
  /** Present only for directories. */
  children?: FileNode[];
};
```

`src/host/emitter.ts`：

```ts
/** Payload map constraint for {@link createEmitter}. */
export type PayloadMap = Record<string, unknown>;

/** Minimal typed emitter: on returns an unsubscriber. */
export interface Emitter<M extends PayloadMap> {
  on<K extends keyof M & string>(key: K, fn: (payload: M[K]) => void): () => void;
  emit<K extends keyof M & string>(key: K, payload: M[K]): void;
}

/** Framework-free emitter used by host services to expose change streams. */
export function createEmitter<M extends PayloadMap>(): Emitter<M> {
  const map = new Map<string, Set<(p: unknown) => void>>();
  return {
    on(key, fn) {
      const set = map.get(key) ?? new Set();
      set.add(fn as (p: unknown) => void);
      map.set(key, set);
      return () => set.delete(fn as (p: unknown) => void);
    },
    emit(key, payload) {
      for (const fn of map.get(key) ?? []) fn(payload);
    },
  };
}
```

`src/host/files.ts`：

```ts
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { createEmitter } from "./emitter";
import type { FileNode } from "../types";

/** Tauri bindings this service wraps; injectable so tests fake exactly one seam. */
export interface FilesDeps {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  listen: (event: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;
  openDialog: () => Promise<string | null>;
  assetUrl: (path: string) => string;
}

/** Real Tauri bindings (the only sanctioned import site for these). */
export const defaultFilesDeps: FilesDeps = {
  invoke,
  listen,
  openDialog: () => open({ directory: true, multiple: false }) as Promise<string | null>,
  assetUrl: convertFileSrc,
};

/** Window-scoped service: the only file channel plugins may use. */
export class FilesService {
  readonly #deps: FilesDeps;
  readonly #events = createEmitter<{ "fs-changed": string }>();
  #unlisten: (() => void) | null = null;

  constructor(deps: FilesDeps = defaultFilesDeps) {
    this.#deps = deps;
  }

  /** Bridge Rust `fs://changed` broadcasts into this window. */
  async start(): Promise<void> {
    this.#unlisten = await this.#deps.listen("fs://changed", (e) =>
      this.#events.emit("fs-changed", String(e.payload)));
  }

  /** Stop bridging (window teardown). */
  stop(): void {
    this.#unlisten?.();
    this.#unlisten = null;
  }

  /** Full recursive tree of an opened root. */
  readTree(root: string): Promise<FileNode[]> {
    return this.#deps.invoke("read_tree", { root }) as Promise<FileNode[]>;
  }

  /** Whole-file UTF-8 read — the document data source. */
  readText(path: string): Promise<string> {
    return this.#deps.invoke("read_text_file", { path }) as Promise<string>;
  }

  /** Whole-file write; Rust broadcasts the change (including back to us). */
  writeText(path: string, contents: string): Promise<void> {
    return this.#deps.invoke("write_text_file", { path, contents }) as Promise<void>;
  }

  /** System folder picker; null when cancelled. */
  pickFolder(): Promise<string | null> {
    return this.#deps.openDialog();
  }

  /** Asset-protocol URL for local media playback. */
  assetUrl(path: string): string {
    return this.#deps.assetUrl(path);
  }

  /** Fired with the changed file path on every fs://changed broadcast. */
  onFsChanged(fn: (path: string) => void): () => void {
    return this.#events.on("fs-changed", fn);
  }
}
```

`src/host/windows.ts`：

```ts
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/** Tauri bindings this service wraps; injectable for tests. */
export interface WindowsDeps {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  currentLabel: () => string;
  onCloseRequested: (cb: (e: { preventDefault(): void }) => void) => Promise<() => void>;
  confirmDialog: (message: string) => Promise<boolean>;
}

/** Real Tauri bindings. */
export const defaultWindowsDeps: WindowsDeps = {
  invoke,
  currentLabel: () => getCurrentWebviewWindow().label,
  onCloseRequested: (cb) => getCurrentWebviewWindow().onCloseRequested(cb),
  confirmDialog: (message) => confirm(message, { title: "StudyWiki" }),
};

/** Window-scoped service: window identity, creation, close guarding. */
export class WindowsService {
  readonly #deps: WindowsDeps;

  constructor(deps: WindowsDeps = defaultWindowsDeps) {
    this.#deps = deps;
  }

  /** This window's Tauri label. */
  currentLabel(): string {
    return this.#deps.currentLabel();
  }

  /** Create a new window, optionally opening `root`; returns the new label. */
  async create(root?: string): Promise<string> {
    return this.#deps.invoke("create_window", { root }) as Promise<string>;
  }

  /** Fetch this window's registered workspace root (null = welcome state). */
  async fetchRoot(label: string): Promise<string | null> {
    const state = await this.#deps.invoke("get_window_state", { label });
    return (state as string | null) ?? null;
  }

  /** Native confirm dialog (close-guard prompt); true = proceed. */
  confirmDialog(message: string): Promise<boolean> {
    return this.#deps.confirmDialog(message);
  }

  /** Intercept close while `isDirty()` holds; `confirmDiscard` resolves true
   * to close anyway (discarding), false to cancel the close. */
  async guardClose(isDirty: () => boolean, confirmDiscard: () => Promise<boolean>): Promise<() => void> {
    return this.#deps.onCloseRequested(async (e) => {
      if (isDirty() && !(await confirmDiscard())) e.preventDefault();
    });
  }
}
```

- [ ] **Step 3: 跑测试通过** — Run: `pnpm test -- host-services` → PASS。

- [ ] **Step 4: Commit**

```bash
git add src/host/ src/types.ts tests/host-services.test.ts
git commit -m "宿主服务 files/windows：Tauri 绑定的可注入薄封装

插件只经 ctx.files/ctx.windows 触达系统能力（分层纪律的物理层）；
deps 注入是全前端唯一 mock 点，透传与错误上抛由测试锁死。"
```

---

### Task 5: 宿主服务 workspace / slots

**Files:**
- Create: `src/host/workspace.ts`、`src/host/slots.ts`、`src/host/context.d.ts`
- Test: `tests/host-workspace-slots.test.ts`

**Interfaces:**
- Consumes: `FileNode`（Task 4）、`createEmitter`（Task 4）、`FilesService`/`WindowsService`（Task 4）。
- Produces:
  - `WorkspaceService`：`root`、`activeFile`、`setRoot(root|null)`、`openFile(file)`、`events: Emitter<{ "root-changed": string|null; "file-opened": FileNode|null }>`
  - `SlotsService`：`register(slot, renderer) → 反订阅`、`mount(slot, container)`；`SlotName = "topbar.left" | "sidebar.tree" | "main.viewer"`
  - `src/host/context.d.ts`：对 `cordis` 的 `Context` 接口做声明合并，补上 `files`/`windows`/`workspace`/`slots` 四个属性的类型——此后插件里 `ctx.files.xxx` 直接过 tsc（没有它，Task 7 起的插件代码全部编译失败）

- [ ] **Step 1: 写失败测试**

`tests/host-workspace-slots.test.ts`（文件头需 DOM 环境）：

```ts
// @vitest-environment jsdom
import { expect, test } from "vitest";
import { WorkspaceService } from "../src/host/workspace";
import { SlotsService } from "../src/host/slots";
import type { FileNode } from "../src/types";

const md = (name: string): FileNode => ({ name, path: `/x/${name}`, kind: "markdown" });

test("workspace: setRoot 清空 activeFile 并广播两个事件", () => {
  const ws = new WorkspaceService();
  const events: string[] = [];
  ws.events.on("root-changed", (r) => events.push(`root:${r}`));
  ws.events.on("file-opened", (f) => events.push(`file:${f?.name ?? "-"}`));
  ws.openFile(md("a.md"));
  ws.setRoot("/y");
  expect(ws.root).toBe("/y");
  expect(ws.activeFile).toBeNull();
  expect(events).toEqual(["file:a.md", "root:/y", "file:-"]);
});

test("slots: 按注册顺序渲染、反订阅移除、mount 重绑清容器", () => {
  const slots = new SlotsService();
  const order: string[] = [];
  const off = slots.register("main.viewer", (el) => { order.push(`a:${el.tagName}`); });
  slots.register("main.viewer", () => order.push("b"));
  const container = document.createElement("div");
  const probe = document.createElement("span");
  container.appendChild(probe);
  slots.mount("main.viewer", container);
  expect(order).toEqual(["a:DIV", "b"]);
  expect(container.contains(probe)).toBe(false); // mount 重置容器
  off();
  expect(container.querySelectorAll(".slot").length).toBe(1);
});
```

Run: `pnpm test -- host-workspace-slots` → FAIL。

- [ ] **Step 2: 实现**

`src/host/workspace.ts`：

```ts
import type { FileNode } from "../types";
import { createEmitter, type Emitter } from "./emitter";

/** Change events emitted by the workspace. */
export type WorkspaceEvents = {
  "root-changed": string | null;
  "file-opened": FileNode | null;
};

/** Window-scoped workspace state: which root is open, which file is active. */
export class WorkspaceService {
  #root: string | null = null;
  #activeFile: FileNode | null = null;
  readonly events: Emitter<WorkspaceEvents> = createEmitter<WorkspaceEvents>();

  /** The opened folder, or null in welcome state. */
  get root(): string | null {
    return this.#root;
  }

  /** The currently open document, if any. */
  get activeFile(): FileNode | null {
    return this.#activeFile;
  }

  /** Switch the opened folder (null = welcome state); clears the active file. */
  setRoot(root: string | null): void {
    this.#root = root;
    this.#activeFile = null;
    this.events.emit("root-changed", root);
    this.events.emit("file-opened", null);
  }

  /** Make `file` the active document; viewers subscribe to file-opened. */
  openFile(file: FileNode): void {
    this.#activeFile = file;
    this.events.emit("file-opened", file);
  }
}
```

`src/host/slots.ts`：

```ts
/** All UI slot names the shell provides containers for. */
export type SlotName = "topbar.left" | "sidebar.tree" | "main.viewer";

/** Renders into its own child element; decides its own visibility. */
export type SlotRenderer = (el: HTMLElement) => void;

/** Typed vanilla-DOM slot registry: renderers run in registration order, each
 * in its own element — no single-slot competition. */
export class SlotsService {
  readonly #entries = new Map<SlotName, Array<{ el: HTMLElement; render: SlotRenderer }>>();
  readonly #containers = new Map<SlotName, HTMLElement>();

  /** Register a renderer into a slot; returns its disposer. */
  register(slot: SlotName, render: SlotRenderer): () => void {
    const list = this.#entries.get(slot) ?? [];
    const el = document.createElement("div");
    el.className = `slot slot-${slot.replace(".", "-")}`;
    const entry = { el, render };
    list.push(entry);
    this.#entries.set(slot, list);
    const container = this.#containers.get(slot);
    if (container) {
      container.appendChild(el);
      this.#render(entry);
    }
    return () => {
      const cur = this.#entries.get(slot) ?? [];
      const i = cur.indexOf(entry);
      if (i >= 0) {
        cur.splice(i, 1);
        entry.el.remove();
      }
    };
  }

  /** Bind (or rebind) a slot's container; owned by the shell plugin. */
  mount(slot: SlotName, container: HTMLElement): void {
    this.#containers.set(slot, container);
    container.replaceChildren();
    for (const entry of this.#entries.get(slot) ?? []) {
      container.appendChild(entry.el);
      this.#render(entry);
    }
  }

  #render(entry: { el: HTMLElement; render: SlotRenderer }): void {
    entry.el.replaceChildren();
    entry.render(entry.el);
  }
}
```

`src/host/context.d.ts`（四个服务齐后的类型合并，插件代码的编译前提）：

```ts
import type { Context } from "cordis";
import type { FilesService } from "./files";
import type { WindowsService } from "./windows";
import type { WorkspaceService } from "./workspace";
import type { SlotsService } from "./slots";

declare module "cordis" {
  interface Context {
    /** 文件通道（读树/读写文本/选目录/媒体 URL/fs 变更流）。 */
    files: FilesService;
    /** 窗口身份/创建/原生确认框/关窗守卫。 */
    windows: WindowsService;
    /** 窗口 scope 工作区状态（root/activeFile）。 */
    workspace: WorkspaceService;
    /** 类型化 UI 槽位注册表。 */
    slots: SlotsService;
  }
}
```

- [ ] **Step 3: 跑测试通过** — Run: `pnpm test -- host-workspace-slots` → PASS。

- [ ] **Step 4: Commit**

```bash
git add src/host/ tests/host-workspace-slots.test.ts
git commit -m "宿主服务 workspace/slots：窗口态状态机 + 类型化槽位注册表

workspace 是窗口 scope 的唯一状态家（root/activeFile）；
slots 是 DSH SlotMap 的原生 DOM 版：有序列表、自决可见性。"
```

---

### Task 6: 装载器（模块表 / 清单 / fail-loud 审计）

**Files:**
- Create: `src/loader/types.ts`、`src/loader/table.ts`、`src/loader/manifest.ts`、`src/loader/boot.ts`
- Test: `tests/loader.test.ts`

**Interfaces:**
- Consumes: `Context`/`FiberState`（Task 1）。
- Produces:
  - `PluginModule = { name: string; inject?: string[]; apply(ctx, config): void | (() => void) }`（cordis 插件的结构子集，所有内置插件的导出形状）
  - `ModuleTable = Record<string, { plugin: PluginModule; defaults: Record<string, unknown> }>`；`MODULE_TABLE: ModuleTable`（本任务建空表，后续插件任务逐行添加）
  - `loadManifest(read, write, table): Promise<Manifest>`；`Manifest = { plugins: Array<{ id; enabled; config }> }`
  - `boot(ctx, manifest, table): Promise<void>`——非 ACTIVE 的启用行按 id 点名抛错

- [ ] **Step 1: 写失败测试**

`tests/loader.test.ts`：

```ts
import { expect, test } from "vitest";
import { Context } from "cordis";
import { boot } from "../src/loader/boot";
import { loadManifest } from "../src/loader/manifest";
import type { ModuleTable } from "../src/loader/table";

const entry = (plugin: object, defaults: Record<string, unknown> = {}) =>
  ({ plugin: plugin as never, defaults });

test("boot: 注入缺失 fail-loud 点名", async () => {
  const table: ModuleTable = { "p-orphan": entry({ name: "p-orphan", inject: ["nope"], apply() {} }) };
  await expect(boot(new Context(), { plugins: [{ id: "p-orphan", enabled: true, config: {} }] }, table))
    .rejects.toThrow(/p-orphan/);
});

test("boot: enabled=false 跳过；未知 id 报错", async () => {
  const table: ModuleTable = { "p-on": entry({ name: "p-on", apply() {} }) };
  await expect(boot(new Context(), { plugins: [{ id: "p-on", enabled: false, config: {} }] }, table))
    .resolves.toBeUndefined();
  await expect(boot(new Context(), { plugins: [{ id: "ghost", enabled: true, config: {} }] }, table))
    .rejects.toThrow(/ghost/);
});

test("boot: defaults 与 config 合并后传入 apply", async () => {
  const seen: unknown[] = [];
  const table: ModuleTable = { "p-cfg": entry({ name: "p-cfg", apply(_c, cfg) { seen.push(cfg); } }, { a: 1, b: 1 }) };
  await boot(new Context(), { plugins: [{ id: "p-cfg", enabled: true, config: { b: 2 } }] }, table);
  expect(seen).toEqual([{ a: 1, b: 2 }]);
});

test("loadManifest: 缺失时生成默认并写回", async () => {
  const table: ModuleTable = { "p-x": entry({ name: "p-x", apply() {} }, { k: "v" }) };
  let written = "";
  const m = await loadManifest(async () => null, async (j) => { written = j; }, table);
  expect(m.plugins).toEqual([{ id: "p-x", enabled: true, config: { k: "v" } }]);
  expect(JSON.parse(written).plugins[0].id).toBe("p-x");
});

test("loadManifest: 损坏清单 fail-loud", async () => {
  await expect(loadManifest(async () => "{oops", async () => {}, {})).rejects.toThrow();
});
```

Run: `pnpm test -- loader` → FAIL。

- [ ] **Step 2: 实现**

`src/loader/types.ts`：

```ts
/** Structural subset of the cordis plugin contract every built-in uses:
 * the (name, inject, apply) triad with an optional cleanup return. */
export interface PluginModule {
  /** Plugin id used by the manifest and audit output. */
  name: string;
  /** Service keys awaited before apply runs. */
  inject?: string[];
  /** Plugin body; returning a function makes all effects reversible. */
  apply(ctx: any, config: any): void | (() => void);
}
```

`src/loader/table.ts`：

```ts
import type { PluginModule } from "./types";

/** One static module table row. */
export interface TableEntry {
  plugin: PluginModule;
  defaults: Record<string, unknown>;
}

/** Static module table: every built-in plugin keyed by id. Rows land with
 * their plugin tasks; Phase 2 adds external modules as another source. */
export type ModuleTable = Record<string, TableEntry>;

/** The build-time module table (single home). */
export const MODULE_TABLE: ModuleTable = {};
```

`src/loader/manifest.ts`：

```ts
import type { ModuleTable } from "./table";

/** One manifest row: which plugin, enabled or not, with what config. */
export interface ManifestRow {
  id: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

/** The whole persisted manifest. */
export interface Manifest {
  plugins: ManifestRow[];
}

/** Read the manifest; when missing, generate defaults from the table and
 * write them back. Corrupt JSON or shape fails loud. */
export async function loadManifest(
  read: () => Promise<string | null>,
  write: (json: string) => Promise<void>,
  table: ModuleTable,
): Promise<Manifest> {
  const raw = await read();
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`插件清单损坏（JSON 解析失败）：${(e as Error).message}`);
    }
    const plugins = (parsed as Manifest).plugins;
    if (!Array.isArray(plugins)) throw new Error("插件清单损坏：plugins 不是数组");
    return parsed as Manifest;
  }
  const manifest: Manifest = {
    plugins: Object.keys(table).map((id) => ({ id, enabled: true, config: { ...table[id].defaults } })),
  };
  await write(JSON.stringify(manifest, null, 2));
  return manifest;
}
```

`src/loader/boot.ts`：

```ts
import { Context, FiberState } from "cordis";
import type { Manifest } from "./manifest";
import type { ModuleTable } from "./table";

/** Boot every enabled row from the static table, then audit fiber states:
 * anything not ACTIVE is reported by id, fail-loud. */
export async function boot(ctx: Context, manifest: Manifest, table: ModuleTable): Promise<void> {
  const states: Array<{ id: string; state: () => number }> = [];
  for (const row of manifest.plugins) {
    if (!row.enabled) continue;
    const entry = table[row.id];
    if (!entry) throw new Error(`装载失败：清单条目 "${row.id}" 不在静态模块表中`);
    const fiber = ctx.plugin(entry.plugin as never, { ...entry.defaults, ...row.config });
    states.push({ id: row.id, state: () => fiber.state });
  }
  await new Promise((r) => setTimeout(r, 50)); // 全树静默（注入等待 + 激活）
  const stuck = states
    .filter((s) => s.state() !== FiberState.ACTIVE)
    .map((s) => `${s.id}（state=${s.state()}）`);
  if (stuck.length) {
    throw new Error(`装载审计失败：${stuck.join("、")} 未激活——声明的服务未提供？`);
  }
}
```

- [ ] **Step 3: 跑测试通过** — Run: `pnpm test -- loader` → PASS（若 `FiberState` 值导入异常，按 Task 1 Step 5 的校准说明处理）。

- [ ] **Step 4: Commit**

```bash
git add src/loader/ tests/loader.test.ts
git commit -m "装载器：静态模块表 + 清单 + fail-loud 激活审计

组合是数据不是代码：清单行驱动 ctx.plugin，注入顺序交给 cordis；
审计点名未激活插件（DSH 浏览器端骨架版）。"
```

---

### Task 7: app-shell 插件 + bootstrap + 入口改造

**Files:**
- Create: `src/bootstrap.ts`、`src/plugins/app-shell/index.ts`
- Modify: `src/main.ts`（重写为三行）、`index.html`（重写为最小骨架）、`src/styles.css`（重写为栅格布局）、`src/loader/table.ts`（登记 app-shell）
- Test: `tests/bootstrap.test.ts`

**Interfaces:**
- Consumes: Task 4/5/6 全部产出。
- Produces:
  - `bootstrap(env?: BootstrapEnv): Promise<Context>`——每窗口启动流程；`BootstrapEnv` 可注入 invoke/listen/dialog/label/onCloseRequested/table（缺省真实 Tauri 绑定）
  - app-shell 提供 `.topbar` / `.sidebar` / `.main` 栅格与三个槽容器；无 root 时主区渲染欢迎态（"打开文件夹…"按钮）

- [ ] **Step 1: 写失败测试**

`tests/bootstrap.test.ts`：

```ts
// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { bootstrap } from "../src/bootstrap";
import type { ModuleTable } from "../src/loader/table";

function fakeEnv(table: ModuleTable) {
  const written: string[] = [];
  const ran: string[] = [];
  const openDialog = vi.fn();
  const probe = { name: "probe", inject: ["files", "windows", "workspace", "slots"], apply(ctx: any) { ran.push(`ctx-ok:${!!ctx.files && !!ctx.windows && !!ctx.workspace && !!ctx.slots}`); } };
  table["probe"] = { plugin: probe, defaults: {} };
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "read_manifest") return null;
    if (cmd === "write_manifest") { written.push(String(args?.json)); return null; }
    if (cmd === "get_window_state") return null;
    throw new Error(`unexpected ${cmd}`);
  });
  return {
    env: {
      invoke,
      listen: vi.fn(async () => () => {}),
      openDialog,
      assetUrl: (p: string) => `a:${p}`,
      currentLabel: () => "main",
      onCloseRequested: vi.fn(async () => () => {}),
      table,
    },
    written, ran, openDialog,
  };
}

test("bootstrap: 首启生成默认清单、宿主服务齐全、插件激活", async () => {
  const f = fakeEnv({});
  const ctx = await bootstrap(f.env);
  expect(f.ran).toEqual(["ctx-ok:true"]);
  expect(JSON.parse(f.written[0]).plugins.map((p: { id: string }) => p.id)).toContain("app-shell");
  expect(document.querySelector(".main")).not.toBeNull();
  expect((ctx as any).files).toBeDefined();
});

test("bootstrap: 欢迎态按钮 → pickFolder → setRoot", async () => {
  const f = fakeEnv({});
  const ctx = await bootstrap(f.env);
  const btn = document.querySelector<HTMLButtonElement>(".welcome button");
  expect(btn).not.toBeNull();
  f.openDialog.mockResolvedValue("/picked");
  btn!.click();
  await new Promise((r) => setTimeout(r, 10));
  expect(f.openDialog).toHaveBeenCalledWith();
  // pickFolder 返回后走 setRoot：欢迎态消失（时序抖动则改为直接断言 ctx.workspace.root）
  expect(ctx.workspace.root).toBe("/picked");
  expect(document.querySelector(".welcome")).toBeNull();
});
```

（`fakeEnv` 返回的 `openDialog` 是 `vi.fn()`，用 `mockResolvedValue` 改返回值——不要替换 `f.env.openDialog` 本身：服务构造时已捕获原函数引用，替换不生效。`fakeEnv` 的返回值里把 `openDialog` 一并暴露出来。）

Run: `pnpm test -- bootstrap` → FAIL。

- [ ] **Step 2: 实现**

`src/bootstrap.ts`：

```ts
import { Context } from "cordis";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FilesService } from "./host/files";
import { WindowsService } from "./host/windows";
import { WorkspaceService } from "./host/workspace";
import { SlotsService } from "./host/slots";
import { loadManifest } from "./loader/manifest";
import { boot } from "./loader/boot";
import { MODULE_TABLE, type ModuleTable } from "./loader/table";

/** Injected environment; defaults bind real Tauri APIs (tests fake these). */
export interface BootstrapEnv {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  listen: (event: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;
  openDialog: () => Promise<string | null>;
  assetUrl: (path: string) => string;
  currentLabel: () => string;
  onCloseRequested: (cb: (e: { preventDefault(): void }) => void) => Promise<() => void>;
  table?: ModuleTable;
}

/** Real bindings. */
export const defaultEnv: BootstrapEnv = {
  invoke,
  listen,
  openDialog: () => open({ directory: true, multiple: false }) as Promise<string | null>,
  assetUrl: convertFileSrc,
  currentLabel: () => getCurrentWebviewWindow().label,
  onCloseRequested: (cb) => getCurrentWebviewWindow().onCloseRequested(cb),
};

/** Per-window bootstrap: label → root → context + host services → manifest → boot. */
export async function bootstrap(env: BootstrapEnv = defaultEnv): Promise<Context> {
  const ctx = new Context();
  const files = new FilesService({ invoke: env.invoke, listen: env.listen, openDialog: env.openDialog, assetUrl: env.assetUrl });
  const windows = new WindowsService({ invoke: env.invoke, currentLabel: env.currentLabel, onCloseRequested: env.onCloseRequested });
  const workspace = new WorkspaceService();
  const slots = new SlotsService();
  ctx.reflect.provide("files", files);
  ctx.reflect.provide("windows", windows);
  ctx.reflect.provide("workspace", workspace);
  ctx.reflect.provide("slots", slots);
  await files.start();
  workspace.setRoot(await windows.fetchRoot(windows.currentLabel()));
  const table = env.table ?? MODULE_TABLE;
  const manifest = await loadManifest(
    () => env.invoke("read_manifest") as Promise<string | null>,
    (json) => env.invoke("write_manifest", { json }),
    table,
  );
  await boot(ctx, manifest, table);
  return ctx;
}
```

`src/plugins/app-shell/index.ts`：

```ts
import type { Context } from "cordis";

export const name = "app-shell";
export const inject = ["files", "workspace", "slots"];

/** Shell layout: topbar + sidebar + main, and the slot containers. */
export interface ShellConfig {
  /** Application title shown in the topbar. */
  title: string;
}

export function apply(ctx: Context, config: ShellConfig): () => void {
  const app = document.getElementById("app")!;
  app.className = "shell";
  app.replaceChildren();
  const topbar = document.createElement("header");
  topbar.className = "topbar";
  const brand = document.createElement("h1");
  brand.textContent = config.title;
  const topbarLeft = document.createElement("div");
  topbarLeft.className = "slot-host topbar-left";
  topbar.append(topbarLeft, brand);
  const body = document.createElement("div");
  body.className = "body";
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  const treeHost = document.createElement("div");
  treeHost.className = "slot-host sidebar-tree";
  sidebar.append(treeHost);
  const main = document.createElement("main");
  main.className = "main";
  const viewerHost = document.createElement("div");
  viewerHost.className = "slot-host main-viewer";
  main.append(viewerHost);
  body.append(sidebar, main);
  app.append(topbar, body);

  ctx.slots.mount("topbar.left", topbarLeft);
  ctx.slots.mount("sidebar.tree", treeHost);
  ctx.slots.mount("main.viewer", viewerHost);

  const welcome = document.createElement("div");
  welcome.className = "welcome";
  const hint = document.createElement("p");
  hint.textContent = "打开一个文件夹，开始阅读与笔记。";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "打开文件夹…";
  btn.addEventListener("click", async () => {
    const root = await ctx.files.pickFolder();
    if (root) ctx.workspace.setRoot(root);
  });
  welcome.append(hint, btn);

  const syncWelcome = (): void => {
    if (ctx.workspace.root) {
      welcome.remove();
    } else {
      viewerHost.before(welcome);
    }
  };
  const off = ctx.workspace.events.on("root-changed", syncWelcome);
  syncWelcome();
  return () => off();
}
```

`src/loader/table.ts` 追加行（import 置顶）：

```ts
import * as appShell from "../plugins/app-shell";

Object.assign(MODULE_TABLE, {
  "app-shell": { plugin: appShell as PluginModule, defaults: { title: "StudyWiki" } },
});
```

`src/main.ts` 重写：

```ts
import { bootstrap } from "./bootstrap";
import "./styles.css";

void bootstrap();
```

`index.html` 的 `<body>` 内替换为：

```html
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
```

`src/styles.css` 重写（栅格三行布局，其余视觉从简）：

```css
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.6 system-ui, sans-serif; }
.shell { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
.topbar { display: flex; align-items: center; gap: 12px; padding: 6px 12px; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
.topbar h1 { font-size: 15px; margin: 0 auto 0 0; }
.body { display: grid; grid-template-columns: 260px 1fr; min-height: 0; }
.sidebar { border-right: 1px solid color-mix(in srgb, currentColor 15%, transparent); overflow: auto; padding: 8px; }
.main { overflow: auto; padding: 16px; position: relative; }
.welcome { max-width: 420px; margin: 10vh auto; text-align: center; }
.slot-host { display: contents; }
.markdown-body { max-width: 760px; margin: 0 auto; }
.cm-editor { max-width: 860px; margin: 0 auto; }
.tree-row { display: flex; width: 100%; padding: 2px 4px; border: 0; background: none; text-align: left; cursor: pointer; font: inherit; border-radius: 4px; }
.tree-row:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.tree-dir { font-weight: 600; }
.tree-file.kind-video::before { content: "▶ "; opacity: .6; }
.viewer-toolbar { display: flex; gap: 8px; margin-bottom: 8px; }
.dirty::before { content: "● "; }
```

- [ ] **Step 3: 跑测试通过** — Run: `pnpm test -- bootstrap` → PASS；`pnpm test`（全量不红）。

- [ ] **Step 4: 起应用冒烟（手工）**

Run: `pnpm tauri dev`
Expected: 窗口打开 → 顶栏 + 欢迎态；点"打开文件夹…"能选目录（选完侧栏暂空——文件树是下一任务）；控制台无装载审计报错。

- [ ] **Step 5: Commit**

```bash
git add src/ index.html tests/bootstrap.test.ts
git commit -m "app-shell + 每窗口 bootstrap：静态装载首次跑通

main.ts 收敛为三行；布局/槽容器/欢迎态归 app-shell；
首启自动生成默认清单写入 app 配置目录。"
```

---

### Task 8: view-filetree 插件（侧栏树）

**Files:**
- Create: `src/plugins/view-filetree/index.ts`、`src/plugins/view-filetree/tree.ts`
- Modify: `src/loader/table.ts`（登记行）
- Test: `tests/view-filetree.test.ts`

**Interfaces:**
- Consumes: `FilesService.readTree/onFsChanged/pickFolder`、`WorkspaceService.openFile/events`、`SlotsService.register("sidebar.tree")`。
- Produces:
  - `filterTree(nodes, { ignoreDotfiles }): FileNode[]`（纯）
  - `visibleRows(nodes, expanded): Array<{ node, depth }>`（纯）
  - 模块表行 `"view-filetree"`，defaults `{ ignoreDotfiles: true }`

- [ ] **Step 1: 写失败测试**

`tests/view-filetree.test.ts`：

```ts
// @vitest-environment jsdom
import { expect, test } from "vitest";
import { filterTree, visibleRows } from "../src/plugins/view-filetree/tree";
import type { FileNode } from "../src/types";

const dir = (name: string, path: string, children: FileNode[]): FileNode => ({ name, path, kind: "dir", children });
const md = (name: string): FileNode => ({ name, path: `/x/${name}`, kind: "markdown" });

test("filterTree: 点文件按配置剔除（递归）", () => {
  const tree = [dir(".git", "/x/.git", [md("config")]), md("a.md"), dir("Sub", "/x/Sub", [md(".hidden")])];
  const out = filterTree(tree, { ignoreDotfiles: true });
  expect(out.map((n) => n.name)).toEqual(["a.md", "Sub"]);
  expect(out[1].children!.map((n) => n.name)).toEqual([]);
  expect(filterTree(tree, { ignoreDotfiles: false }).length).toBe(3);
});

test("visibleRows: 仅展开目录可见，携带深度", () => {
  const tree = [dir("S", "/x/S", [md("a.md"), md("b.md")]), md("c.md")];
  expect(visibleRows(tree, new Set()).map((r) => r.node.name)).toEqual(["S", "c.md"]);
  expect(visibleRows(tree, new Set(["/x/S"])).map((r) => `${"--".repeat(r.depth)}${r.node.name}`))
    .toEqual(["S", "--a.md", "--b.md", "c.md"]);
});

test("DOM: 点击文件触发 workspace.openFile；点目录切换展开", async () => {
  const { apply } = await import("../src/plugins/view-filetree");
  const opened: FileNode[] = [];
  const root = "/x";
  const files = {
    readTree: async () => [dir("S", "/x/S", [md("a.md")]), md("c.md")],
    onFsChanged: () => () => {},
  };
  const workspace = { root, events: { on: () => () => {} }, openFile: (f: FileNode) => opened.push(f) };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ files, workspace, slots } as never, { ignoreDotfiles: true });
  await new Promise((r) => setTimeout(r, 10));
  const dirBtn = document.querySelector<HTMLButtonElement>(".tree-dir")!;
  dirBtn.click(); // 展开
  await new Promise((r) => setTimeout(r, 0));
  const fileBtns = [...document.querySelectorAll<HTMLButtonElement>(".tree-file")];
  fileBtns.find((b) => b.textContent === "a.md")!.click();
  expect(opened.map((f) => f.name)).toEqual(["a.md"]);
});
```

Run: `pnpm test -- view-filetree` → FAIL。

- [ ] **Step 2: 实现**

`src/plugins/view-filetree/tree.ts`：

```ts
import type { FileNode } from "../../types";

/** Config for the file tree plugin. */
export interface TreeConfig {
  /** Hide dotfiles and dot-directories when true. */
  ignoreDotfiles: boolean;
}

/** Drop dotfiles/dot-directories recursively when configured. */
export function filterTree(nodes: FileNode[], config: TreeConfig): FileNode[] {
  if (!config.ignoreDotfiles) return nodes;
  return nodes
    .filter((n) => !n.name.startsWith("."))
    .map((n) => (n.children ? { ...n, children: filterTree(n.children, config) } : n));
}

/** Flatten to visible rows (depth-first, only inside expanded directories). */
export function visibleRows(nodes: FileNode[], expanded: ReadonlySet<string>): Array<{ node: FileNode; depth: number }> {
  const out: Array<{ node: FileNode; depth: number }> = [];
  const walk = (list: FileNode[], depth: number): void => {
    for (const node of list) {
      out.push({ node, depth });
      if (node.children && expanded.has(node.path)) walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return out;
}
```

`src/plugins/view-filetree/index.ts`：

```ts
import type { Context } from "cordis";
import type { FileNode } from "../../types";
import { filterTree, visibleRows, type TreeConfig } from "./tree";

export const name = "view-filetree";
export const inject = ["files", "workspace", "slots"];

/** Sidebar file tree: expand/collapse directories, click to open documents. */
export function apply(ctx: Context, config: TreeConfig): () => void {
  let nodes: FileNode[] = [];
  const expanded = new Set<string>();
  let host: HTMLElement | null = null;

  const render = (): void => {
    if (!host) return;
    host.replaceChildren();
    if (!ctx.workspace.root) {
      const empty = document.createElement("p");
      empty.className = "tree-empty";
      empty.textContent = "未打开文件夹";
      host.append(empty);
      return;
    }
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "tree-refresh";
    refresh.textContent = "刷新";
    refresh.addEventListener("click", () => void reload());
    host.append(refresh);
    const list = document.createElement("nav");
    list.className = "tree";
    list.setAttribute("aria-label", "文件树");
    for (const { node, depth } of visibleRows(filterTree(nodes, config), expanded)) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `tree-row tree-${node.kind === "dir" ? "dir" : "file"} kind-${node.kind}`;
      row.style.paddingLeft = `${4 + depth * 14}px`;
      row.textContent = (node.kind === "dir" ? (expanded.has(node.path) ? "▾ " : "▸ ") : "") + node.name;
      row.addEventListener("click", () => {
        if (node.kind === "dir") {
          if (expanded.has(node.path)) expanded.delete(node.path);
          else expanded.add(node.path);
          render();
        } else if (node.kind === "markdown" || node.kind === "video") {
          ctx.workspace.openFile(node);
        }
      });
      list.append(row);
    }
    host.append(list);
  };

  const reload = async (): Promise<void> => {
    const root = ctx.workspace.root;
    if (!root) return;
    nodes = await ctx.files.readTree(root);
    render();
  };

  const offRoot = ctx.workspace.events.on("root-changed", () => {
    expanded.clear();
    nodes = [];
    void reload();
  });
  const offFs = ctx.files.onFsChanged((path) => {
    if (ctx.workspace.root && (path === ctx.workspace.root || path.startsWith(ctx.workspace.root))) void reload();
  });
  const offSlot = ctx.slots.register("sidebar.tree", (el) => {
    host = el;
    render();
    void reload();
  });
  return () => { offRoot(); offFs(); offSlot(); };
}
```

`src/loader/table.ts` 登记（import 置顶 `import * as viewFiletree from "../plugins/view-filetree";`）：

```ts
Object.assign(MODULE_TABLE, {
  "view-filetree": { plugin: viewFiletree as PluginModule, defaults: { ignoreDotfiles: true } },
});
```

- [ ] **Step 3: 跑测试 + 手工冒烟** — Run: `pnpm test -- view-filetree` → PASS；`pnpm tauri dev`：打开文件夹 → 树渲染、目录展开折叠、点 md 文件（主区暂空——doc 插件下一任务）。

- [ ] **Step 4: Commit**

```bash
git add src/plugins/view-filetree/ src/loader/table.ts tests/view-filetree.test.ts
git commit -m "view-filetree：侧栏文件树（展开折叠/点开/手动刷新/fs 事件重读）

纯函数（过滤/可见行）与 DOM 分层可测；
树刷新走 Rust fs://changed 广播（含外部改名后的手动刷新兜底）。"
```

---

### Task 9: doc-markdown 插件（预览模式）

**Files:**
- Create: `src/plugins/doc-markdown/index.ts`、`src/plugins/doc-markdown/preview.ts`
- Modify: `src/loader/table.ts`（登记行）
- Test: `tests/doc-markdown.test.ts`

**Interfaces:**
- Consumes: `FilesService.readText`、`WorkspaceService.events/activeFile`、`SlotsService.register("main.viewer")`。
- Produces:
  - `renderMarkdown(src: string): string`（纯；markdown-it `html:false`——源文件里的内嵌 HTML 原样转义不执行）
  - 模块表行 `"doc-markdown"`（defaults `{}`）；本任务只交预览，编辑模式与保存是 Task 10

- [ ] **Step 1: 写失败测试**

`tests/doc-markdown.test.ts`：

```ts
// @vitest-environment jsdom
import { expect, test } from "vitest";
import { renderMarkdown } from "../src/plugins/doc-markdown/preview";
import { apply } from "../src/plugins/doc-markdown";
import type { FileNode } from "../src/types";

test("renderMarkdown: 标题成 h1；内嵌 HTML 被转义不执行", () => {
  expect(renderMarkdown("# hi")).toContain("<h1>hi</h1>");
  expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
});

test("DOM: file-opened(kind=markdown) 渲染预览；kind 不符清空", async () => {
  const md = (name: string): FileNode => ({ name, path: `/x/${name}`, kind: "markdown" });
  let opened: ((f: FileNode | null) => void) => () => {};
  const files = { readText: async (p: string) => `# ${p}` };
  const workspace = {
    activeFile: null as FileNode | null,
    events: { on: (_k: string, fn: (f: FileNode | null) => void) => { opened = fn; return () => {}; } },
  };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ files, workspace, slots } as never, {});
  await new Promise((r) => setTimeout(r, 0));
  await opened(md("a.md"));
  expect(document.querySelector(".markdown-body h1")?.textContent).toBe("/x/a.md");
  await opened(null);
  expect(document.querySelector(".markdown-body")).toBeNull();
});
```

Run: `pnpm test -- doc-markdown` → FAIL。

- [ ] **Step 2: 实现**

`src/plugins/doc-markdown/preview.ts`：

```ts
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });

/** Render markdown source to HTML (raw HTML disabled — escaped, not executed). */
export function renderMarkdown(src: string): string {
  return md.render(src);
}
```

`src/plugins/doc-markdown/index.ts`：

```ts
import type { Context } from "cordis";
import type { FileNode } from "../../types";
import { renderMarkdown } from "./preview";

export const name = "doc-markdown";
export const inject = ["files", "workspace", "slots"];

/** Markdown document viewer: preview of the active file. */
export function apply(ctx: Context): () => void {
  let host: HTMLElement | null = null;
  let current: FileNode | null = null;

  const render = (): void => {
    if (!host) return;
    host.replaceChildren();
    if (!current || current.kind !== "markdown") return;
    const body = document.createElement("div");
    body.className = "markdown-body";
    void ctx.files.readText(current.path).then((text) => {
      body.innerHTML = renderMarkdown(text);
    });
    host.append(body);
  };

  const offFile = ctx.workspace.events.on("file-opened", (f) => {
    current = f;
    render();
  });
  const offSlot = ctx.slots.register("main.viewer", (el) => {
    host = el;
    current = ctx.workspace.activeFile;
    render();
  });
  return () => { offFile(); offSlot(); };
}
```

`src/loader/table.ts` 登记（import 置顶 `import * as docMarkdown from "../plugins/doc-markdown";`）：

```ts
Object.assign(MODULE_TABLE, {
  "doc-markdown": { plugin: docMarkdown as PluginModule, defaults: {} },
});
```

- [ ] **Step 3: 跑测试 + 手工冒烟** — Run: `pnpm test -- doc-markdown` → PASS；`pnpm tauri dev`：树里点开 md 文件 → 主区渲染预览。

- [ ] **Step 4: Commit**

```bash
git add src/plugins/doc-markdown/ src/loader/table.ts tests/doc-markdown.test.ts
git commit -m "doc-markdown 预览模式：markdown-it html:false 渲染活动文件

预览是编辑的前置增量；内嵌 HTML 一律转义，
安全面不依赖使用者的自觉。"
```

---

### Task 10: doc-markdown 编辑模式（CodeMirror 6）+ 脏标记 + 保存 + 关窗守卫

**Files:**
- Create: `src/plugins/doc-markdown/mode.ts`、`src/plugins/doc-markdown/editor.ts`
- Modify: `src/plugins/doc-markdown/index.ts`（重写：工具栏 + 双模式 + 保存 + 守卫）
- Modify: `package.json`（dependencies：CodeMirror 系）
- Test: `tests/doc-markdown-edit.test.ts`

**Interfaces:**
- Consumes: Task 4 `WindowsService.confirmDialog/guardClose`、`FilesService.writeText`。
- Produces:
  - `DocMode = "preview" | "edit"`；`DocState { mode, savedText, text }`
  - 纯函数：`openDoc(text)`、`editText(s, text)`、`markSaved(s)`、`toggleMode(mode)`、`isDirty(s)`
  - `EditorFactory = (parent, initial, onChange, onSave) => EditorHandle`；`EditorHandle { dom, getText(), destroy() }`；真实现 `createCodeMirror`（CodeMirror 唯一 import 点，测试注入假工厂）
  - 编辑模式工具栏：模式切换 / 保存按钮（dirty 时 `●` 前缀）；`Mod-s`（Ctrl/Cmd+S）保存；窗口标题 dirty 前缀 `●`；关窗 dirty → `windows.confirmDialog` 确认

- [ ] **Step 1: 装依赖（先登记白名单语义：纯 ESM 零运行时依赖，构建期打包）**

```bash
pnpm add @codemirror/state @codemirror/view @codemirror/commands @codemirror/language @codemirror/lang-markdown codemirror
```

（明确**不装** `@codemirror/language-data`——它按需动态 `import()` 语言包，撞 Task 14 的装载缝扫描。）

- [ ] **Step 2: 写失败测试**

`tests/doc-markdown-edit.test.ts`：

```ts
// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { editText, isDirty, markSaved, openDoc, toggleMode } from "../src/plugins/doc-markdown/mode";

test("mode 纯逻辑: open/edit/saved/dirty/toggle", () => {
  let s = openDoc("a");
  expect(s.mode).toBe("preview");
  expect(isDirty(s)).toBe(false);
  s = editText(s, "ab");
  expect(isDirty(s)).toBe(true);
  s = markSaved(s);
  expect(isDirty(s)).toBe(false);
  expect(toggleMode("preview")).toBe("edit");
  expect(toggleMode("edit")).toBe("preview");
});

test("DOM: 编辑模式挂载编辑器工厂、onChange 记脏、保存写回", async () => {
  const { apply } = await import("../src/plugins/doc-markdown");
  const md = { name: "a.md", path: "/x/a.md", kind: "markdown" as const };
  const writes: Array<[string, string]> = [];
  const factory = vi.fn((parent: HTMLElement, initial: string, onChange: (t: string) => void, onSave: () => void) => {
    const dom = document.createElement("div");
    dom.className = "fake-editor";
    dom.textContent = initial;
    (dom as HTMLElement & { __fire: (t: string) => void; __save: () => void }).__fire = (t) => onChange(t);
    (dom as HTMLElement & { __fire: (t: string) => void; __save: () => void }).__save = onSave;
    parent.append(dom);
    return { dom, getText: () => dom.textContent ?? "", destroy: () => dom.remove() };
  });
  let opened: ((f: typeof md | null) => void) => () => {};
  const files = { readText: async () => "body", writeText: async (p: string, c: string) => { writes.push([p, c]); } };
  const workspace = { activeFile: null, events: { on: (_k: string, fn: (f: typeof md | null) => void) => { opened = fn; return () => {}; } } };
  const guardClose = vi.fn(async () => () => {});
  const windows = { confirmDialog: vi.fn(async () => true), guardClose };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ files, windows, workspace, slots } as never, {}, factory as never);
  await new Promise((r) => setTimeout(r, 0));
  await opened(md);
  (document.querySelector(".fake-editor") as HTMLElement & { __fire: (t: string) => void }).__fire("body2");
  expect(document.querySelector(".viewer-toolbar button:nth-child(2)")?.classList.contains("dirty")).toBe(true);
  (document.querySelector(".fake-editor") as HTMLElement & { __save: () => void }).__save();
  await new Promise((r) => setTimeout(r, 0));
  expect(writes).toEqual([["/x/a.md", "body2"]]);
  expect(document.querySelector(".viewer-toolbar button:nth-child(2)")?.classList.contains("dirty")).toBe(false);
  expect(guardClose).toHaveBeenCalled();
});

test("DOM: 切到编辑模式渲染编辑器，切回预览销毁", async () => {
  const { apply } = await import("../src/plugins/doc-markdown");
  const md = { name: "a.md", path: "/x/a.md", kind: "markdown" as const };
  const noop = () => {};
  const factory = (parent: HTMLElement) => {
    const dom = document.createElement("div");
    dom.className = "fake-editor";
    parent.append(dom);
    return { dom, getText: () => "", destroy: () => dom.remove() };
  };
  let opened: ((f: typeof md | null) => void) => noop;
  const files = { readText: async () => "body", writeText: async () => {} };
  const workspace = { activeFile: null, events: { on: (_k: string, fn: (f: typeof md | null) => void) => { opened = fn; return () => {}; } } };
  const windows = { confirmDialog: vi.fn(async () => true), guardClose: vi.fn(async () => () => {}) };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ files, windows, workspace, slots } as never, {}, factory as never);
  await new Promise((r) => setTimeout(r, 0));
  await opened(md);
  (document.querySelector(".viewer-toolbar button") as HTMLButtonElement).click(); // 切到编辑
  expect(document.querySelector(".fake-editor")).not.toBeNull();
  (document.querySelector(".viewer-toolbar button") as HTMLButtonElement).click(); // 切回预览
  expect(document.querySelector(".fake-editor")).toBeNull();
  expect(document.querySelector(".markdown-body")).not.toBeNull();
});
```

（两个 DOM 用例的 fake ctx 组装结构相同——执行时提成本文件内的 `makeCtx()` helper 复用，不要整段复制。）

Run: `pnpm test -- doc-markdown-edit` → FAIL。

- [ ] **Step 3: 实现**

`src/plugins/doc-markdown/mode.ts`：

```ts
/** Document display mode. */
export type DocMode = "preview" | "edit";

/** Document state; the editor's own text is mirrored into `text` via onChange. */
export interface DocState {
  mode: DocMode;
  savedText: string;
  text: string;
}

/** Open a document: preview mode, clean. */
export function openDoc(text: string): DocState {
  return { mode: "preview", savedText: text, text };
}

/** Record an edit (editor onChange). */
export function editText(s: DocState, text: string): DocState {
  return { ...s, text };
}

/** Record a successful save. */
export function markSaved(s: DocState): DocState {
  return { ...s, savedText: s.text };
}

/** Toggle the display mode. */
export function toggleMode(mode: DocMode): DocMode {
  return mode === "preview" ? "edit" : "preview";
}

/** Dirty when text differs from the last saved text. */
export function isDirty(s: DocState): boolean {
  return s.text !== s.savedText;
}
```

`src/plugins/doc-markdown/editor.ts`：

```ts
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";

/** Handle over a live editor instance. */
export interface EditorHandle {
  dom: HTMLElement;
  getText(): string;
  destroy(): void;
}

/** Editor factory seam: the real one wraps CodeMirror; tests inject a stub. */
export type EditorFactory = (
  parent: HTMLElement,
  initial: string,
  onChange: (text: string) => void,
  onSave: () => void,
) => EditorHandle;

/** Create the CodeMirror 6 editor (the only CodeMirror import site in this plugin). */
export function createCodeMirror(
  parent: HTMLElement,
  initial: string,
  onChange: (text: string) => void,
  onSave: () => void,
): EditorHandle {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initial,
      extensions: [
        basicSetup,
        markdown(),
        Prec.highest(keymap.of([{ key: "Mod-s", run: () => { onSave(); return true; } }])),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
      ],
    }),
  });
  return {
    dom: view.dom,
    getText: () => view.state.doc.toString(),
    destroy: () => view.destroy(),
  };
}
```

`src/plugins/doc-markdown/index.ts` 重写：

```ts
import type { Context } from "cordis";
import type { FileNode } from "../../types";
import { renderMarkdown } from "./preview";
import { editText, isDirty, markSaved, openDoc, toggleMode, type DocState } from "./mode";
import { createCodeMirror, type EditorFactory, type EditorHandle } from "./editor";

export const name = "doc-markdown";
export const inject = ["files", "windows", "workspace", "slots"];

/** Markdown document: preview and edit of the active file, manual Ctrl+S save. */
export function apply(
  ctx: Context,
  _config: Record<string, never>,
  editorFactory: EditorFactory = createCodeMirror,
): () => void {
  let host: HTMLElement | null = null;
  let current: FileNode | null = null;
  let state: DocState = openDoc("");
  let editor: EditorHandle | null = null;
  let offGuard: (() => void) | null = null;

  const save = async (): Promise<void> => {
    if (!current || !isDirty(state)) return;
    await ctx.files.writeText(current.path, state.text);
    state = markSaved(state);
    paintChrome();
  };

  const paintChrome = (): void => {
    const dirty = current?.kind === "markdown" && isDirty(state);
    host?.querySelector(".save-btn")?.classList.toggle("dirty", dirty);
    document.title = dirty && current ? `● ${current.name}` : current?.name ?? "StudyWiki";
  };

  const render = (): void => {
    if (!host) return;
    host.replaceChildren();
    editor?.destroy();
    editor = null;
    if (!current || current.kind !== "markdown") {
      paintChrome();
      return;
    }
    const bar = document.createElement("div");
    bar.className = "viewer-toolbar";
    const modeBtn = document.createElement("button");
    modeBtn.type = "button";
    modeBtn.textContent = state.mode === "preview" ? "编辑" : "预览";
    modeBtn.addEventListener("click", () => {
      state = { ...state, mode: toggleMode(state.mode) };
      render();
    });
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "save-btn";
    saveBtn.textContent = "保存 (Ctrl+S)";
    saveBtn.addEventListener("click", () => void save());
    bar.append(modeBtn, saveBtn);
    const body = document.createElement("div");
    body.className = "doc-body";
    if (state.mode === "preview") {
      const pv = document.createElement("div");
      pv.className = "markdown-body";
      pv.innerHTML = renderMarkdown(state.text);
      body.append(pv);
    } else {
      editor = editorFactory(body, state.text, (text) => {
        state = editText(state, text);
        paintChrome();
      }, () => void save());
    }
    host.append(bar, body);
    paintChrome();
  };

  const open = async (file: FileNode | null): Promise<void> => {
    current = file;
    if (file?.kind === "markdown") state = openDoc(await ctx.files.readText(file.path));
    render();
  };

  void ctx.windows.guardClose(
    () => current?.kind === "markdown" && isDirty(state),
    () => ctx.windows.confirmDialog(`放弃对 ${current?.name} 的未保存修改并关闭？`),
  ).then((off) => { offGuard = off; });

  const offFile = ctx.workspace.events.on("file-opened", (f) => void open(f));
  const offSlot = ctx.slots.register("main.viewer", (el) => {
    host = el;
    render();
    void open(ctx.workspace.activeFile);
  });
  return () => { offFile(); offSlot(); offGuard?.(); editor?.destroy(); };
}
```

- [ ] **Step 4: 跑测试通过 + 全量** — Run: `pnpm test -- doc-markdown-edit` → PASS；`pnpm test`（Task 9 的用例若因 index.ts 重写需微调断言——只允许调整 DOM 断言，纯函数与行为断言不动）。

- [ ] **Step 5: 手工冒烟** — Run: `pnpm tauri dev`：点开 md → 预览；切"编辑"→ CodeMirror 高亮编辑、标题出现 `●`；Ctrl+S 保存 → `●` 消失、文件落盘；改完不保存点关窗 → 确认框。

- [ ] **Step 6: Commit**

```bash
git add src/plugins/doc-markdown/ package.json pnpm-lock.yaml tests/doc-markdown-edit.test.ts
git commit -m "doc-markdown 编辑模式：CodeMirror 6 + 脏标记 + Ctrl+S + 关窗守卫

模式切换保留文本（状态机纯函数可测）；
编辑器工厂是注入缝，测试不进 CodeMirror；
关窗守卫走宿主 windows 服务（分层纪律零例外）。"
```

---

### Task 11: doc-video 插件

**Files:**
- Create: `src/plugins/doc-video/index.ts`
- Modify: `src/loader/table.ts`（登记行）
- Test: `tests/doc-video.test.ts`

**Interfaces:**
- Consumes: `FilesService.assetUrl`、`WorkspaceService.activeFile/events`、`SlotsService.register("main.viewer")`。
- Produces: 模块表行 `"doc-video"`（defaults `{}`）；kind=video 活动文件渲染 `<video controls>`。

- [ ] **Step 1: 写失败测试**

`tests/doc-video.test.ts`：

```ts
// @vitest-environment jsdom
import { expect, test } from "vitest";
import { apply } from "../src/plugins/doc-video";

test("DOM: kind=video 渲染 video 并用 assetUrl；其他 kind 不画", async () => {
  let opened: ((f: unknown) => void) => () => {};
  const files = { assetUrl: (p: string) => `asset:${p}` };
  const workspace = { activeFile: null, events: { on: (_k: string, fn: (f: unknown) => void) => { opened = fn; return () => {}; } } };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ files, workspace, slots } as never, {});
  await opened({ name: "v.mp4", path: "/x/v.mp4", kind: "video" });
  const video = document.querySelector<HTMLVideoElement>("video");
  expect(video?.controls).toBe(true);
  expect(video?.getAttribute("src")).toBe("asset:/x/v.mp4");
  await opened({ name: "a.md", path: "/x/a.md", kind: "markdown" });
  expect(document.querySelector("video")).toBeNull();
});
```

Run: `pnpm test -- doc-video` → FAIL。

- [ ] **Step 2: 实现**

`src/plugins/doc-video/index.ts`：

```ts
import type { Context } from "cordis";

export const name = "doc-video";
export const inject = ["files", "workspace", "slots"];

/** Video viewer for the active file (asset-protocol playback). */
export function apply(ctx: Context): () => void {
  let host: HTMLElement | null = null;

  const render = (): void => {
    if (!host) return;
    host.replaceChildren();
    const file = ctx.workspace.activeFile;
    if (file?.kind !== "video") return;
    const video = document.createElement("video");
    video.controls = true;
    video.style.maxWidth = "100%";
    video.src = ctx.files.assetUrl(file.path);
    host.append(video);
  };

  const offFile = ctx.workspace.events.on("file-opened", () => render());
  const offSlot = ctx.slots.register("main.viewer", (el) => {
    host = el;
    render();
  });
  return () => { offFile(); offSlot(); };
}
```

`src/loader/table.ts` 登记（`import * as docVideo from "../plugins/doc-video";`）：

```ts
Object.assign(MODULE_TABLE, {
  "doc-video": { plugin: docVideo as PluginModule, defaults: {} },
});
```

- [ ] **Step 3: 跑测试 + 手工冒烟** — Run: `pnpm test -- doc-video` → PASS；`pnpm tauri dev`：树里点 mp4 → 播放不回退（对照旧版本行为）。

- [ ] **Step 4: Commit**

```bash
git add src/plugins/doc-video/ src/loader/table.ts tests/doc-video.test.ts
git commit -m "doc-video：视频查看器迁入插件位

原有能力平移：assetUrl 喂 <video>，
槽位自决可见性（非 video 不画，与 doc-markdown 共存一槽）。"
```

---

### Task 12: app-windows 插件（新建窗口入口）+ 多窗口手工验收

**Files:**
- Create: `src/plugins/app-windows/index.ts`
- Modify: `src/loader/table.ts`（登记行）
- Test: `tests/app-windows.test.ts`

**Interfaces:**
- Consumes: `WindowsService.create`、`FilesService.pickFolder`、`WorkspaceService.setRoot`、`SlotsService.register("topbar.left")`。
- Produces: 模块表行 `"app-windows"`（defaults `{}`）；顶栏两个按钮——"新建窗口"（带当前 root，无则空）、"打开文件夹…"（换当前窗口的 root）。

- [ ] **Step 1: 写失败测试**

`tests/app-windows.test.ts`：

```ts
// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { apply } from "../src/plugins/app-windows";

test("DOM: 新建窗口传当前 root；打开文件夹走 pickFolder+setRoot", async () => {
  const created: Array<string | undefined> = [];
  const setRoot = vi.fn();
  const windows = { create: vi.fn(async (root?: string) => { created.push(root); return "win-2"; }) };
  const files = { pickFolder: vi.fn(async () => "/picked") };
  const workspace = { root: "/x", setRoot };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ windows, files, workspace, slots } as never, {});
  const [newBtn, openBtn] = [...document.querySelectorAll<HTMLButtonElement>("button")];
  newBtn.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(created).toEqual(["/x"]);
  openBtn.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(files.pickFolder).toHaveBeenCalled();
  expect(setRoot).toHaveBeenCalledWith("/picked");
});
```

Run: `pnpm test -- app-windows` → FAIL。

- [ ] **Step 2: 实现**

`src/plugins/app-windows/index.ts`：

```ts
import type { Context } from "cordis";

export const name = "app-windows";
export const inject = ["files", "windows", "workspace", "slots"];

/** Topbar entries: new window (carrying the current root) and open-folder. */
export function apply(ctx: Context): () => void {
  return ctx.slots.register("topbar.left", (el) => {
    const newBtn = document.createElement("button");
    newBtn.type = "button";
    newBtn.textContent = "新建窗口";
    newBtn.addEventListener("click", () => void ctx.windows.create(ctx.workspace.root ?? undefined));
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = "打开文件夹…";
    openBtn.addEventListener("click", async () => {
      const root = await ctx.files.pickFolder();
      if (root) ctx.workspace.setRoot(root);
    });
    el.append(newBtn, openBtn);
  });
}
```

`src/loader/table.ts` 登记（`import * as appWindows from "../plugins/app-windows";`）：

```ts
Object.assign(MODULE_TABLE, {
  "app-windows": { plugin: appWindows as PluginModule, defaults: {} },
});
```

- [ ] **Step 3: 跑测试 + 多窗口手工验收** — Run: `pnpm test -- app-windows` → PASS；`pnpm tauri dev` 验收清单：
  1. 顶栏"新建窗口"→ 第二窗口出现，自动打开与第一窗口相同 root，树渲染；
  2. 第二窗口"打开文件夹…"换别的目录 → 两窗口互不影响；
  3. 窗口 A 编辑保存 → 窗口 B 同 root 的树重读（fs://changed 广播）；
  4. 窗口 A 改文件不保存关窗 → 确认框；确认后 `win://closed` 广播、注册表清理（重开应用只剩主窗口）。

- [ ] **Step 4: Commit**

```bash
git add src/plugins/app-windows/ src/loader/table.ts tests/app-windows.test.ts
git commit -m "app-windows：新建窗口与打开文件夹入口

多窗口闭环补全：新建带当前 root（VS Code 习惯），
每窗口可独立换目录；功能面至此覆盖 Phase 1 验收清单。"
```

---

### Task 13: 门禁 verify-dep-audit（依赖面审计）

**Files:**
- Create: `scripts/verify-dep-audit.mjs`、`scripts/dep-allowlist.json`、`scripts/__fixtures__/dep-audit/`（clean 与 dirty 两组：package.json + node_modules/sample/index.js）
- Modify: `package.json`（scripts：`verify:dep-audit`）、`scripts/run-gates.mjs`（LEAVES + doc-sync/release 档）、`AGENTS.md`（命令清单）
- Test: `scripts/verify-dep-audit.spec.mjs`

**Interfaces:**
- Consumes: 无。
- Produces: `pnpm verify:dep-audit`——① `dependencies` 与白名单精确互 diff（新增未登记红、登记未用也红——白名单必须精确）；② 直连依赖的安装目录扫 `node:` 内建引用（`.js/.cjs/.mjs`，跳过 `.d.ts/.map`），命中红并点名文件与匹配串。导出 `auditDependencies(pkgJson, allowlist, nodeModulesDir)` 供自测试。

- [ ] **Step 1: 写失败自测试**

`scripts/verify-dep-audit.spec.mjs`：

```js
import { expect, test } from "vitest";
import { auditDependencies } from "./verify-dep-audit.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fx = (n) => path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__/dep-audit", n);

test("clean fixture 通过", () => {
  const r = auditDependencies(
    { dependencies: { sample: "1.0.0" } },
    ["sample"],
    fx("clean/node_modules"),
  );
  expect(r.errors).toEqual([]);
});

test("dirty fixture: 未登记依赖 + node: 引用点名", () => {
  const r = auditDependencies(
    { dependencies: { sample: "1.0.0", sneaky: "2.0.0" } },
    ["sample"],
    fx("dirty/node_modules"),
  );
  expect(r.errors.some((e) => e.includes("sneaky") && e.includes("未登记"))).toBe(true);
  expect(r.errors.some((e) => e.includes("node:fs") && e.includes("sample"))).toBe(true);
});

test("白名单过期（登记未用）也红", () => {
  const r = auditDependencies({ dependencies: {} }, ["sample"], fx("clean/node_modules"));
  expect(r.errors.some((e) => e.includes("过期"))).toBe(true);
});
```

fixtures：`clean/node_modules/sample/index.js` 内容 `export const x = 1;`；`dirty/node_modules/sample/index.js` 内容 `import { readFileSync } from "node:fs"; export const x = readFileSync;`。

Run: `pnpm test -- verify-dep-audit` → FAIL（模块不存在）。

- [ ] **Step 2: 实现**

`scripts/dep-allowlist.json`：

```json
{
  "//": "dependencies 白名单（精确集合：多登少登都红）。vendor/ 的 cordis、cosmokit 不在此——它们不走 package.json。",
  "deps": [
    "@tauri-apps/api",
    "@tauri-apps/plugin-dialog",
    "markdown-it",
    "@codemirror/state",
    "@codemirror/view",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lang-markdown",
    "codemirror"
  ]
}
```

`scripts/verify-dep-audit.mjs`：

```js
#!/usr/bin/env node
// 依赖面审计（环境无关铁律的机械背书）：白名单精确 diff + 直连依赖包内 node: 内建引用扫描。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const NODE_REF = /(["'])node:[a-z][\w.-]*\1/g;
const SCAN_EXTS = new Set([".js", ".cjs", ".mjs"]);

/** Core audit: pure, fixture-testable. */
export function auditDependencies(pkgJson, allowlist, nodeModulesDir) {
  const errors = [];
  const deps = Object.keys(pkgJson.dependencies ?? {});
  for (const dep of deps) {
    if (!allowlist.includes(dep)) errors.push(`依赖未登记白名单：${dep}（登记 scripts/dep-allowlist.json 并在 PR 说明理由）`);
  }
  for (const entry of allowlist) {
    if (!deps.includes(entry)) errors.push(`白名单过期：${entry} 已不在 dependencies`);
  }
  for (const dep of deps) {
    const dir = path.join(nodeModulesDir, dep);
    if (!existsSync(dir)) { errors.push(`依赖目录缺失：${dir}（先 pnpm install）`); continue; }
    for (const hit of scanNodeRefs(dir)) errors.push(`node: 内建引用：${hit.file} → ${hit.match}`);
  }
  return { errors };
}

function* walkFiles(dir) {
  for (const entry of readDirSafe(dir)) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(p);
    else if (SCAN_EXTS.has(path.extname(entry.name))) yield p;
  }
}

function readDirSafe(dir) {
  try { return [...readdirSync(dir, { withFileTypes: true })]; } catch { return []; }
}

function scanNodeRefs(dir) {
  const hits = [];
  for (const file of walkFiles(dir)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(NODE_REF)) hits.push({ file: path.relative(dir, file), match: m[0] });
  }
  return hits;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(path.dirname(new URL(".", import.meta.url).pathname), "..");
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const allowlist = JSON.parse(readFileSync(new URL("./dep-allowlist.json", import.meta.url), "utf8")).deps;
  const { errors } = auditDependencies(pkg, allowlist, path.join(root, "node_modules"));
  if (errors.length) {
    console.error(`[dep-audit] 依赖面审计失败（${errors.length} 项）：`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log("[dep-audit] 依赖面审计通过");
}
```

- [ ] **Step 3: 接线 + 自测试过**

`package.json` scripts 加 `"verify:dep-audit": "node scripts/verify-dep-audit.mjs"`；`scripts/run-gates.mjs` 的 `LEAVES` 加 `"dep-audit"`，`doc-sync` 与 `release` 档都含它。`AGENTS.md` 命令清单加 `pnpm verify:dep-audit` 一行。

Run: `pnpm test -- verify-dep-audit` → PASS；`pnpm verify:dep-audit` → 通过（真实仓库面）。

- [ ] **Step 4: Commit**

```bash
git add scripts/ package.json AGENTS.md
git commit -m "门禁 verify-dep-audit：依赖白名单精确 diff + node: 引用扫描

铁律的机械背书第一步：dependencies 与白名单互为精确集合，
直连依赖装进产物前先过 node: 内建引用扫描；
自测试用 clean/dirty fixture 锁真阳与假阳。"
```

---

### Task 14: 门禁 verify-layering（分层纪律 + 装载缝扫描）

**Files:**
- Create: `scripts/verify-layering.mjs`、`scripts/layering-allowlist.json`（Phase 1 为空数组）
- Modify: `package.json`（scripts：`verify:layering`）、`scripts/run-gates.mjs`（LEAVES + doc-sync/release 档）、`AGENTS.md`（命令清单）
- Test: `scripts/verify-layering.spec.mjs`

**Interfaces:**
- Consumes: 无。
- Produces: `pnpm verify:layering`——① `src/plugins/**` 非类型 import `@tauri-apps/*` 或 `../host`/`../../host` 值导入即红；② `src/**`（含 vendor 除外——vendor 不在 src/）出现动态 `import(` / `eval(` / `new Function(` 即红，豁免只认 `scripts/layering-allowlist.json`（空 = 零缝）。导出 `scanPluginSource(relPath, code)` 与 `scanLoadingSeams(relPath, code, allowlist)` 供自测试。

- [ ] **Step 1: 写失败自测试**

`scripts/verify-layering.spec.mjs`：

```js
import { expect, test } from "vitest";
import { scanPluginSource, scanLoadingSeams } from "./verify-layering.mjs";

test("插件层: @tauri-apps 值导入红、type 导入放行", () => {
  expect(scanPluginSource("src/plugins/a/index.ts", `import { invoke } from "@tauri-apps/api/core";`).length).toBe(1);
  expect(scanPluginSource("src/plugins/a/index.ts", `import type { Foo } from "@tauri-apps/api/core";`).length).toBe(0);
});

test("插件层: host 值导入红、type 导入放行", () => {
  expect(scanPluginSource("src/plugins/a/index.ts", `import { FilesService } from "../../host/files";`).length).toBe(1);
  expect(scanPluginSource("src/plugins/a/index.ts", `import type { FilesService } from "../../host/files";`).length).toBe(0);
});

test("装载缝: 动态 import / eval / new Function 红；白名单文件放行", () => {
  expect(scanLoadingSeams("src/x.ts", `const m = await import("./y");`, []).length).toBe(1);
  expect(scanLoadingSeams("src/x.ts", `eval(code);`, []).length).toBe(1);
  expect(scanLoadingSeams("src/x.ts", `new Function("return 1");`, []).length).toBe(1);
  expect(scanLoadingSeams("src/allowed.ts", `const m = await import("./y");`, ["src/allowed.ts"]).length).toBe(0);
  // 注释里的词不算（粗剪枝后仍以整词匹配）
  expect(scanLoadingSeams("src/x.ts", `// we do not use import( here`, []).length).toBe(0);
});
```

Run: `pnpm test -- verify-layering` → FAIL。

- [ ] **Step 2: 实现**

`scripts/layering-allowlist.json`：

```json
{
  "//": "动态装载缝白名单（相对仓库根路径）。Phase 1 为空：零动态加载；Phase 2 外置插件装载时才开单条缝。",
  "files": []
}
```

`scripts/verify-layering.mjs`：

```js
#!/usr/bin/env node
// 分层纪律扫描：src/plugins/** 禁值导入 @tauri-apps/* 与 host 实现；src/** 禁动态装载（import()/eval/new Function）。
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const IMPORT_FROM = /import\s+(type\s+)?[^"';]*?from\s*["']([^"']+)["']/g;
const REQUIRE = /require\(\s*["']([^"']+)["']\s*\)/g;
const SEAMS = [
  { name: "动态 import()", re: /(?<![.\w])import\s*\(/g },
  { name: "eval(", re: /(?<![.\w])eval\s*\(/g },
  { name: "new Function(", re: /new\s+Function\s*\(/g },
];

/** Plugin-layer scan: value imports of @tauri-apps/* or ../host are violations. */
export function scanPluginSource(relPath, code) {
  const violations = [];
  for (const m of code.matchAll(IMPORT_FROM)) {
    const [, isType, spec] = m;
    if (isType) continue;
    if (spec.startsWith("@tauri-apps/")) violations.push(`${relPath}: 值导入 ${spec}（插件只能经 ctx.* 宿主服务）`);
    if (/(\.\.\/)+host(\/|$)/.test(spec)) violations.push(`${relPath}: 值导入宿主实现 ${spec}（import type 放行）`);
  }
  for (const m of code.matchAll(REQUIRE)) {
    if (m[1].startsWith("@tauri-apps/") || /(\.\.\/)+host(\/|$)/.test(m[1])) {
      violations.push(`${relPath}: require ${m[1]}`);
    }
  }
  return violations;
}

/** Loading-seam scan: dynamic import/eval/new Function in src/**, minus allowlist. */
export function scanLoadingSeams(relPath, code, allowlist) {
  if (allowlist.includes(relPath)) return [];
  const violations = [];
  const noComments = code.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const seam of SEAMS) {
    if (seam.re.test(noComments)) violations.push(`${relPath}: ${seam.name}`);
  }
  return violations;
}

function* walkTs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkTs(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) yield p;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(path.dirname(new URL(".", import.meta.url).pathname), "..");
  const allowlist = JSON.parse(readFileSync(new URL("./layering-allowlist.json", import.meta.url), "utf8")).files;
  const violations = [];
  const srcDir = path.join(root, "src");
  const pluginsDir = path.join(srcDir, "plugins");
  for (const file of walkTs(srcDir)) {
    const rel = path.relative(root, file);
    const code = readFileSync(file, "utf8");
    violations.push(...scanLoadingSeams(rel, code, allowlist));
    if (rel.startsWith("src/plugins/") || rel === "src/plugins") {
      violations.push(...scanPluginSource(rel, code));
    }
  }
  if (violations.length) {
    console.error(`[layering] 分层/装载缝扫描失败（${violations.length} 项）：`);
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }
  console.log("[layering] 分层纪律与装载缝扫描通过");
}
```

- [ ] **Step 3: 接线 + 自测试过**

`package.json` scripts 加 `"verify:layering": "node scripts/verify-layering.mjs"`；`run-gates.mjs` LEAVES 加 `"layering"`（doc-sync 与 release 档）；`AGENTS.md` 命令清单加一行。

Run: `pnpm test -- verify-layering` → PASS；`pnpm verify:layering` → 通过（真实仓库面——本任务同时验证 Phase 1 的代码确实零缝）。

- [ ] **Step 4: Commit**

```bash
git add scripts/ package.json AGENTS.md
git commit -m "门禁 verify-layering：分层纪律 + 装载缝扫描

'插件只经宿主服务'从惯例升级为机械约束（type 导入放行）；
src/ 零动态装载：白名单为空数组本身就是断言，
Phase 2 开缝必须改这份 JSON——豁免有唯一登记处。"
```

---

### Task 15: 门禁 verify-native-links（otool/ldd 动态链接扫描）+ 门禁接线收口

**Files:**
- Create: `scripts/verify-native-links.mjs`
- Modify: `package.json`（scripts：`verify:native-links`）、`scripts/run-gates.mjs`（LEAVES + release 档）、`scripts/route-gates.mjs`（ROUTES 三条新改动面）、`AGENTS.md`（命令清单）、`scripts/gate-coverage.spec.mjs`、`scripts/ci-wiring.spec.mjs`（期望更新）
- Test: `scripts/verify-native-links.spec.mjs`

**Interfaces:**
- Consumes: 发布产物（`src-tauri/target/release/bundle/`；缺失时**提示跳过**退 0——只在 release 档跑，产物由 `pnpm tauri build` 先行产生）。
- Produces: `pnpm verify:native-links`——darwin 对 `.app/Contents/MacOS/*` 跑 `otool -L`，白名单前缀 `/usr/lib/` `/System/` `@rpath/` `@executable_path`；linux 对 bundle 内可执行文件跑 `ldd`，白名单集合 = 系统 C 运行时库；win32 显式跳过提示（当前不发 Windows 档，发版前补扫）。导出 `parseOtool(output)` / `auditDarwinLinks(lines)` / `auditLinuxLinks(lines)` 供自测试。收掉 environment-independence.md 已知欠账里的"缺 otool/ldd 扫描"。

- [ ] **Step 1: 写失败自测试**

`scripts/verify-native-links.spec.mjs`：

```js
import { expect, test } from "vitest";
import { parseOtool, auditDarwinLinks, auditLinuxLinks, LINUX_LIBS } from "./verify-native-links.mjs";

const otoolSample = `/path/to/StudyWiki.app/Contents/MacOS/studywiki:
\t/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit (compatibility version 45.0.0)
\t/usr/lib/libc++.1.dylib (compatibility version 1.0.0)
\t@rpath/libTauri.dylib (compatibility version 1.0.0)
\t@executable_path/../Frameworks/libWebView.dylib (compatibility version 1.0.0)
\t/opt/homebrew/lib/libshark.dylib (compatibility version 3.0.0)
`;

test("parseOtool 抬出依赖行", () => {
  expect(parseOtool(otoolSample)).toHaveLength(5);
});

test("darwin: 白名单前缀放行，homebrew 路径红", () => {
  const bad = auditDarwinLinks(parseOtool(otoolSample));
  expect(bad).toEqual([expect.stringContaining("/opt/homebrew/lib/libshark.dylib")]);
});

test("linux: 系统 C 运行时放行，其他 so 红", () => {
  const lines = ["libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6", "libssh.so.4 => /usr/lib/libssh.so.4"];
  const bad = auditLinuxLinks(lines);
  expect(bad).toEqual([expect.stringContaining("libssh.so.4")]);
  expect(LINUX_LIBS.has("libc.so.6")).toBe(true);
});
```

Run: `pnpm test -- verify-native-links` → FAIL。

- [ ] **Step 2: 实现**

`scripts/verify-native-links.mjs`：

```js
#!/usr/bin/env node
// 发布产物动态链接扫描：darwin otool / linux ldd（win32 显式跳过提示）。环境无关铁律的产物侧背书。
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** darwin 链接白名单前缀（@rpath/@executable_path 视为包内）。 */
export const DARWIN_PREFIXES = ["/usr/lib/", "/System/", "@rpath/", "@executable_path"];
/** linux 系统运行时库白名单（so 名精确匹配）。 */
export const LINUX_LIBS = new Set([
  "libc.so.6", "libgcc_s.so.1", "libm.so.6", "libpthread.so.0",
  "libdl.so.2", "ld-linux-x86-64.so.2", "ld-linux-aarch64.so.1", "linux-vdso.so.1",
]);

/** Lift dependency lines out of `otool -L` output (drop the header line). */
export function parseOtool(output) {
  return output.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
}

/** Darwin audit: any line not starting with an allowed prefix is bad. */
export function auditDarwinLinks(lines) {
  return lines.filter((l) => !DARWIN_PREFIXES.some((p) => l.startsWith(p)));
}

/** Linux audit: so names outside the system set are bad. */
export function auditLinuxLinks(lines) {
  return lines
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((name) => name.endsWith(".so") || /\.so\./.test(name))
    .filter((name) => !LINUX_LIBS.has(name));
}

/** Collect scannable binaries: darwin = every .app/Contents/MacOS file;
 * linux = the raw release binary (same link set as the deb/AppImage payload). */
function collectBinaries(root, bundleDir) {
  const out = [];
  const macosDir = path.join(bundleDir, "macos");
  if (existsSync(macosDir)) {
    for (const app of readdirSync(macosDir).filter((n) => n.endsWith(".app"))) {
      const binDir = path.join(macosDir, app, "Contents/MacOS");
      if (!existsSync(binDir)) continue;
      for (const f of readdirSync(binDir, { withFileTypes: true })) {
        if (f.isFile()) out.push(path.join(binDir, f.name));
      }
    }
  }
  // linux：productName 归一化（StudyWiki → studywiki）定位裸二进制
  const conf = JSON.parse(readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const binName = String(conf.productName ?? "studywiki").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const linuxBin = path.join(root, "src-tauri/target/release", binName);
  if (process.platform === "linux" && existsSync(linuxBin)) out.push(linuxBin);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.platform === "win32") {
    console.log("[native-links] win32：显式跳过（未发 Windows 档；发版前补扫并更新本提示）");
    process.exit(0);
  }
  const root = path.resolve(path.dirname(new URL(".", import.meta.url).pathname), "..");
  const bundleDir = path.join(root, "src-tauri/target/release/bundle");
  const binaries = collectBinaries(root, bundleDir);
  if (binaries.length === 0) {
    console.log("[native-links] 跳过：未找到发布产物（先 pnpm tauri build；release 档在其后运行）");
    process.exit(0);
  }
  const bad = [];
  for (const bin of binaries) {
    const out = execFileSync(process.platform === "darwin" ? "otool" : "ldd", ["-L", bin], { encoding: "utf8" });
    const violations = process.platform === "darwin" ? auditDarwinLinks(parseOtool(out)) : auditLinuxLinks(out.split("\n"));
    for (const v of violations) bad.push(`${bin} → ${v}`);
  }
  if (bad.length) {
    console.error(`[native-links] 动态链接扫描失败（${bad.length} 项）：`);
    for (const b of bad) console.error(`  - ${b}`);
    process.exit(1);
  }
  console.log(`[native-links] 动态链接扫描通过（${binaries.length} 个产物）`);
}
```

- [ ] **Step 3: 接线**

- `package.json` scripts：`"verify:native-links": "node scripts/verify-native-links.mjs"`。
- `run-gates.mjs`：LEAVES 加 `"native-links"`；**仅 release 档**含它（doc-sync 不跑——需要构建产物）。
- `route-gates.mjs` ROUTES 追加三条：

```js
{ match: ["package.json", "pnpm-lock.yaml"], commands: ["pnpm verify:dep-audit"], reason: "依赖面变化必过白名单审计" },
{ match: ["src/plugins/", "src/host/", "src/loader/"], commands: ["pnpm verify:layering"], reason: "分层纪律相关面" },
{ match: ["src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"], commands: ["pnpm verify:native-links"], reason: "产物链接面变化（需先 build）" },
```

- `AGENTS.md` 命令清单补 `pnpm verify:dep-audit` / `pnpm verify:layering` / `pnpm verify:native-links` 三行。
- 更新 `scripts/gate-coverage.spec.mjs` 与 `scripts/ci-wiring.spec.mjs` 的期望（新叶进 LEAVES、release 档组合、ROUTES 条数）——先读这两个 spec 的现有断言再改，保持风格一致。

- [ ] **Step 4: 跑全部门禁自测试** — Run: `pnpm test` → PASS（含三个新 spec 与更新后的两个旧 spec）；`pnpm lint:docs` → 通过。

- [ ] **Step 5: Commit**

```bash
git add scripts/ package.json AGENTS.md
git commit -m "门禁 verify-native-links + 门禁接线收口

otool/ldd 扫发布产物动态链接（环境无关铁律产物侧，
收掉 environment-independence 已知欠账）；
三个新门禁进 run-gates 档位与 route:gates 改动面映射，
命令清单与门禁自测试同步。"
```

---

### Task 16: 文档连锁收口（铁律修订 / 架构重写 / code-map / Note 转 implemented）

**Files:**
- Modify: `docs/environment-independence.md` + `.en.md` + `.i18n.yaml`（条款修订 + 豁免预登 + 欠账更新）
- Modify: `docs/architecture.md` + `.en.md` + `.i18n.yaml`（组成树/数据流/type-equiv 围栏 FileNode）
- Modify: `scripts/code-map.manifest.json` → 跑 `pnpm gen:code-map`
- Modify: `AGENTS.md`（惯例新增一行：插件只经宿主服务触达系统能力）
- Move: `.agents/notes/proposed/architecture/2026-09-10-plugin-architecture{,.en}.md` → `implemented/`，Status 改 `implemented`
- Modify: 对应 `.i18n.yaml` 重录

**Interfaces:**
- Consumes: Task 1-15 的全部落地事实（文件结构、命令面、门禁名）。
- Produces: `pnpm verify:docs` 全绿 + Phase 1 手工验收完成。

- [ ] **Step 1: environment-independence.md 三件套修订**

按获批 Note"铁律修订与门禁"节逐条落：
- 条款 2 主体收窄："核心与内置插件构建期打包，运行全程离线"；
- 条款 3 改"同一版本 + 同一插件集 → 行为一致"；
- 新增外置插件条款（现在立、Phase 2 生效：安装动作可联网且仅限 registry tarball 直拉，运行离线，预打包零依赖单文件，宿主拒载其他形态）；
- 豁免登记表预登一行"外置插件安装联网（Phase 2 启用）"附 Note 链接；
- 已知欠账区：删除"缺 otool/ldd 扫描"（Task 15 已收），新增"assetProtocol scope 待收紧（Phase 2 前置）"与"CSP/自定义协议装载通道技术验证（Phase 2 排期）"。
- 词数盯预算（当前上限 720）：先压缩后提额，若提额在 PR 说明理由。英文侧镜像同一结构，`pnpm record:i18n -- docs/environment-independence.md` 重录。

- [ ] **Step 2: architecture.md 三件套重写**

- 组成区：源码树更新为 `host/ loader/ plugins/{app-shell,app-windows,view-filetree,doc-markdown,doc-video}` + `vendor/`；
- 数据流：树读取（read_tree → FilesService → view-filetree）、文档打开（openFile → doc-markdown → readText/writeText → fs://changed → 各窗口树重读）、窗口创建（app-windows → create_window → 注册表 → 新 webview bootstrap）；
- type-equiv 围栏：`LibraryEntry` 换 `FileNode`（与 `src/types.ts` 逐字等价）；
- 关键决策表加：vendored cordis（取契约弃装载器）、分层纪律、静态模块表 + 清单装载。
- `pnpm record:i18n -- docs/architecture.md` 重录。

- [ ] **Step 3: code-map 生成区重建**

`scripts/code-map.manifest.json` 登记：`src/main.ts`、`src/bootstrap.ts`、`src/types.ts`、`src/host/*.ts`（4 条）、`src/loader/*.ts`（4 条）、`src/plugins/<name>/index.ts`（5 条）、`vendor/` **单条聚合**（描述记上游 fork commit 与 VENDORED.md 指针）。跑 `pnpm gen:code-map`（双侧生成区自动写）。

- [ ] **Step 4: AGENTS.md 惯例 + Note 转 implemented**

- AGENTS.md 惯例区加一行："插件只经宿主服务触达系统能力（`src/plugins/` 禁 import `@tauri-apps/*`，`pnpm verify:layering` 机械校验）"。
- `git mv .agents/notes/proposed/architecture/2026-09-10-plugin-architecture{,.en}.md .agents/notes/implemented/architecture/`；两侧 `Status: proposed` → `Status: implemented`；Note 里"本 Note 落地 implemented 时同步 environment-independence.md 的登记行"一句已兑现，可在正文 Consequences 尾注一行（中文侧与英文侧同构）。`pnpm record:i18n -- .agents/notes/implemented/architecture/2026-09-10-plugin-architecture.md` 重录（路径变了，yaml 记录同步）。

- [ ] **Step 5: 全量门禁 + 手工验收清单**

Run: `pnpm verify:docs` → 全绿（十三叶全过，含新三叶）。
手工验收（`pnpm tauri dev`，对照获批 Note 测试策略节的清单）：
1. 新建窗口与多窗口并存；2. 每窗口独立开文件夹；3. 关窗脏文档确认；4. 树展开/折叠/点开 md；5. 编辑高亮；6. 预览切换保文本；7. 保存后跨窗口树刷新；8. 视频播放不回退；9. 首启清单自动生成（删掉 app 配置目录 plugins.json 再启动验证）。

- [ ] **Step 6: Commit**

```bash
git add docs/ scripts/code-map.manifest.json AGENTS.md .agents/notes/
git commit -m "插件化 Phase 1 文档收口：铁律修订 + 架构重写 + Note 转 implemented

环境无关条款按获批方向修订并预登 Phase 2 豁免；
architecture 换 FileNode 围栏与插件化数据流；
code-map 收编 vendor 单条聚合；
门禁、惯例、三件套重录全绿，Phase 1 落地。"
```

---

## 执行完后的形态

- `pnpm test`（含三个新门禁自测试）、`pnpm verify:docs`（含 dep-audit/layering 叶）全绿；
- 手工验收清单九项通过；
- proposed Note 转 implemented，环境无关唯一 home 完成条款修订与豁免预登；
- Phase 2（registry 直拉、外置插件装载、apiVersion 校验）在获批 Note 中已有形状，另起分支另立计划。
