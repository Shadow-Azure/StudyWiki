# Agent host capabilities

English | [中文](m2-02-agent-host.md)

```yaml flow
kind: issue
milestone: m2
priority: P0
status: backlog
scope:
  - src/host/**
  - src/plugins/**
  - src/loader/**
  - docs/architecture.*
  - docs/commands.*
  - docs/plugins/*
adr: []
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
