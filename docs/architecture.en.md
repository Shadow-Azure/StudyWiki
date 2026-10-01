# Architecture

English | [中文](architecture.md)

> Type: reference | Tier: architecture map. Required reading before changing `src/` or `src-tauri/`. Rationale lives in the owning Agent Note.

## Composition

Multi-window Tauri 2 desktop app: one Rust shell for the whole app, one frontend instance per window (cordis Context + loader + built-in plugins); plugins reach system capabilities only through host services. Rationale: the [plugin-architecture Agent Note](../.agents/notes/implemented/architecture/2026-09-10-plugin-architecture.en.md).

<!-- BEGIN GENERATED code-map (scripts/gen-code-map.mjs) — do not edit between markers -->
```text
src/                               前端（TypeScript + Vite，无 UI 框架）
  boot-error.ts                    启动错误面板：bootstrap 拒绝时向 #app 内联渲染错误与清理指引（替代白屏）
  bootstrap.ts                     每窗口启动流程：七宿主服务入 ctx + 清单迁移装载 + 插件激活 + 外置坏行回填（Tauri 绑定可注入）（→ excel.ts、files.ts、llm.ts、plugins.ts、slots.ts、windows.ts、workspace.ts、boot.ts、external.ts、manifest.ts、table.ts）
  host/context.d.ts                cordis Context 声明合并：七个宿主服务类型挂入（workspace 只暴露插件 facade）（→ excel.ts、files.ts、llm.ts、plugins.ts、slots.ts、windows.ts、workspace.ts）
  host/emitter.ts                  极简类型化事件发射器（on 返回反订阅）
  host/excel.ts                    Excel 服务：ExcelJS workbook 解析/序列化 + 解析失败稳定文案 + 1_000_000 声明维度单元格上限（binary files 桥接可注入）
  host/files.ts                    文件服务：树/读写/选目录/asset URL + fs://changed 桥接（deps 可注入）（→ emitter.ts、types.ts）
  host/llm-stream.ts               LLM 流式契约：chunk 词表、partial 快照组装器、FIFO 异步 chunk 队列与流句柄形状（→ llm.ts）
  host/llm.ts                      LLM 服务：模型路由（MODEL_* 三码）+ 推理 facade（list/upsert/remove/probe/chat/chatStream，能力门禁，deps 可注入）（→ llm-stream.ts）
  host/plugins.ts                  宿主插件包服务：安装/导入/列出/移除 + 清单读写 + loadModule（apiVersion 支持集 + 形状校验，deps 可注入）（→ external.ts、manifest.ts、types.ts）
  host/slots.ts                    类型化 UI 槽位注册表：注册序渲染、各自容器、反订阅移除（mount 归 shell 插件）
  host/windows.ts                  窗口服务：label/建窗/root 查询/守卫先行换根/确认框/聚合并显式销毁的关窗守卫（deps 可注入）（→ workspace.ts）
  host/workspace.ts                窗口 scope 工作区状态机：root/activeFile + 事件流 + 切换守卫与插件 facade（→ emitter.ts、types.ts）
  loader/activate.ts               外置插件共享激活：guard 包装 + fiber 等待式审计 + 串行队列 + running/失败登记（boot 与热路径唯一入口）（→ guard.ts、types.ts）
  loader/boot.ts                   装载器：内置行 fail-loud + ext: 行分治坏行（BootReport），全树激活审计（→ activate.ts、manifest.ts、table.ts、types.ts）
  loader/external.ts               外置模块装载缝：全前端唯一动态 import 点（blob 通道，用后即回收）
  loader/guard.ts                  外置插件 guard 门面：inject 白名单 Proxy + 关键宿主服务成员白名单（非沙箱）（→ types.ts）
  loader/manifest.ts               插件清单装载：缺失时从模块表生成默认并写回 + 存量迁移（表新增内置行合并落盘），损坏 fail-loud（→ table.ts）
  loader/table.ts                  静态模块表：id → 插件 + 默认配置（构建期单一 home，行随插件任务落地）（→ types.ts）
  loader/types.ts                  内置插件导出形状 PluginModule：(name, inject, apply) 三件套的结构子集
  main.ts                          入口：调用每窗口 bootstrap（三行）（→ boot-error.ts、bootstrap.ts、styles.css）
  plugins/app-chat/attachments.ts  app-chat 附件纯函数：粘贴/拖拽 File → inline 图片/音频附件（base64 + MIME），其他类型拒收
  plugins/app-chat/index.ts        app-chat 插件：右侧栏内存会话 + chat 流式请求/渲染/停止/重试 + 模型选择与多模态附件 chips（→ llm-stream.ts、llm.ts、attachments.ts、render.ts）
  plugins/app-chat/render.ts       app-chat 渲染：rAF 合帧 partial 快照 → reasoning/Markdown/工具/usage/error 视图（→ llm-stream.ts、markdown.ts）
  plugins/app-shell/index.ts       app-shell 插件：topbar（品牌+居中活动文件名+右侧操作）/sidebar+拖拽发丝线+main 栅格 + 三槽容器挂载 + 标题基线 + 无 root 欢迎态、未选文档空态与 other 不支持提示态（→ dom.ts、icons.ts、viewer.ts）
  plugins/app-windows/index.ts     app-windows 插件：顶栏新建窗口（携带当前 root）与打开文件夹入口（→ dom.ts）
  plugins/doc-excel/editing.ts     doc-excel 纯函数：单元格输入解析（十进制数值化 / `'` 强制文本 / 空白清空）+ 选区几何 + 值/字体/填充/合并写回 worksheet（→ model.ts）
  plugins/doc-excel/index.ts       doc-excel 插件：活动文件多 sheet 查看器/编辑器 + 样式与合并渲染、单击/Shift 选区、内联编辑、脏标记/保存重试/全局保存/关窗与切换守卫 + 虚拟滚动（file-opened 挂渲染，kind 不符清空）（→ editing.ts、model.ts、types.ts、dom.ts、viewer.ts）
  plugins/doc-excel/model.ts       doc-excel 纯函数：worksheet → CSS-ready 单元格/样式/合并模型 + 虚拟行窗口
  plugins/doc-markdown/editor.ts   doc-markdown CodeMirror 6 工厂：唯一 CodeMirror import 点（minimalSetup + 文档主题/语法 + 换行 + Mod-s 键位），测试注入假工厂
  plugins/doc-markdown/index.ts    doc-markdown 插件：活动文件 markdown 预览/编辑双模式 + 加载/错误态 + 乱序读取防护 + 脏标记/保存重试 + 全局 Mod-S + 关窗/切换守卫（file-opened 挂渲染，kind 不符清空）（→ editor.ts、mode.ts、preview.ts、types.ts、dom.ts、viewer.ts）
  plugins/doc-markdown/mode.ts     doc-markdown 纯函数：文档状态机（open/edit/saved/toggle/dirty）
  plugins/doc-markdown/preview.ts  doc-markdown 兼容 re-export：消费方保留原导入路径并使用宿主共享 markdown 渲染器（→ markdown.ts）
  plugins/doc-video/index.ts       doc-video 插件：活动文件视频查看器（video controls + asset protocol 播放 + 加载/错误态与播放快捷键；file-opened 挂渲染，kind 不符清空）（→ viewer.ts）
  plugins/llm-settings/index.ts    llm-settings 插件：厂商预设实例化 + endpoint 列表/编辑/删除/探测面板（写面仅内置插件）（→ llm.ts、model.ts、dom.ts）
  plugins/llm-settings/model.ts    llm-settings 纯函数：预设 → 表单草稿 + 中文点名字段校验（空 apiKey 合法）
  plugins/plugin-manager/index.ts  plugin-manager 插件：顶栏入口 + 插件管理面板（安装/导入/启停/重载/版本回退/移除六动作本窗即时生效，写清单供他窗重启跟随）（→ activate.ts、manifest.ts、model.ts、dom.ts）
  plugins/plugin-manager/model.ts  plugin-manager 纯函数：面板行四源合一投影（boot 坏行 > 扫描 problem > 目录缺失 + 运行态/失败徽章）+ 清单追加/开关/移除纯变换（→ plugins.ts、manifest.ts）
  plugins/view-filetree/index.ts   view-filetree 插件：侧栏文件树 UI（展开折叠/点开文档/other 触发不支持态/手动刷新/fs 变更重读）（→ tree.ts、types.ts、dom.ts、icons.ts）
  plugins/view-filetree/tree.ts    view-filetree 纯函数：点文件递归过滤 + 可见行铺平（深度优先、携带深度）（→ types.ts）
  preview.ts                       浏览器视觉预览装配器：真实内置插件 + 内存宿主，供本地 UI 检视与视觉回归（→ workspace.ts、styles.css、types.ts）
  styles.css                       工作台视觉系统：中性双主题令牌 + 壳/树/拖拽发丝线/按钮/阅读与编辑面/分段模式/暗室/面板全样式（无逻辑）
  types.ts                         FileNode —— 前后端共享的唯一形状
  ui/dom.ts                        DOM 小件工厂：labelButton（图标+文案按钮，类名/无障碍名可配；点击监听归调用方）（→ icons.ts）
  ui/icons.ts                      内联 SVG 图标库：16px 网格 currentColor 描线，无外链无字体依赖，不产生 textContent（树行/按钮共用）
  ui/markdown.ts                   宿主共享 markdown-it 渲染器：html/linkify/typographer 全关，doc-markdown 与 chat 共用同一安全策略
  ui/viewer.ts                     共享查看器小件：错误条/加载态/窗口标题规则 + 各文档查看器共用的 Mod-S 键位绑定（→ types.ts、dom.ts、icons.ts）
