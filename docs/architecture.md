# 架构

[English](architecture.en.md) | 中文

> 类型：参考 | 层级：架构地图。改 `src/` 或 `src-tauri/` 前必读。决策理由见 Agent Note。

## 组成

多窗口 Tauri 2 桌面应用：Rust 壳全局一份，前端每窗口一份（cordis Context + 装载器 + 内置插件），插件只经宿主服务触达系统能力。理由见[插件化 Agent Note](../.agents/notes/implemented/architecture/2026-09-10-plugin-architecture.md)。

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
  plugins/agent-core/session.ts    agent-core JSONL 会话编解码、崩溃尾容错与压缩视图（→ types.ts）
  plugins/agent-core/tools.ts      agent-core 四工具执行、审批请求契约与越权读升级（→ files.ts、llm.ts、types.ts）
  plugins/agent-core/types.ts      agent-core 消息、批准与会话日志类型契约（→ llm.ts）
  plugins/app-chat/attachments.ts  app-chat 附件纯函数：粘贴/拖拽 File → inline 图片/音频附件（base64 + MIME），其他类型拒收，超 20 MB 硬上限在读取字节前拒绝
  plugins/app-chat/index.ts        app-chat 插件：右侧栏内存会话 + chat 流式请求/渲染/停止/重试 + 模型选择与多模态附件 chips（→ llm-stream.ts、llm.ts、attachments.ts、render.ts）
  plugins/app-chat/render.ts       app-chat 渲染：rAF 合帧 partial 快照 → reasoning/Markdown/工具/usage/error 视图（→ llm-stream.ts、markdown.ts）
  plugins/app-shell/index.ts       app-shell 插件：topbar（品牌+居中活动文件名+右侧操作）/sidebar+拖拽发丝线+main 栅格 + 四槽容器挂载 + 标题基线 + 无 root 欢迎态、未选文档空态与 other 不支持提示态（→ dom.ts、icons.ts、viewer.ts）
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
  preview.ts                       浏览器视觉预览装配器：真实内置插件 + 内存宿主，供本地 UI 检视与视觉回归；含 app-chat 假流式桩（→ llm-stream.ts、workspace.ts、styles.css、types.ts）
  styles.css                       工作台视觉系统：中性双主题令牌 + 壳/树/拖拽发丝线/按钮/阅读与编辑面/分段模式/暗室/面板全样式（无逻辑）
  types.ts                         FileNode —— 前后端共享的唯一形状
  ui/dom.ts                        DOM 小件工厂：labelButton（图标+文案按钮，类名/无障碍名可配；点击监听归调用方）（→ icons.ts）
  ui/icons.ts                      内联 SVG 图标库：16px 网格 currentColor 描线，无外链无字体依赖，不产生 textContent（树行/按钮共用）
  ui/markdown.ts                   宿主共享 markdown-it 渲染器：html/linkify/typographer 全关，doc-markdown 与 chat 共用同一安全策略
  ui/viewer.ts                     共享查看器小件：错误条/加载态/窗口标题规则 + 各文档查看器共用的 Mod-S 键位绑定（→ types.ts、dom.ts、icons.ts）
src-tauri/                         Rust 壳
  config.rs                        用户配置根 ~/.studywiki：解析/老域一次性迁移 + settings.json 模型/原子写 0600/脱敏投影/endpoint 校验
  grep.rs                          agent grep 原生命令：sidecar ripgrep 裸 argv spawn + rg --json 流式解析 + raw/timeout/limit 预算与 SEARCH_* 错误词表
  lib.rs                           tauri::Builder 总装 + 文件命令（路径根域校验）+ raw binary IPC 命令与 MockRuntime 测试装配 + 窗口/插件命令注册 + 窗口事件接线（→ config.rs、grep.rs、llm.rs、llm_stream.rs、native_close.rs、plugins.rs、windows.rs）
  llm.rs                           LLM 薄能力层命令面：厂商预设 + endpoint CRUD + 探测 + 多模态请求构建 + 流式/非流式 chat 出口 + 附件大小门禁（单件 20 MB / 聚合 100 MB）（唯一联网点，ureq rustls）
  llm_stream.rs                    流式 chat SSE 解析：跨读聚合行、delta 词表、usage/finish 排序与回调停止缝
  main.rs                          入口壳（Windows 隐藏控制台）（→ lib.rs）
  native_close.rs                  macOS 原生关窗/退出拦截：_close/performClose/close 与 NSApplication terminate: selector hook + 红点 target/action 改接前端聚合守卫
  plugins.rs                       插件目录命令面：封闭契约解析 + 扫描/读入口/删目录 + 安装管线（registry 直拉/sha512/tgz 校验/原子落盘）
  windows.rs                       窗口注册表（label→root，upsert）+ create/get/set 窗口命令 + asset 运行期授权 + plugins.json 清单 IO
