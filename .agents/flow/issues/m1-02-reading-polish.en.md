# Reading experience unification

English | [中文](m1-02-reading-polish.md)

```yaml flow
kind: issue
milestone: m1
priority: P1
status: backlog
scope:
  - src/plugins/app-shell/**
  - src/plugins/view-filetree/**
  - src/plugins/doc-markdown/**
  - src/plugins/doc-video/**
  - src/plugins/doc-excel/**
  - src/styles.css
  - src/ui/**
adr: []
github:
  number: 27
  url: https://github.com/Shadow-Azure/StudyWiki/issues/27
```

## Background

The three format viewers each work, but switching, empty states, shortcuts, and visuals are still inconsistent, short of the prototype goal of "good UX".

## Goals

- Unify open, switch, empty-state, and keyboard interaction across markdown / excel / video.
- Polish visual details without introducing a UI framework.

## Acceptance

- Switching across the three formats is consistent in one window, and empty states for "no document opened" and "library opened but none selected" are clear.
- `pnpm verify:layering` and `pnpm verify:env-independence` are green.
