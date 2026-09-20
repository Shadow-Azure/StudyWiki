# Excel viewer

English | [中文](m1-01-excel-viewer.md)

```yaml flow
kind: issue
milestone: m1
priority: P0
status: backlog
scope:
  - .agents/notes/proposed/feature/2026-09-20-excel-viewer.*
  - src/host/excel.ts
  - src/host/files.ts
  - src/types.ts
  - src/plugins/doc-excel/**
  - src/loader/table.ts
  - src-tauri/**
  - docs/architecture.*
  - docs/commands.*
  - package.json
  - pnpm-lock.yaml
  - scripts/dep-allowlist.json
adr:
  - ../../notes/proposed/feature/2026-09-20-excel-viewer.md
github:
  number: 25
  url: https://github.com/Shadow-Azure/StudyWiki/issues/25
```

## Background

The prototype requires three readable formats — markdown / excel / video; the markdown and video viewers exist, excel is missing.

## Goals

- When the active file is an excel file, render a table view with multi-sheet switching.
- The parsing library must be bundled at build time (an environment-independence corollary); no CDN or runtime loading.

## Acceptance

- Opening an .xlsx file allows reading sheet by sheet; fidelity of styling is not a goal but content is complete.
- `pnpm verify:env-independence` and `pnpm verify:dep-audit` are green.
