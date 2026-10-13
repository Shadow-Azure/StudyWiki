# Agent Note: 主窗口 Activity Rail 与可折叠侧栏

Status: implemented

[English](2026-10-08-shell-rails-v2.en.md) | 中文

## Problem

主窗口目前只有一个文件侧栏拖拽条：命中区窄且没有拖拽反馈，用户感知为不可拖动；右侧 Agent 栏没有同规格拖拽条。全局操作（新建窗口、打开文件夹、插件、模型）放在应用顶栏，顶栏还承载品牌、当前文件与插件按钮，信息归属混乱。两侧栏也没有统一的隐藏入口和持久化宽度。用户已确认的可交互原型要求白色 Activity Rail、文件栏与 Agent 栏独立折叠、面板开关进入窗口控制层，并且 Agent 栏隐藏时不使用红点提醒。

## Decision

采用四列 shell：`Activity Rail(54px) | Files(可折叠) | Reader(自适应) | Agent(可折叠)`。Activity Rail 使用既有主题 token 呈现白色/纸面风格，固定承载 `activity.left` 槽位；`app-windows`、`plugin-manager`、`llm-settings` 改注册到该槽位，顺序为打开文件夹、新窗口、插件、模型。`topbar.left` 保留为 API v1 兼容别名，由 `SlotsService` 归一化到 `activity.left`，外置插件不需升级契约。

Shell 移除应用内 `SW + StudyWiki` 品牌区；标题行只保留当前文件标题。macOS 使用 Tauri `TitleBarStyle::Overlay`、隐藏原生标题并把 traffic lights 定位在标题行内；DOM 面板开关与这些原生控件同层。非 macOS 保留系统原生标题栏，应用标题行作为第一行工具栏呈现，这是本期的平台差异。标题行设为 drag region，按钮和交互控件设为 no-drag。

右栏 slot 包装层必须保持高度链：`.rail.agent > .slot-host` 使用 `display: contents`，直接 `.slot` 使用 `flex: 1; min-height: 0`，否则 `.agent-panel` 的高度链断裂，composer 会离开右栏底部。

两根可折叠侧栏共用同一交互语言：12px 命中区、1px 分界线、hover/drag 时蓝色线和竖向 pill、Pointer Capture、rAF 合并、拖动期间关闭动画、双击重置、`role="separator"` 键盘调节。几何约束为 Activity Rail 54px、文件栏 220–440px、Agent 栏 300–520px、阅读区至少 340px。隐藏栏宽度为 0 但子树保持挂载；拖到最小值不触发隐藏。快捷键为 `Cmd/Ctrl+B` 切文件栏、`Cmd/Ctrl+Option/Alt+B` 切 Agent 栏；右栏隐藏时不显示红点。

布局状态持久化到 `localStorage` key `studywiki.shell-layout.v1`，结构为 `{ version: 1, files: { width, open }, agent: { width, open } }`。读写都经过 clamp/默认值归一；损坏或超版本数据回退默认，不 fail-loud。变更即时保存，多窗口通过 `storage` 事件同步最后写入值。该状态是本机 UI 偏好，不进入 settings.json，也不随工作区数据写入用户文档。

实现拆分为 `src/plugins/app-shell/layout.ts`（常量、clamp、状态归一化和序列化）与 `src/plugins/app-shell/index.ts`（DOM、槽位、手势和事件）。`src-tauri/tauri.conf.json` 与 `src-tauri/src/windows.rs` 的动态建窗都应用 macOS overlay 设置。文档同步更新架构地图与外置插件槽位契约。

## Alternatives considered

- **保留 `topbar.left` 并直接把容器移到最左列**：外置插件不用改，但槽名与视觉位置长期不一致；选择归一化别名可兼顾 v1 兼容和清晰的新名字。
- **隐藏侧栏时保留 dsh 式 56px 图标轨**：有利于快速恢复，但与用户确认的“完全隐藏 + 顶部开关”原型不一致，也压缩阅读区；放弃。
- **把布局写入 `~/.studywiki/settings.json`**：跨进程更正式，但要扩展严格版本化配置、合并多窗口写竞争，且 UI 宽度不属于推理配置；先用 localStorage，未来若需要导出/同步再升级。
- **用 frameless 窗口自绘三端窗口按钮**：能完全统一三端，但会重做关闭守卫、最大化状态和平台键盘语义，风险大于本期目标；macOS overlay、其他平台保留原生标题栏。

## Consequences

- 优点：两侧栏获得一致、可发现的拖拽和隐藏体验；全局命令获得稳定 Activity Rail；外置 v1 插件槽位不破坏；Agent 状态在隐藏期间保留。
- 代价：shell 需要感知 macOS overlay 安全区，动态窗口与主窗口配置必须保持一致；localStorage 是最后写入者 wins，不能提供设置同步或冲突合并。
- 欠账：非 macOS 仍是原生标题栏加应用标题行，不与系统按钮同层；若后续要求三端一致，需要单独评估 frameless 窗口和自绘控制。Activity Rail 现在只承载命令图标，暂不引入多视图切换。
