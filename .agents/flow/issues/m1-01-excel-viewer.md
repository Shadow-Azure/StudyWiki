# excel 查看器

[English](m1-01-excel-viewer.en.md) | 中文

```yaml flow
kind: issue
milestone: m1
priority: P0
status: backlog
scope:
  - src/plugins/doc-excel/**
  - src/loader/table.ts
  - src-tauri/**
  - docs/architecture.*
  - docs/commands.*
  - package.json
  - pnpm-lock.yaml
  - scripts/dep-allowlist.json
adr: []
github:
  number: null
  url: null
```

## 背景

原型要求 markdown / excel / 视频三格式可读；markdown 与视频查看器已在，excel 缺席。

## 目标

- 活动文件为 excel 时渲染表格视图，支持多 sheet 切换。
- 解析库必须构建期打包（环境无关性推论），禁 CDN / 运行时加载。

## 验收

- 打开 .xlsx 文件可逐 sheet 阅读，样式不追求还原但内容完整。
- `pnpm verify:env-independence`、`pnpm verify:dep-audit` 绿。
