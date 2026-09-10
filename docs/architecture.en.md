# Architecture

English | [中文](architecture.md)

> Type: reference | Tier: architecture map. Required reading before changing `src/` or `src-tauri/`. Decision rationale does not live here — see the owning Agent Note.

## Composition

StudyWiki is a single-window Tauri 2 desktop app with two layers:

<!-- BEGIN GENERATED code-map (scripts/gen-code-map.mjs) — do not edit between markers -->
```text
src/                               前端（TypeScript + Vite，无 UI 框架）
  bootstrap.ts                     每窗口启动流程：宿主服务入 ctx + 清单装载 + 插件激活（Tauri 绑定可注入）（→ files.ts、slots.ts、windows.ts、workspace.ts、boot.ts、manifest.ts、table.ts）
  host/context.d.ts                cordis Context 声明合并：files/windows/workspace/slots 四服务类型挂入（→ files.ts、slots.ts、windows.ts、workspace.ts）
  host/emitter.ts                  极简类型化事件发射器（on 返回反订阅）
  host/files.ts                    文件服务：树/读写/选目录/asset URL + fs://changed 桥接（deps 可注入）（→ emitter.ts、types.ts）
  host/slots.ts                    类型化 UI 槽位注册表：注册序渲染、各自容器、反订阅移除（mount 归 shell 插件）
  host/windows.ts                  窗口服务：label/建窗/root 查询/确认框/关闭守卫（deps 可注入）
  host/workspace.ts                窗口 scope 工作区状态机：root/activeFile + root-changed/file-opened 事件流（→ emitter.ts、types.ts）
  loader/boot.ts                   装载器：清单行驱动 ctx.plugin + 全树激活审计（非 ACTIVE 点名）（→ manifest.ts、table.ts）
  loader/manifest.ts               插件清单装载：缺失时从模块表生成默认并写回，损坏 fail-loud（→ table.ts）
  loader/table.ts                  静态模块表：id → 插件 + 默认配置（构建期单一 home，行随插件任务落地）（→ types.ts）
  loader/types.ts                  内置插件导出形状 PluginModule：(name, inject, apply) 三件套的结构子集
  main.ts                          入口：调用每窗口 bootstrap（三行）（→ bootstrap.ts、styles.css）
  plugins/app-shell/index.ts       app-shell 插件：topbar/sidebar/main 栅格 + 三槽容器挂载 + 无 root 欢迎态
  plugins/doc-markdown/editor.ts   doc-markdown CodeMirror 6 工厂：唯一 CodeMirror import 点（basicSetup + markdown 高亮 + Mod-s 键位），测试注入假工厂
  plugins/doc-markdown/index.ts    doc-markdown 插件：活动文件 markdown 预览/编辑双模式 + 脏标记 + Ctrl+S 保存 + 关窗守卫（file-opened 挂渲染，kind 不符清空）（→ editor.ts、mode.ts、preview.ts、types.ts）
  plugins/doc-markdown/mode.ts     doc-markdown 纯函数：文档状态机（open/edit/saved/toggle/dirty）
  plugins/doc-markdown/preview.ts  doc-markdown 纯函数：markdown-it 渲染（html:false，内嵌 HTML 转义）
  plugins/view-filetree/index.ts   view-filetree 插件：侧栏文件树 UI（展开折叠/点开文档/手动刷新/fs 变更重读）（→ tree.ts、types.ts）
  plugins/view-filetree/tree.ts    view-filetree 纯函数：点文件递归过滤 + 可见行铺平（深度优先、携带深度）（→ types.ts）
  styles.css                       样式（无逻辑）
  types.ts                         FileNode —— 前后端共享的唯一形状
src-tauri/                         Rust 壳
  lib.rs                           tauri::Builder + 文件命令 + 窗口事件接线（→ windows.rs）
  main.rs                          入口壳（Windows 隐藏控制台）（→ lib.rs）
  windows.rs                       窗口注册表（label→root）+ create/get 窗口命令 + plugins.json 清单 IO
```
<!-- END GENERATED code-map -->

The composition tree is a generated region: file roles are registered in [code-map.manifest.json](../scripts/code-map.manifest.json) and internal dependencies (→) are derived from source imports; register and run `pnpm gen:code-map` after adding/removing source files or changing imports. `types.ts` and the Rust-side `LibraryEntry` are the single shape shared across the frontend/backend boundary. Declarations pasted into docs use type-equiv fences notarized against source (`scripts/verify-type-equiv.mjs`, verbatim equivalence; changing source without syncing the doc goes red):

```ts type-equiv
/** A playable or readable file inside the opened library. */
export type LibraryEntry = {
  /** File name including extension. */
  name: string;
  /** Absolute path, used for reads and asset-protocol URLs. */
  path: string;
  /** Dispatches the viewer: markdown or video. */
  kind: "markdown" | "video";
};
```

The authoritative command surface (with signatures) lives in the generated region of [commands.md](commands.en.md); run `pnpm gen:commands` after changing source. Data flow: the user picks a folder (dialog plugin) → the `list_library` command scans and classifies by extension → the frontend renders the sidebar → opening a file dispatches Markdown to `read_text_file` + markdown-it frontend rendering, and video to `convertFileSrc` (asset protocol) handed to the system webview's `<video>` decoder.

## Key decision points

- **Extension dispatch lives on the Rust side** (`MARKDOWN_EXTS` / `VIDEO_EXTS`): a single decision point; the frontend never re-classifies.
- **`assetProtocol.scope: ["**"]`**: the user may open any folder, so it cannot be pre-narrowed; the CSP's `media-src`/`img-src` restrict other resources. Tightening the scope is a [known debt](environment-independence.en.md#known-debts).
- **markdown-it is bundled at build time**, `html: false` disables inline HTML: a direct corollary of the environment-independence constraint below, and it shrinks the XSS surface.
- **The system webview does rendering and video decoding** (macOS WKWebView / Windows WebView2 / Linux webkit2gtk): a volume-vs-dependencies tradeoff; boundary and mitigations in [environment-independence.en.md](environment-independence.en.md).

## Environment independence

Architecturally, every new capability passes one check: does it introduce a runtime environment dependency? The single home for rules, gates, and the exemption registry is [environment-independence.en.md](environment-independence.en.md).
