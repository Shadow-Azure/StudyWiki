# Excel viewer

English | [中文](m1-01-excel-viewer.md)

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

## Background

The prototype requires three readable formats — markdown / excel / video; the markdown and video viewers exist, excel is missing.

## Goals

- When the active file is an excel file, render a table view with multi-sheet switching.
- The parsing library must be bundled at build time (an environment-independence corollary); no CDN or runtime loading.

## Acceptance

- Opening an .xlsx file allows reading sheet by sheet; fidelity of styling is not a goal but content is complete.
- `pnpm verify:env-independence` and `pnpm verify:dep-audit` are green.
