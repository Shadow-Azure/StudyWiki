# 主窗口 Activity Rail 与可折叠侧栏

[English](m2-shell-rails-v2.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P1
status: ready
scope:
  - src/plugins/app-shell/**
  - .agents/flow/issues/m2-shell-rails-v2.*
  - src/plugins/app-windows/**
  - src/plugins/plugin-manager/**
  - src/plugins/llm-settings/**
  - src/host/slots.ts
  - src/styles.css
  - tests/app-shell*.ts
  - tests/ui-preview*.ts
  - src-tauri/tauri.conf.json
  - src-tauri/src/windows.rs
  - scripts/code-map.manifest.json
  - src/ui/icons.ts
  - plans/2026-10-08-shell-rails-v2-plan.md
  - .agents/notes/proposed/architecture/2026-10-08-shell-rails-v2.*
  - .agents/notes/implemented/architecture/2026-10-08-shell-rails-v2.*
  - docs/architecture.*
  - docs/plugins/contract.*
  - scripts/gen-plugin-template.mjs
  - scripts/gen-plugin-template.spec.mjs
  - plugins-dev/hello/**
  - docs/plugins/authoring.*
  - docs/plugins/dynamic.*
  - src/preview.ts
adr:
  - ../../notes/implemented/architecture/2026-10-08-shell-rails-v2.md
github:
  number: 53
  url: https://github.com/Shadow-Azure/StudyWiki/issues/53
```

## 背景

当前 shell 只有一个低可见性的文件栏拖拽条，右侧 Agent 栏没有同规格拖拽；全局操作与品牌、文件标题挤在顶栏。用户已在 `plans/preview-html/workspace-rails-preview.html` 原型中确认：固定白色 Activity Rail、文件栏/Agent 栏独立折叠、开关进入窗口控制层，且 Agent 栏隐藏不显示红点。

## 目标

- 建立固定 54px Activity Rail，并把全局命令插件迁入 `activity.left`；`topbar.left` 保留为 API v1 兼容别名。
- 文件栏与 Agent 栏共用 12px 命中区、可见反馈、Pointer Capture/rAF、键盘、双击重置的拖拽交互，并支持独立隐藏。
- macOS 主窗与动态窗使用 overlay titlebar；应用内移除 SW 品牌区，面板开关与原生窗口控制同层。
- 持久化两栏宽度和可见性；损坏状态回退默认，多窗口最后写入同步。
- 保持阅读区最小宽度、Agent 子树隐藏期间挂载、外置插件 v1 契约兼容。

## 验收

- Vitest 覆盖槽位归一、四列 shell、两根拖拽条 clamp、开关/快捷键、持久化损坏回退和 Activity Rail 保留。
- `pnpm test`、`cargo test`、`pnpm build`、`pnpm lint:docs`、`pnpm verify:layering` 全绿。
- macOS 安装包手工冒烟确认：overlay traffic lights 不遮挡开关；文件栏隐藏后 Activity Rail 保留；Agent 栏隐藏无红点；两栏宽度重启后恢复。
- 外置 `hello` 示例继续可注册旧槽位并出现在 Activity Rail。
