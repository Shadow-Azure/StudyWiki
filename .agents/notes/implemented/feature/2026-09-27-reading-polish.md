# Agent Note: 阅读体验统一与切换守卫

Status: implemented

[English](2026-09-27-reading-polish.en.md) | 中文

## Problem

m1-01 与 m1-03 之后，三种查看器功能各自可用，但体验不是一个系统：markdown / excel 在切换文件时静默丢弃脏状态；视频加载失败黑屏；加载、错误、标题与保存键各自为政；异步读取与保存也存在串文件、误清脏状态的竞态。原型目标是「同一个窗口里舒服地阅读」，统一必须发生在宿主状态机与共享 UI 契约层，而不是每个查看器各自补丁。

## Decision

- 切换守卫归宿主 `WorkspaceService`：`guardSwitch(isDirty, confirmDiscard)` 注册者自证是否持有未保存工作，确认对话框闭包由查看器提供。`openFile` 与 `setRoot` 是 `async → boolean`，任一守卫拒绝即保持原状态；脏文档同路径重开是无提示 no-op，既不重复弹窗，也不触发重载丢稿。
- Context 只挂 `WorkspaceFacade`（读值、事件、守卫打开、守卫注册）。bootstrap 把完整内部 controller 绑给 `WindowsService`，`changeRoot(root)` 依序执行守卫确认 → Rust 授权登记 → 前端切根；外置插件 guard 另收窄 workspace / windows 成员，私有换根与绑定缝不可达。外置 windows 白名单不提供 `changeRoot` / `create`：换根与建窗会拓宽 Rust 授权边界，只由用户经内置 UI 的目录选择发起。
- markdown / excel 各自注册切换守卫，条件是当前 active path 属于自己且文档脏；关窗守卫与切换守卫共用确认文案语义。
- markdown 采用单调 open sequence 拒绝迟到读取；excel 保留原有 sequence。两者保存时捕获编辑版本 / 文本快照，只有保存期间没有新编辑才清脏，否则保持脏并可重试，避免「旧内容写盘、新编辑被标净」。
- 新增 `src/ui/viewer.ts` 共享查看器套件：可访问错误条、加载态、窗口标题规则、Mod-S 绑定。app-shell 负责 title 基线，文档插件只在自持文档时覆盖；CodeMirror `.cm-content` 内部事件留给其 keymap。视频补 Space 与左右 ±5 秒，已处理键与输入控件不抢键，迟到 error 按渲染代际丢弃。
- 视频 `canplay` 前显示共享加载态，`error` 显示共享错误条；markdown 读取补加载态，excel 错误与加载互斥。工具栏高度、内边距与暗室留白同步收口，不引入 UI 框架。

## Alternatives considered

- 每个查看器在 file-opened 里自行判断并拦截：状态切换已经由 workspace 完成，插件只能事后补救，无法可靠恢复 activeFile 与树高亮。否。
- 宿主集中保存脏状态：需要新增跨插件文档状态服务，markdown / excel 的脏判定细节（文本 diff、workbook 状态）被上提，边界变宽。否。
- 自动保存代替确认：减少弹窗，但切换瞬间写盘会把半成品变成事实保存，且写失败仍需决策；不符合学习笔记场景。否。
- 把完整 WorkspaceService 继续挂在 Context：内置插件可用，但外置声明 workspace 后可摸到换根私有缝，破坏授权单路。否，改为 facade + windows 内部绑定。
- 标题由最后注册的查看器维护：依赖静态模块表顺序，新增查看器即回归。否，改为 shell 基线 + 脏查看器覆盖。

## Consequences

- `openFile` / `setRoot` 是异步布尔 API；`WindowsService.changeRoot` 改为绑定式 `changeRoot(root)`。调用方可以忽略返回值，但时序测试必须 await。
- 换根、文件切换、关窗三个丢数据出口都被守卫覆盖；保存期间的新编辑不会被标净。确认文案由拥有脏状态的插件生成，workspace 不依赖窗口服务。
- 外置插件暂不能编程换根或建窗；若未来出现真实用例，应先设计宿主中介的用户确认 API，而不是直接开放底层授权命令。
- `src/ui/viewer.ts` 是查看器共享视觉 / 键位小件 home；新增查看器应复用错误、加载、标题与保存键，而不是再抄局部实现。
- 视频错误只提示加载失败，不解析 webview/codec 细节；环境无关性不新增运行时依赖。
- m1-02 验收由 workspace / windows / guard 组合测试、三查看器 DOM 竞态测试、构建与分层 / 环境门禁共同约束。
