# excel 查看器

[English](m1-01-excel-viewer.en.md) | 中文

```yaml flow
kind: issue
milestone: m1
priority: P0
status: done
scope:
  - .agents/flow/issues/m1-01-excel-viewer.*
  - .agents/flow/README.*
  - .agents/notes/proposed/feature/2026-09-20-excel-viewer.*
  - .agents/flow/issues/m1-03-excel-editing.*
  - .agents/notes/implemented/feature/2026-09-20-excel-viewer.*
  - .agents/plans/**
  - .agents/flow/milestones/m1-prototype-shell.*
  - tests/**
  - src/host/excel.ts
  - src/host/files.ts
  - src/types.ts
  - src/bootstrap.ts
  - src/host/context.d.ts
  - src/styles.css
  - src/plugins/doc-excel/**
  - src/plugins/view-filetree/**
  - src/plugins/app-shell/**
  - src/loader/table.ts
  - src/ui/icons.ts
  - src-tauri/**
  - docs/architecture.*
  - docs/commands.*
  - package.json
  - pnpm-lock.yaml
  - scripts/dep-allowlist.json
  - scripts/code-map.manifest.json
  - scripts/verify-flow.mjs
  - scripts/verify-flow.spec.mjs
  - scripts/verify-dep-audit.*
  - scripts/__fixtures__/**
  - scripts/gen-plugin-template.spec.mjs
  - plans/**
adr:
  - ../../notes/implemented/feature/2026-09-20-excel-viewer.md
github:
  number: 25
  url: https://github.com/Shadow-Azure/StudyWiki/issues/25
```

## 背景

原型要求 markdown / excel / 视频三格式可读；markdown 与视频查看器已在，excel 缺席。

## 目标

- 活动文件为 excel 时渲染表格视图，支持多 sheet 切换。
- 解析库必须构建期打包（环境无关性推论），禁 CDN / 运行时加载。

## 验收

- 打开 .xlsx 文件可逐 sheet 阅读，样式不追求还原但内容完整。
- `pnpm verify:env-independence`、`pnpm verify:dep-audit` 绿。
