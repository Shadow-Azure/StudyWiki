# Basic agent plugin

English | [中文](m2-03-basic-agent.md)

```yaml flow
kind: issue
milestone: m2
priority: P0
status: in-progress
scope:
  - .agents/flow/issues/m2-03-basic-agent.*
  - .agents/notes/**
  - .agents/plans/**
  - .gitignore
  - docs/README.*
  - docs/architecture.*
  - docs/commands.*
  - docs/environment-independence.*
  - docs/plugins/*
  - package.json
  - pnpm-lock.yaml
  - scripts/code-map.manifest.json
  - scripts/dep-allowlist.json
  - scripts/doc-budgets.manifest.json
  - scripts/install-git-hooks.*
  - src/host/**
  - src/loader/**
  - src/plugins/**
  - src/preview.ts
  - src/styles.css
  - src-tauri/**
  - src/ui/**
  - tests/**
adr:
  - ../../notes/implemented/architecture/2026-10-04-basic-agent.md
github:
  number: 30
  url: https://github.com/Shadow-Azure/StudyWiki/issues/30
```

## Background

A first agent plugin with basic capabilities is needed (the pi/dsh intersection): multi-turn context + read/grep/write/edit + note persistence.

## Goals

- A multi-turn session state machine that keeps history.
- Four tools (read/grep/write/edit) plus note writing into the wiki.

## Acceptance

- Multi-turn conversation with the agent works; read/grep can search the library and wiki, and write/edit can persist notes.
- Sessions persist as JSONL; historical sessions can be loaded, and the loop continues once the user sends a new message.
- Writes go through the two approval modes (ask-for-approval / approve-for-me); reads outside the authorized set are dynamically authorized via approval (session-scoped); writes never cross the boundary in any mode.

## Landing record

- 2026-10-05 (CI fix): scope extended with `.agents/plans/**` (implementation plan file), `.gitignore` (sidecar artifact ignore), `docs/README.*` (index link for the agent plugin page), `pnpm-lock.yaml` (@vscode/ripgrep install), `src/loader/**` (module table +app-agent/−app-chat), `src/preview.ts` (preview harness drops the app-chat import), `scripts/install-git-hooks.*` (pre-push gains a src-tauri rustfmt reminder) — all natural companions of the implementation.
