# excel 页面编辑

[English](m1-03-excel-editing.en.md) | 中文

```yaml flow
kind: issue
milestone: m1
priority: P0
status: in-progress
scope:
  - src/plugins/doc-excel/**
  - src/styles.css
  - tests/**
  - docs/architecture.*
  - docs/commands.*
  - src-tauri/**
  - scripts/code-map.manifest.json
  - .agents/flow/issues/m1-03-excel-editing.*
  - .agents/flow/issues/m1-excel-drag-select.*
  - .agents/notes/implemented/feature/2026-09-20-excel-viewer.*
adr:
  - ../../notes/implemented/feature/2026-09-20-excel-viewer.md
github:
  number: 40
  url: https://github.com/Shadow-Azure/StudyWiki/issues/40
```

## 背景

查看器与共享读写服务已经落地，但用户仍需要在页面上编辑单元格与样式；这是已批准设计承诺的人用编辑面。

## 目标

- 支持单元格值编辑，以及字体、颜色和合并样式控件。
- 维护脏标记与关闭守卫，行为与 doc-markdown 一致。
- 保存经 `ctx.excel.write` 落盘；保留数据与样式，但明确不承诺图表 / 数据透视表无损。
- raw binary IPC 的 in-process `Request` 集成测试随本 issue 一并补齐——编辑落地后写路径才有真实用户，此前由前端 IPC 契约钉样与 Rust header 解码/授权单测覆盖。

## 验收

- 编辑保存后重开文件仍保留。
- 脏状态与关闭守卫行为与 doc-markdown 相同。
- raw binary IPC in-process `Request` 集成测试覆盖读与写两条路径并绿。
- `pnpm verify:layering`、`pnpm verify:env-independence`、`pnpm verify:dep-audit` 绿。
