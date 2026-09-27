# Reading experience unification

English | [中文](m1-02-reading-polish.md)

```yaml flow
kind: issue
milestone: m1
priority: P1
status: in-progress
scope:
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
  - tests/**
  - docs/architecture.*
  - scripts/code-map.manifest.json
  - .agents/notes/implemented/feature/2026-09-27-reading-polish.*
  - .agents/flow/issues/m1-02-reading-polish.*
adr:
  - ../../notes/implemented/feature/2026-09-27-reading-polish.md
github:
  number: 27
  url: https://github.com/Shadow-Azure/StudyWiki/issues/27
```

## Background

The three format viewers each work, but switching, empty states, shortcuts, and visuals are still inconsistent, short of the prototype goal of "good UX".

## Goals

- Unify open, switch, empty-state, and keyboard interaction across markdown / excel / video.
- When markdown or excel has unsaved changes, switching files or libraries must confirm first instead of silently discarding work.
- Unify loading, errors, window titles, and the save shortcut; add video load/error feedback and common playback keys.
- Polish visual details without introducing a UI framework.

## Acceptance

- Switching across the three formats is consistent in one window, and empty states for "no document opened" and "library opened but none selected" are clear.
- Dirty documents guard file and root switches; switching continues only after confirmation. Reopening the same path neither asks twice nor silently reloads.
- `Mod-S` works globally for markdown / excel, and video supports Space plus left/right arrows; all three formats share one loading/error visual kit.
- `pnpm test`, `pnpm build`, `pnpm verify:layering`, and `pnpm verify:env-independence` are green.
