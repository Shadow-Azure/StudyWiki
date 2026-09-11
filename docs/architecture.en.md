# Architecture

English | [中文](architecture.md)

> Type: reference | Tier: architecture map. Required reading before changing `src/` or `src-tauri/`. Rationale lives in the owning Agent Note.

## Composition

Multi-window Tauri 2 desktop app: one Rust shell for the whole app, one frontend instance per window (cordis Context + loader + built-in plugins); plugins reach system capabilities only through host services. Rationale: the [plugin-architecture Agent Note](../.agents/notes/implemented/architecture/2026-09-10-plugin-architecture.en.md).

<!-- BEGIN GENERATED code-map (scripts/gen-code-map.mjs) — do not edit between markers -->
```text
src/                               前端（TypeScript + Vite，无 UI 框架）
  bootstrap.ts                     每窗口启动流程：宿主服务入 ctx + 清单装载 + 插件激活（Tauri 绑定可注入）（→ files.ts、slots.ts、windows.ts、workspace.ts、boot.ts、manifest.ts、table.ts）
  host/context.d.ts                cordis Context 声明合并：files/windows/workspace/slots/plugins 五服务类型挂入（→ files.ts、plugins.ts、slots.ts、windows.ts、workspace.ts）
  host/emitter.ts                  极简类型化事件发射器（on 返回反订阅）
  host/files.ts                    文件服务：树/读写/选目录/asset URL + fs://changed 桥接（deps 可注入）（→ emitter.ts、types.ts）
  host/plugins.ts                  宿主插件包服务：安装/导入/列出/移除 + 清单读写 + loadModule（apiVersion 支持集 + 形状校验，deps 可注入）（→ external.ts、manifest.ts、types.ts）
  host/slots.ts                    类型化 UI 槽位注册表：注册序渲染、各自容器、反订阅移除（mount 归 shell 插件）
  host/windows.ts                  窗口服务：label/建窗/root 查询/确认框/关闭守卫（deps 可注入）
  host/workspace.ts                窗口 scope 工作区状态机：root/activeFile + root-changed/file-opened 事件流（→ emitter.ts、types.ts）
  loader/boot.ts                   装载器：清单行驱动 ctx.plugin + 全树激活审计（非 ACTIVE 点名）（→ manifest.ts、table.ts、types.ts）
  loader/external.ts               外置模块装载缝：全前端唯一动态 import 点（blob 通道，用后即回收）
  loader/manifest.ts               插件清单装载：缺失时从模块表生成默认并写回，损坏 fail-loud（→ table.ts）
  loader/table.ts                  静态模块表：id → 插件 + 默认配置（构建期单一 home，行随插件任务落地）（→ types.ts）
  loader/types.ts                  内置插件导出形状 PluginModule：(name, inject, apply) 三件套的结构子集
  main.ts                          入口：调用每窗口 bootstrap（三行）（→ bootstrap.ts、styles.css）
  plugins/app-shell/index.ts       app-shell 插件：topbar/sidebar/main 栅格 + 三槽容器挂载 + 无 root 欢迎态
  plugins/app-windows/index.ts     app-windows 插件：顶栏新建窗口（携带当前 root）与打开文件夹入口
  plugins/doc-markdown/editor.ts   doc-markdown CodeMirror 6 工厂：唯一 CodeMirror import 点（basicSetup + markdown 高亮 + Mod-s 键位），测试注入假工厂
  plugins/doc-markdown/index.ts    doc-markdown 插件：活动文件 markdown 预览/编辑双模式 + 脏标记 + Ctrl+S 保存 + 关窗守卫（file-opened 挂渲染，kind 不符清空）（→ editor.ts、mode.ts、preview.ts、types.ts）
  plugins/doc-markdown/mode.ts     doc-markdown 纯函数：文档状态机（open/edit/saved/toggle/dirty）
  plugins/doc-markdown/preview.ts  doc-markdown 纯函数：markdown-it 渲染（html:false，内嵌 HTML 转义）
  plugins/doc-video/index.ts       doc-video 插件：活动文件视频查看器（video controls + asset protocol 播放；file-opened 挂渲染，kind 不符清空）
  plugins/view-filetree/index.ts   view-filetree 插件：侧栏文件树 UI（展开折叠/点开文档/手动刷新/fs 变更重读）（→ tree.ts、types.ts）
  plugins/view-filetree/tree.ts    view-filetree 纯函数：点文件递归过滤 + 可见行铺平（深度优先、携带深度）（→ types.ts）
  styles.css                       样式（无逻辑）
  types.ts                         FileNode —— 前后端共享的唯一形状
src-tauri/                         Rust 壳
  lib.rs                           tauri::Builder + 文件命令 + 窗口事件接线（→ plugins.rs、windows.rs）
  main.rs                          入口壳（Windows 隐藏控制台）（→ lib.rs）
  plugins.rs                       外置插件命令面：package.json 封闭契约解析 + 扫描/读入口/删目录（app_config_dir/plugins）
  windows.rs                       窗口注册表（label→root）+ create/get 窗口命令 + plugins.json 清单 IO
vendor/                            vendored 上游源码：cordis（Shadow-Azure fork，上游 f8ea3cd）+ cosmokit，收编清单见 vendor/VENDORED.md
```
<!-- END GENERATED code-map -->

Tree roles are registered in [code-map.manifest.json](../scripts/code-map.manifest.json), dependencies (→) derived from imports; run `pnpm gen:code-map` after changing source. `FileNode` (same shape on TS/Rust) is the single shape shared across the frontend/backend boundary; declarations are notarized with a type-equiv fence (drift goes red):

```ts type-equiv
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

The authoritative command surface (with signatures) lives in the generated region of [commands.en.md](commands.en.md).

Data flows: tree reading — pick a folder (dialog) → `read_tree` assigns kind by extension → view-filetree renders the sidebar; opening — `workspace.openFile` dispatches by kind, markdown goes through `read_text_file` + markdown-it, video through `files.assetUrl` (asset protocol) into the system webview `<video>`; saving — `write_text_file` broadcasts `fs://changed` on landing, every window's tree re-reads; window creation — app-windows → `create_window` registers the table entry and creates the WebviewWindow → the new webview bootstraps (`get_window_state` fetches the root → the loader activates per the manifest).

## Key decision points

- **Extension dispatch lives on the Rust side** (`MARKDOWN_EXTS` / `VIDEO_EXTS`): a single decision point.
- **Vendored cordis, take the contract drop the loader**: a static module table + manifest loading, composition is data; upgrades = manual diff + registration in [vendor/VENDORED.md](../vendor/VENDORED.md).
- **Layering**: `src/plugins/` must not import `@tauri-apps/*` (checked by `pnpm verify:layering`); global state lives in Rust, window state in the Context.
- **`assetProtocol.scope: ["**"]`**: users may open any folder, so it cannot be pre-narrowed; the CSP's `media-src`/`img-src` restrict other resources; tightening is a [known debt](environment-independence.en.md#known-debts).
- **markdown-it bundled at build time, `html: false`**: a corollary of environment independence (below), and it shrinks the XSS surface.
- **The system webview does rendering and video decoding** (WKWebView / WebView2 / webkit2gtk): a volume-vs-dependencies tradeoff, see [environment-independence.en.md](environment-independence.en.md).

## Environment independence

Every new capability passes one check: does it introduce a runtime environment dependency? The sole home of the rules and the exemption registry is [environment-independence.en.md](environment-independence.en.md).
