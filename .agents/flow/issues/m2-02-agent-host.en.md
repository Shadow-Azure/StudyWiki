# Agent host capabilities

English | [中文](m2-02-agent-host.md)

```yaml flow
kind: issue
milestone: m2
priority: P0
status: in-progress
scope:
  - .agents/flow/issues/m2-02-agent-host.*
  - src/host/**
  - src/plugins/**
  - src/ui/**
  - src/loader/**
  - src-tauri/**
  - src/styles.css
  - tests/**
  - package.json
  - .agents/notes/**
  - .agents/plans/**
  - scripts/code-map.manifest.json
  - scripts/doc-budgets.manifest.json
  - scripts/dep-allowlist.json
  - docs/architecture.*
  - docs/commands.*
  - docs/plugins/*
adr:
  - ../../notes/proposed/architecture/2026-10-01-agent-host-streaming.md
github:
  number: 29
  url: https://github.com/Shadow-Azure/StudyWiki/issues/29
```

## Background

Plugging an AI agent into external plugins needs host-side inference, a chat UI slot, and context-sourcing interfaces; the current host has only file/window/workspace/plugin services and no agent surface.

## Goals

- A host inference service (via the configurable endpoint, OpenAI-compatible).
- A chat UI slot and context-sourcing interfaces (read the active file, raw, and wiki index).

## Acceptance

- External plugins can run inference, render chat, and read context through host services without touching `@tauri-apps/*`.
- `pnpm verify:layering` and `pnpm verify:env-independence` are green.

Landing record (2026-10-01):

- Pipeline: external plugins call `ctx.llm.chatStream` through the guard whitelist; host `src/host/llm-stream.ts` owns the FIFO queue and chunk-to-message assembly, while consumers read only `ChatStreamHandle.snapshot()`; Rust hand-rolled SSE parsing feeds `ipc::Channel`, with explicit `llm_chat_abort` stopping and a send-failure backstop.
- Commands and errors: the generated command catalog registers `llm_chat_stream` / `llm_chat_abort`; the external `llm` surface is `listEndpoints`/`probe`/`chat`/`chatStream`; the error vocabulary adds `STREAM_CLOSED` / `UNSUPPORTED_CONTENT`.
- UI: `sidebar.right` is the fourth slot and registers `app-chat`, with rAF streaming Markdown/reasoning, stop, failure retry, and model selection; pasted/dropped image/audio become inline sources; llm-settings gains an audio capability checkbox.
- Attachments and context: media sources union path (Rust reads and base64-encodes at egress)/inline (never persisted)/url (passed through to the provider); the workspace facade exposes activeFile/events/openFile/guardSwitch, chat shows the active filename, and the wiki index remains m2-04. The first 📎 is disabled because the host has no file-dialog seam yet.
- Gates: `vitest run` is green across 63 files / 461 tests; `cargo test` is 76/76 green; `verify:layering` / `verify:env-independence` / `verify:dep-audit` / `verify:flow` / `verify:commands` are green; after recording this issue, `lint:docs` and `verify:docs` are rerun to confirm.
