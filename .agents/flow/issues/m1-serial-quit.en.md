# Multi-window serial quit state machine

English | [中文](m1-serial-quit.md)

```yaml flow
kind: issue
milestone: m1
priority: P2
status: backlog
scope:
  - .agents/flow/issues/m1-serial-quit.*
  - .agents/flow/milestones/m1-prototype-shell.*
  - src-tauri/src/**
  - tests/**
  - docs/architecture.*
  - docs/commands.*
  - scripts/code-map.manifest.json
  - .agents/notes/**
adr: []
github:
  number: 47
  url: https://github.com/Shadow-Azure/StudyWiki/issues/47
```

## Background

After PR #46 fixed native close/quit bypassing the frontend guards on macOS, cross-window `Cmd+Q` orchestration still has two gaps: the `terminate:` hook evals all armed windows **concurrently**, so confirmation dialogs appear together and whichever window is confirmed first is destroyed irreversibly; unarmed windows (such as a second window sitting on the welcome screen) are absent from the close list, so after all confirmations the app remains alive on the leftover window and `Cmd+Q` must be pressed again. Autosave is explicitly rejected (see the plugin-architecture Note), so many unsaved windows are a normal state and quit orchestration must close reliably.

## Goals

- `Cmd+Q` confirms windows **serially**: window 2 is only asked after window 1 is confirmed discarded and destroyed.
- Any cancellation stops the quit flow immediately, **focuses that window**, and skips all remaining windows.
- Unarmed windows join the close queue as the tail; the app exits normally after the queue drains, covering mixed armed/unarmed scenarios.
- The quit-session state machine defines race semantics: repeated `Cmd+Q` during a session, a per-window red button concurrent with the session, and a window destroyed by another path while awaiting confirmation all behave predictably and idempotently.
- The queue scales to many unsaved windows.

## Acceptance

- Rust state-machine tests pin queue creation, per-window advancement, cancel-and-focus, unarmed tail drain, and idempotency for repeated quits and mid-session window destruction.
- The frontend bridge distinguishes quit sessions from single-window closes; the cancellation-report path is tested.
- Any new report command lands in the generated commands catalog; an owning Note triplet records the orchestration decision and race trade-offs.
- Manual macOS acceptance: with mixed armed/unarmed windows, `Cmd+Q` asks serially, cancellation focuses the window, full confirmation exits the app, and unarmed windows are drained.
