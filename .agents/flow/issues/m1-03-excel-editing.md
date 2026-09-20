# excel 页面编辑

[English](m1-03-excel-editing.en.md) | 中文

```yaml flow
kind: issue
milestone: m1
priority: P0
status: backlog
scope:
  - src/plugins/doc-excel/**
  - src/styles.css
  - tests/**
  - docs/architecture.*
  - docs/commands.*
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

## 验收

- 编辑保存后重开文件仍保留。
- 脏状态与关闭守卫行为与 doc-markdown 相同。
- `pnpm verify:layering`、`pnpm verify:env-independence`、`pnpm verify:dep-audit` 绿。
