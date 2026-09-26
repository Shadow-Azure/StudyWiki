# Excel drag range selection

English | [中文](m1-excel-drag-select.md)

```yaml flow
kind: issue
milestone: m1
priority: P2
status: backlog
scope:
  - src/plugins/doc-excel/**
  - src/styles.css
  - tests/**
adr:
  - ../../notes/implemented/feature/2026-09-20-excel-viewer.md
github:
  number: null
  url: null
```

## Background

The selection model shipped with m1-03 covers click + Shift-click only. Drag selection conflicts with virtual scrolling: rows beyond the viewport are unmounted, requiring edge auto-scroll and index-based tracking. Most of the cost sits on the scroll-interaction boundary, so it is split into this independent low-priority issue, which depends on the m1-03 selection model landing first.

## Goals

- Press-and-drag extends a rectangular selection, coexisting with click, Shift-click, and inline editing.
- Dragging against the viewport edge auto-scrolls and keeps extending; the selection is tracked by row/column indices, not mounted DOM nodes.
- Selection normalization and merged-cell hit rules reuse the m1-03 selection model; toolbar style operations apply to drag selections.

## Acceptance

- Drag selection across the viewport (with auto-scroll) yields the correct range, including unmounted rows.
- Style controls (bold/italic/colors/merge) act on drag selections identically to Shift selections.
- Existing interactions (click select, Shift extend, double-click edit) do not regress; tests stay green.
- `pnpm verify:layering`, `pnpm verify:env-independence`, and `pnpm verify:dep-audit` are green.
