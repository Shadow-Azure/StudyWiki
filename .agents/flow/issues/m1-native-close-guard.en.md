# Fix dirty-document loss on native close and quit

English | [中文](m1-native-close-guard.md)

```yaml flow
kind: issue
milestone: m1
priority: P0
status: in-progress
scope:
  - .agents/flow/issues/m1-native-close-guard.*
  - .agents/flow/milestones/m1-prototype-shell.*
  - .agents/notes/**
  - src/host/windows.ts
  - src/bootstrap.ts
  - src-tauri/**
  - tests/**
  - docs/architecture.*
  - docs/commands.*
  - scripts/code-map.manifest.json
  - package.json
  - pnpm-lock.yaml
adr:
  - ../../notes/implemented/architecture/2026-09-29-native-close-guard.md
github:
  number: 45
  url: https://github.com/Shadow-Azure/StudyWiki/issues/45
```

## Background

Native macOS close and quit paths can bypass the frontend `CloseRequestedEvent.preventDefault()` call and silently discard dirty Markdown / Excel documents. File switching and library switching guards work, so the guard state machine is sound and the risk is isolated to the native lifecycle.

## Goals

- Route native close and app quit through synchronous main-process cancellation followed by explicit destroy.
- Aggregate document plugin guards per window; any dirty-document cancellation prevents destruction, while clean windows close without prompting.

## Acceptance

- Frontend tests cover clean close, confirmed discard, cancelled discard, and competing guards.
- Rust tests cover the readiness registry; frontend tests prove unready / fully-unsubscribed windows do not enable synchronous native cancellation.
- `pnpm test`, `cargo test`, and the relevant documentation / flow / layering gates pass.
