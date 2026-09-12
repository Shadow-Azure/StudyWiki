# Agent Note: Plugin architecture: cordis contract + dual-habitat plugins

Status: implemented

English | [中文](2026-09-10-plugin-architecture.md)

## Problem

StudyWiki must grow from a small single-window two-layer app (a ~60-line frontend, two Rust commands) into a multi-window client with a file tree, markdown edit/preview, and later video and AI capabilities; it needs a sustainable way to develop extensions. The hard constraint at the same time demands a product with zero preinstalled runtimes, fully offline, behaviorally consistent. The decision: which plugin mechanism carries extension development — one that coexists with the environment-independence constraint for the long haul, not merely "no conflict today" but structurally incapable of betraying it later.

## Decision

The whole project is developed on the cordis v4 plugin contract: a plugin is the `name` / `inject` / `apply` triad, services occupy `ctx.<key>`, every registration is a reversible effect, and Fiber owns the lifecycle. **Take the contract, drop the loader** — plugin-loader / plugin-include / plugin-hmr bind to Node APIs (fs, the internal ESM loader, chokidar) and are not used; composition becomes manifest + static module table + a hundred-line loader (the skeleton of DSH's browser-side static module table precedent). cordis is vendored from our own fork (Shadow-Azure/cordis, v4.0.0-rc.10), so the `dependencies` section has zero cordis entries. The layering discipline is made physical: plugins reach system capabilities only through host services, and `src/plugins/` must not import `@tauri-apps/*` (mechanically checked by a gate).

Plugins come in two habitats: **built-in plugins** are statically compiled into the bundle as ordinary repo modules (all Phase 1 features take this path; the author is this repo's developer, so no publish step); **external plugins** (Phase 2) are pre-bundled zero-dependency single files, installed via Rust-side registry direct fetch (fetch metadata → download tgz → verify sha512 → unpack → place into the plugin directory; no npm/pnpm/Node at any point) or local file import, and published through the author-side `npm publish` with prepublishOnly auto-build. Both habitats share the same contract and the same host API surface. Reference points: DSH for the contract and the static-loading precedent; VS Code for the offline distribution shape (pre-bundled extensions, host-injected API, optional marketplace); Obsidian as the cautionary tale of in-process full privilege.

### Phase split

- **Phase 1** (`multi-window-file-tree` branch): vendored cordis, host service layer, loader, all built-in plugins (multi-window / file tree / markdown edit-preview / video), gates and doc ripple. The product contains no external-plugin capability.
- **Phase 2** (separate branch): registry direct fetch + local import + external plugin load validation (apiVersion, zero-dependency format checks).
- **Phase 3+** (door only): an optional runtime provider (e.g. a Node sidecar) is designed as a pluggable-service interface, not implemented, triggered by a real plugin need.

### Layering and window model

The Rust shell is global (one per app); the frontend is one per window; global state lives in Rust, window state lives in each window's cordis Context:

```text
┌─ Rust 壳（src-tauri，全应用单份）──────────────────────────┐
│  文件服务：目录树扫描、读文件、写文件（新增）                  │
│  窗口注册表：label → root，谁开着、开的是哪个文件夹            │
│  （Phase 2）插件包管理：registry 直拉、校验、解压、目录管理     │
└──────────── Tauri 命令 + 事件（IPC）──────────────────────┘
                         ↕
┌─ 前端（src/，每个窗口一份独立实例）─────────────────────────┐
│  vendor/cordis（Context/Fiber/Registry，从 fork 收编）        │
│  宿主服务层：files / windows / workspace / slots             │
│    —— 全前端唯一有权 import @tauri-apps/* 的层                │
│  装载器：清单(JSON) → 静态模块表 → ctx.plugin() → 激活审计    │
│  内置插件：文件树、markdown 文档、视频查看器、窗口管理……      │
│  UI：原生 DOM + 类型化 slot 注册表（无 UI 框架，遵惯例）       │
└────────────────────────────────────────────────────────────┘
```

Three structural disciplines: **one-way dependency** (plugin → host service → Tauri API → Rust); **global lives in Rust, window lives in the Context** (rule of thumb: should this state disappear when one window closes? yes → window scope, no → Rust is the authority); **composition is data** (which plugins are enabled and with what config is driven by the manifest; the loader is just a manifest executor, and Phase 2 only adds one module source).

Multi-window mechanics: every webview loads the same bundle and bootstraps itself — take the current window label → Rust `get_window_state(label)` fetches the root → create the Context and attach the four host services → the loader runs the manifest → audit and render. New windows are created by a Rust command (generate label, register, create the WebviewWindow); the registry is the single authority for roots and survives reload. Windows never shake hands directly; synchronization goes only through the Rust event bus:

| Event | Trigger | Consumers |
|---|---|---|
| `fs://changed {path}` | Rust broadcasts after a write lands (including the writer itself) | every file tree holding the same root re-reads that directory |
| `win://closed {label}` | when Rust cleans the registry | any UI needing the "open windows" notion (reserved in Phase 1) |

Closing a window kills that webview's JS world (the cordis tree dies with it); Rust cleans the registry on window destruction. A close with dirty documents prompts for confirmation (frontend interception suffices); saving is manual Ctrl+S with a dirty marker; autosave is out. Error handling has three tiers: fail-loud load audit at startup (naming "plugin X awaiting service Y"); at runtime a failed plugin fiber rolls back its registrations automatically while the rest live on and its slots go empty; Rust command errors surface verbatim with inline UI display.

### Components and the host API surface

```text
src/
  main.ts                # 每窗口 bootstrap
  host/                  # files.ts windows.ts workspace.ts slots.ts
  loader/                # manifest.ts table.ts boot.ts
  plugins/
    app-shell/           # 基础布局：顶栏/侧栏容器/主区容器（slot 宿主）
    app-windows/         # 新建窗口入口
    view-filetree/       # 侧栏文件树：展开折叠、点击打开
    doc-markdown/        # CodeMirror 6 编辑 + markdown-it 预览 + 切换 + 保存
    doc-video/           # 视频查看器（保留现有能力）
  vendor/                # cordis + cosmokit，tsconfig paths 映射
```

Four host services (signatures finalized in the implementation plan, all with contract doc comments): `ctx.files` — `readTree(root)` returning `FileNode{name,path,kind,children?}` (kind decided in Rust, single decision point for extension dispatch), `readText`, `writeText`, `pickFolder()` (wraps the dialog), `assetUrl(path)` (wraps convertFileSrc), `onChanged` events; `ctx.windows` — `create({root?})`, `current()`, `onClosed`; `ctx.workspace` — window-scoped `root` / `activeFile` / `openFile(path)` and change events; `ctx.slots` — a typed UI slot registry (contracts registered via TS declaration merging; the vanilla-DOM version of DSH's SlotMap). A slot is an ordered renderer list where each renderer decides its own visibility (does not paint for kinds it does not handle), avoiding single-slot competition. `LibraryEntry` is upgraded to `FileNode`.

Built-in plugins and dependencies: `app-shell` (inject slots; defines the `topbar.*` / `sidebar.tree` / `main.viewer` slots); `app-windows` (windows, slots); `view-filetree` (files, workspace, slots; click → `workspace.openFile`); `doc-markdown` (files, workspace, slots; subscribes to activeFile, mounts for kind=markdown); `doc-video` (same shape, feeds `<video>` via `files.assetUrl`).

The manifest lives in the app data directory (generated on first launch from the static table's defaults):

```json
{ "plugins": [
  { "id": "app-shell", "enabled": true, "config": {} },
  { "id": "view-filetree", "enabled": true, "config": { "ignoreDotfiles": true } }
] }
```

Load flow: read the manifest → resolve each row in the static module table → `ctx.plugin(plugin, config)` (ordering auto-resolved by `inject`, no manual choreography) → after the tree quiesces, audit every Fiber state row by row, fail-loud and named. Table entries absent from the manifest default to disabled ("turn off the video plugin" is flipping one `false`).

Rust command surface changes: add `read_tree` (recursive, replaces `list_library`, no coexistence), `write_text_file`, `create_window`, `get_window_state`; `read_text_file` stays.

### Iron-rule amendments and gates

[docs/environment-independence.en.md](../../../../docs/environment-independence.en.md) (the single home) is amended: clause 2 "fully offline" narrows its subject to "core and built-in plugins" build-time bundled, offline throughout; clause 3 "behavioral consistency" becomes "same version + same plugin set"; a new external-plugin clause is added (the rule is written now, effective in Phase 2): external plugins are user-installed local resources, the install action may go online and only via registry tarball direct fetch, after install everything runs offline, always pre-bundled zero-dependency single files — the host refuses any other shape; the exemption table pre-registers "external plugin install networking (enabled in Phase 2)" with a link to this Note.

New mechanical gates (all with self-tests in `pnpm test`): `verify-dep-audit` — dependency allowlist diff plus transitive-closure scan for `node:` builtin imports; any unregistered new dependency goes red. The layering scan — imports of `@tauri-apps/*` or host implementations under `src/plugins/` go red (type-only imports pass); any dynamic `import()` / `eval` / `new Function` in `src/` goes red (the loading-seam allowlist is empty in Phase 1 — zero dynamic loading; Phase 2 opens that single seam). `verify-native-links` — otool/ldd scan of release artifacts for dynamic links (closes a known debt, wired into the release mode). Gate wiring — `run-gates` mode combinations and the `route:gates` change-surface map updated in sync. Initial dependency allowlist: `@tauri-apps/api`, `@tauri-apps/plugin-dialog`, `markdown-it`, the CodeMirror family (`codemirror`, `@codemirror/lang-markdown`, `@codemirror/language-data`, etc. — pure ESM, zero runtime dependencies); cordis/cosmokit go through vendor and are naturally covered by source-level scans.

Doc ripple (watched automatically by existing gates): architecture.md composition rewritten, data flow updated, the type-equiv fence switched to `FileNode`; the commands.md generated region regenerated; code-map re-run with vendor registered as a single aggregated entry (recording the upstream commit, not per-file); AGENTS.md gains the convention "plugins reach system capabilities only through host services" plus the command list sync; affected resident docs get minimal patching of their bilingual trio plus re-record.

### Test strategy

Each layer tests only its own logic; the Tauri/webview boundary is mocked; real interactions go through manual acceptance. Rust (cargo test): `read_tree` fixture-tree assertions (nesting, mixed extensions, dotfiles, empty directories, case-insensitive sorting), `write_text_file` round-trip and error paths, extension-dispatch coverage, window-registry pure logic. Frontend (vitest): the loader (default manifest generation, row resolution, disabled skipping, unknown id fail-loud, named missing-injection audit — fake plugins + fake services), host-service thin wrappers (mocked invoke, locking parameter pass-through and error pass-through), the workspace state machine, doc-markdown mode-switch and dirty-flag pure logic. Gate self-tests: every new verify script gets true-positive/false-positive fixtures. Manual acceptance checklist (`pnpm tauri dev`): new-window creation and multi-window coexistence, independent folders per window, dirty-document close confirmation, tree expand/collapse/open md, editor highlighting, preview toggle, cross-window tree refresh after save, video playback not regressed. Implementation follows TDD red-green cycles.

## Alternatives considered

- **Minimal static (cordis as an npm dependency + a hand-written ctx.plugin chain)**: least machinery, but Phase 2 must retrofit the entry point with a loader; "built-ins only use the host API" has no mechanical constraint and inevitably rots; every rc-line upgrade is a dependency audit plus API migration. The hundreds of lines saved are repaid with interest in Phase 2.
- **Full port of the DSH assembly layer (loader/include/patch layers/profiles)**: maximal fidelity, but patch layers, profiles, and HMR are machinery for a dev-tool CLI; an end-user desktop app has almost no audience for them — imitation-driven YAGNI violation.
- **External plugins installed via npm/pnpm at runtime (DSH as-is)**: demands Node ≥22 + pnpm + network on the user machine — three direct hits against the iron rule; floating versions break behavioral consistency; postinstall arbitrary code execution without review.
- **Embedding a Node sidecar for plugins to reuse**: mechanically feasible (Tauri sidecar) and, being shipped with the product, not a violation of the amended rule; but +70–100MB per platform, unsandboxed arbitrary code execution (DSH's landlock sandbox is Linux-only; macOS/Windows equivalents are a deep pit), and dual-runtime maintenance. 95% of what Node does is covered by webview JS + host API, WASM, and Rust-side services; the only residual value is reusing ready-made Node-only npm packages. Rejected on security; the door stays open as a Phase 3+ pluggable service.
- **Pure local import (no registry download)**: safest, but gives up the distribution convenience of install-by-name; registry direct fetch takes "npm as a warehouse, not as a runtime" and gets both the convenience and zero runtime.
- **Starting the markdown editor on textarea, switching to CodeMirror later**: the saved effort is small, the textarea version is doomed, and the interface abstraction layer is pure sunk cost; CodeMirror 6 in one step is chosen (pure ESM, zero runtime dependencies, build-time bundleable — it passes the dependency-audit gate).

## Consequences

- **The host API discipline is a day-one cost**: built-in plugins go through `ctx.*` only from Phase 1 on; this is the precondition for Phase 2 external plugins to avoid reefs and cannot be retrofitted.
- **Vendor maintenance debt**: upgrading cordis means a manual diff with local patches explicitly registered (per DSH's vendoring discipline: intake list + traceable upstream commit); in exchange, immunity to rc drift and a zeroed dependency surface.
- **Known debts**: real-time watching of externally modified files is deferred (Phase 1 broadcasts only its own writes plus a manual-refresh fallback; notify is a Phase 2 candidate); tightening `assetProtocol.scope: ["**"]` is a precondition for opening external plugins in Phase 2; before Phase 2 starts, a CSP/custom-protocol loading-channel spike is needed (blob-URL fallback, low risk but scheduled).
- **Behavioral-consistency clause refined**: only same version + same plugin set guarantees consistency; user-side variation from external plugins is by design, backstopped by the apiVersion load-refusal mechanism.
- **Command surface change**: `list_library` retires (replaced by `read_tree`); the command catalog and type-equivalence fences update accordingly — normal gate flow.
- **The Phase 2 exemption is pre-registered at the rule level**: networking happens only during the "install external plugin" action; running stays offline; when this Note lands as implemented, the environment-independence.md registration row is synced.
- **The iron-rule amendments landed in sync with this Note becoming implemented**: the environment-independence.md clause 2/3 amendments, the external-plugin clause, the exemption pre-registration, and the debt updates are all in the sole home.
