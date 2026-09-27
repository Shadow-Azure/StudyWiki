# Agent Note: 阅读体验统一与切换守卫

Status: implemented

[English](2026-09-27-reading-polish.en.md) | 中文

## Problem

m1-01 与 m1-03 之后，三种查看器功能各自可用，但体验不是一个系统：markdown / excel 在切换文件时静默丢弃脏状态；视频加载失败黑屏；加载、错误、标题与保存键各自为政；视觉节奏也不一致。原型目标是「同一个窗口里舒服地阅读」，统一必须发生在宿主状态机与共享 UI 契约层，而不是每个查看器各自补丁。

## Decision

- 切换守卫归宿主 `WorkspaceService`：`guardSwitch(isDirty, confirmDiscard)` 注册者自证是否持有未保存工作，确认对话框闭包由查看器提供。`openFile` 与 `setRoot` 变为 `async → boolean`，任一守卫拒绝即保持原状态；同路径重开直接放行，不重复询问。
- 换库仍走 `WindowsService.changeRoot` 单路，但顺序变为「守卫确认 → Rust 授权/登记 → 前端切根」。守卫拒绝时连 Rust 授权都不发起，保持 fail-closed。宿主内部用 `confirmSwitch` + `forceSetRoot` 避免二次确认，不把未授权的前端切换暴露给插件。
- markdown / excel 各自注册切换守卫，条件是当前 active kind 属于自己且文档脏。这样插件切走后不会用残留 current 误拦无关切换；关窗守卫与切换守卫共用同一确认文案语义。
- 新增 `src/ui/viewer.ts` 共享查看器套件：错误条、加载态、窗口标题规则、Mod-S 绑定。markdown / excel / video 统一使用；app-shell 负责 title 基线，文档插件只在脏标记时覆盖，避免插件注册顺序互相清标题。
- 保存键统一为 window 级 `Mod-S`，仅在对应查看器 active 时响应；CodeMirror `.cm-content` 内部事件留给其 keymap，避免双保存。视频补 Space 播放/暂停与左右方向键 ±5 秒，输入框、按钮、编辑器目标不抢键。
- 视频读取 `canplay` 前显示共享加载态，`error` 显示共享错误条；markdown 读取也补加载态，excel 原私有 loading 类并入共享样式。工具栏高度、内边距与暗室留白同步收口，不引入 UI 框架。

## Alternatives considered

- 每个查看器在 file-opened 里自行判断并拦截：状态切换已经由 workspace 完成，插件只能事后补救，无法可靠恢复 activeFile 与树高亮。否。
- 宿主集中保存脏状态：需要新增跨插件文档状态服务，markdown / excel 的脏判定细节（文本 diff、workbook 状态）被上提，边界变宽。否。
- 自动保存代替确认：减少弹窗，但切换瞬间写盘会把半成品变成事实保存，且写失败仍需决策；不符合学习笔记场景。否。
- 标题由最后注册的查看器维护：依赖静态模块表顺序，新增查看器即回归。否，改为 shell 基线 + 脏查看器覆盖。

## Consequences

- `openFile` / `setRoot` 成为异步布尔 API，调用方可以忽略返回值但必须 await 时序测试；同路径重开语义由 path 判定。
- 换根、文件切换、关窗三个丢数据出口都被守卫覆盖；确认文案由拥有脏状态的插件生成，workspace 不依赖窗口服务。
- `src/ui/viewer.ts` 成为查看器共享视觉/键位小件 home；新增查看器应复用错误、加载、标题与保存键，而不是再抄局部实现。
- 视频错误只提示加载失败，不解析 webview/codec 细节；环境无关性不新增运行时依赖。
- m1-02 的验收由 workspace 守卫测试、三查看器 DOM 测试、构建与分层/环境门禁共同约束。