src-tauri/                         Rust 壳
  config.rs                        用户配置根 ~/.studywiki：解析/老域一次性迁移 + settings.json 模型/原子写 0600/脱敏投影/endpoint 校验
  lib.rs                           tauri::Builder 总装 + 文件命令（路径根域校验）+ raw binary IPC 命令与 MockRuntime 测试装配 + 窗口/插件命令注册 + 窗口事件接线（→ config.rs、llm.rs、llm_stream.rs、native_close.rs、plugins.rs、windows.rs）
  llm.rs                           LLM 薄能力层命令面：厂商预设 + endpoint CRUD + 探测 + 多模态请求构建 + 流式/非流式 chat 出口（唯一联网点，ureq rustls）
  llm_stream.rs                    流式 chat SSE 解析：跨读聚合行、delta 词表、usage/finish 排序与回调停止缝
  main.rs                          入口壳（Windows 隐藏控制台）（→ lib.rs）
  native_close.rs                  macOS 原生关窗/退出拦截：_close/performClose/close 与 NSApplication terminate: selector hook + 红点 target/action 改接前端聚合守卫
  plugins.rs                       插件目录命令面：封闭契约解析 + 扫描/读入口/删目录 + 安装管线（registry 直拉/sha512/tgz 校验/原子落盘）
  windows.rs                       窗口注册表（label→root，upsert）+ create/get/set 窗口命令 + asset 运行期授权 + plugins.json 清单 IO
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
  /** Dispatches handling: directories expand; markdown/video/excel open; other opens the shell unsupported hint. */
  kind: "dir" | "markdown" | "video" | "excel" | "other";
  /** Present only for directories. */
  children?: FileNode[];
};
```

The authoritative command surface (with signatures) lives in the generated region of [commands.en.md](commands.en.md).

Data flows: tree reading — pick a folder → `read_tree` assigns kind → view-filetree renders; opening — `workspace.openFile` passes the switch guards, then dispatches by kind: markdown through `read_text_file` + markdown-it, excel through `ctx.excel.read`, video through `files.assetUrl` into the webview `<video>`, and other to the shell hint; saving — markdown / excel share `Mod-S` and save buttons, then broadcast `fs://changed`; root switching — `windows.changeRoot` runs guard confirmation, Rust authorization/registration, then the frontend switch; window creation — `create_window` registers and creates the WebviewWindow, and the new bootstrap fetches the root before manifest activation; external plugins — install/import/toggle/reload/rollback/remove through plugin-manager, with `ext:` rows using the sole blob loading seam (details in [dynamic.en.md](plugins/dynamic.en.md)); LLM inference — plugins call `ctx.llm.chat` / `ctx.llm.chatStream`, the host service routes the model to its owning endpoint (`MODEL_UNKNOWN` / `MODEL_AMBIGUOUS` / `MODEL_UNSPECIFIED` are thrown here), and the Rust `llm_chat` / `llm_chat_stream` read `~/.studywiki/settings.json` and send HTTPS (an empty apiKey carries no Authorization header); streaming chunks are delivered through a Channel, and `llm_chat_abort` sets the stop flag; normalized error codes return along the same path.

