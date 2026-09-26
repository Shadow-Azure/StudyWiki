# Excel page editing

English | [中文](m1-03-excel-editing.md)

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

## Background

The viewer and shared read/write service exist, but people still need page-based cell and style editing; this is the human editing surface promised by the approved design.

## Goals

- Support cell value editing plus font, color, and merge style controls.
- Maintain a dirty flag and close guard with the same behavior as doc-markdown.
- Save through `ctx.excel.write`; preserve data and styles while explicitly not promising lossless charts / pivot tables.
- In-process Tauri `Request` integration tests for the raw binary IPC land with this issue — the write path only has real users once editing exists; until then coverage is the frontend IPC contract pins plus Rust header decode/authorize unit tests.

## Acceptance

- Edits remain present after saving and reopening the file.
- Dirty state and the close guard behave the same as doc-markdown.
- Raw binary IPC in-process `Request` integration tests cover both read and write paths and are green.
- `pnpm verify:layering`, `pnpm verify:env-independence`, and `pnpm verify:dep-audit` are green.
