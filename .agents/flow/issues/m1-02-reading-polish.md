# 阅读体验统一

[English](m1-02-reading-polish.en.md) | 中文

```yaml flow
kind: issue
milestone: m1
priority: P1
status: done
scope:
  - .agents/flow/issues/m1-02-reading-polish.*
  - src/plugins/app-shell/**
  - src/plugins/app-windows/**
  - src/plugins/view-filetree/**
  - src/plugins/doc-markdown/**
  - src/plugins/doc-video/**
  - src/plugins/doc-excel/**
  - src/styles.css
  - src/ui/**
  - src/bootstrap.ts
  - src/host/context.d.ts
  - src/host/workspace.ts
  - src/loader/guard.ts
  - src/host/windows.ts
  - src-tauri/src/**
  - src-tauri/tests/**
  - tests/**
  - docs/architecture.*
  - docs/commands.*
  - scripts/code-map.manifest.json
  - .agents/notes/implemented/feature/2026-09-27-reading-polish.*
  - .agents/flow/issues/m1-02-reading-polish.*
adr:
  - ../../notes/implemented/feature/2026-09-27-reading-polish.md
github:
  number: 27
  url: https://github.com/Shadow-Azure/StudyWiki/issues/27
```

## 背景

三格式查看器各自可用，但切换、空态、快捷键与视觉仍有不一致，尚未达到「用户体验不错」的原型目标。

## 目标

- 统一 markdown / excel / 视频的打开、切换、空态与键盘交互。
- markdown / excel 有未保存修改时，切换文件或换库必须先确认，不再静默丢弃。
- 统一加载、错误、窗口标题与保存快捷键；补齐视频加载错误提示和常用播放键。
- 打磨视觉细节，不引入 UI 框架。

## 验收

- 三格式在同一窗口内切换一致，未打开文档与已开库未选文档的空态明确。
- 脏文档切换 / 换库会被守卫拦下，确认后才继续；同路径重开不重复确认且不静默重载。
- markdown / excel 的 `Mod-S` 全局可用，视频支持 Space 与左右方向键；加载与错误态三格式共享同一视觉套件。
- `pnpm test`、`pnpm build`、`pnpm verify:layering`、`pnpm verify:env-independence` 绿。