## Key decision points

- **Extension dispatch lives on the Rust side** (`MARKDOWN_EXTS` / `VIDEO_EXTS` / `EXCEL_EXTS`): a single decision point.
- **xlsx semantics live in frontend ExcelJS; Rust stays a byte boundary**: `ctx.excel` owns the workbook and enforces the 1,000,000 declared-dimension cell cap; Rust only moves bytes and writes atomically.
- **Switch guards live in host `WorkspaceService`; Context exposes only `WorkspaceFacade`**: file/root switches share guards, dirty same-path reopen is a no-op, and windows binds the internal controller before Rust authorization.
- **Close cancels in the main process first**: macOS `_close:`/red button/`terminate:` enter frontend guards; consent calls `destroy()`.
- **Vendored cordis, take the contract drop the loader**: a static module table + manifest loading, composition is data; upgrades = manual diff + registration in [vendor/VENDORED.md](../vendor/VENDORED.md).
- **Layering**: `src/plugins/` must not import `@tauri-apps/*` (checked by `pnpm verify:layering`); global state lives in Rust, window state in the Context.
- **assetProtocol's configured scope is empty, runtime dynamic authorization**: when a folder is picked, a window is created, or startup carries a root, Rust injects it via `allow_directory` (recursive) — video and images keep using the asset protocol, but the configured surface no longer pre-opens arbitrary directories.
- **markdown-it bundled at build time, `html: false`**: a corollary of environment independence (below), and it shrinks the XSS surface.
- **The system webview does rendering and video decoding** (WKWebView / WebView2 / webkit2gtk): a volume-vs-dependencies tradeoff, see [environment-independence.en.md](environment-independence.en.md).
- **`~/.studywiki` is the user config root**: identical shape on all three platforms; legacy `app_config_dir` data migrates once at startup (idempotent, re-entrant).
- **Keys are stored in plaintext in settings.json with 0600**: the same water level as Claude Code / Codex / dsh; the command surface is write-only for keys (list is redacted) and the external-plugin whitelist excludes write operations.
- **Rust is a thin capability layer (persistence + egress)**: model routing and the future agent loop both live in the frontend (compared with dsh: native code only isolates capabilities); vendor preset baseUrls exist only on the Rust side.
- **External plugins load via blob URL**: a Rust command reads the entry source → JS Blob → dynamic import; the single-file zero-dependency contract drives the blob's usual weaknesses (relative imports, URL lifetime) to zero, and the channel is testable end-to-end in vitest with an injected fake import; custom-protocol ESM can only be verified in a real webview and stays as a fallback (landing record in the Phase 2 Note, decision 1).
- **npm as a repository, not as a runtime**: networking happens only in the Rust install command (ureq+rustls pure-Rust stack); runtime stays fully offline ([environment-independence.en.md](environment-independence.en.md) exemption registry).

## Environment independence

Every new capability passes one check: does it introduce a runtime environment dependency? The sole home of the rules and the exemption registry is [environment-independence.en.md](environment-independence.en.md).
