# Agent host capabilities

English | [中文](m2-02-agent-host.md)

```yaml flow
kind: issue
milestone: m2
priority: P0
status: in-progress
scope:
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