vendor/                            vendored 上游源码：cordis（Shadow-Azure fork，上游 f8ea3cd）+ cosmokit，收编清单见 vendor/VENDORED.md
```
<!-- END GENERATED code-map -->

树职责登记在 [code-map.manifest.json](../scripts/code-map.manifest.json)，依赖（→）从 import 推导，改源码后跑 `pnpm gen:code-map`。`FileNode`（TS/Rust 同形）是前后端共享的唯一形状；声明贴 type-equiv 围栏公证（漂移即红）：

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

命令面权威清单（含签名）在 [commands.md](commands.md) 生成区。

数据流：树读取——选文件夹→`read_tree` 定 kind→view-filetree 渲染；打开——`workspace.openFile` 过切换守卫后按 kind 分派：markdown 走 `read_text_file`+markdown-it，excel 走 `ctx.excel.read`，视频走 `files.assetUrl` 喂 webview `<video>`，other 由 shell 提示；保存——markdown/excel 共用 `Mod-S` 与保存按钮，写入后广播 `fs://changed`；换根——`windows.changeRoot` 依序做守卫确认、Rust 授权登记、前端切根；建窗——`create_window` 登记并建 WebviewWindow，新窗 bootstrap 领 root 后按清单激活；外置插件——安装/导入/启停/重载/回退/移除经 plugin-manager，`ext:` 行走唯一 blob 装载缝（细节见 [dynamic.md](plugins/dynamic.md)）；LLM 推理——插件经 `ctx.llm.chat`/`ctx.llm.chatStream` 发起，宿主按模型路由归属 endpoint（`MODEL_UNKNOWN`/`MODEL_AMBIGUOUS`/`MODEL_UNSPECIFIED` 在本层抛出），Rust `llm_chat`/`llm_chat_stream` 读 `~/.studywiki/settings.json` 发 HTTPS（空 apiKey 不带 Authorization）；流式经 Channel，`llm_chat_abort` 置停；错误同路。

## 关键决策点

- **扩展名分派在 Rust 侧**（`MARKDOWN_EXTS`/`VIDEO_EXTS`/`EXCEL_EXTS`）：单一决策点。
- **xlsx 语义在前端 ExcelJS，Rust 只作字节边界**：`ctx.excel` 持 workbook 并强制 1_000_000 声明维度单元格上限；Rust 只搬运与原子写。
- **切换守卫住宿主 `WorkspaceService`，Context 只挂 `WorkspaceFacade`**：文件 / 换根共用守卫；脏同路径重开 no-op；windows 绑定内部 controller，Rust 授权前先确认。
- **关窗先主进程取消**：macOS `_close:`/红点/`terminate:` 入守卫，确认才 `destroy()`。
- **vendored cordis，取契约弃装载器**：静态模块表+清单装载，组合是数据；升级 = 手动 diff+[vendor/VENDORED.md](../vendor/VENDORED.md) 登记。
- **分层纪律**：`src/plugins/` 禁 import `@tauri-apps/*`（`pnpm verify:layering` 校验）；全局状态住 Rust，窗口状态住 Context。
- **assetProtocol 配置 scope 为空，运行期动态授权**：选中/建窗/启动携带 root 时 Rust `allow_directory`（recursive）注入——视频与图片仍走 asset protocol，但配置面不再预开任意目录。
- **markdown-it 构建期打包，`html: false`**：环境无关（见下）推论，兼降 XSS 面。
- **系统 webview 做渲染与视频解码**（WKWebView/WebView2/webkit2gtk）：体积与依赖取舍，见 [environment-independence.md](environment-independence.md)。
- **`~/.studywiki` 为用户配置根**：三端同形，老 `app_config_dir` 数据启动一次性迁移（幂等可重入）。
- **密钥明文存 settings.json + 0600**：与 Claude Code/Codex/dsh 同水位；命令面只进不出（list 脱敏），外置插件白名单不含写操作。
- **Rust 为薄能力层（持久化+egress）**：模型路由与未来 agent 循环均在前端（对照 dsh：native 只做能力隔离）；厂商预设 baseUrl 只存在于 Rust 侧。
- **外置插件装载走 blob URL**：Rust 命令读入口源码→JS Blob→动态 import；单文件零依赖契约使 blob 的常见弱点（相对导入、URL 生命周期）归零，且通道可在 vitest 注入假 import 全链路测试；自定义协议 ESM 只能真实 webview 验证，留作备选（Phase 2 Note 决策 1 落定记录）。
- **流式走 `ipc::Channel` 而非事件广播**：单消费者有序/多窗口隔离；`llm_chat_abort` 显式置停。
- **附件三源联合**：path 由 Rust 出口读盘转 base64/inline 不落盘/url 透传 provider。
- **npm 当仓库用、不当运行时用**：联网只发生在 Rust 安装命令（ureq+rustls 纯 Rust 栈），运行全程离线（[environment-independence.md](environment-independence.md) 豁免登记）。

## 环境无关性

新增能力过一道检查：会不会引入运行期环境依赖？规则与豁免登记唯一 home 是 [environment-independence.md](environment-independence.md)。
