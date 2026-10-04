# Basic agent plugin

English | [中文](m2-03-basic-agent.md)

```yaml flow
kind: issue
milestone: m2
priority: P0
status: in-progress
scope:
  - .agents/flow/issues/m2-03-basic-agent.*
  - src/plugins/**
  - src/host/**
  - src/ui/**
  - src/styles.css
  - src-tauri/**
  - tests/**
  - package.json
  - .agents/notes/**
  - scripts/code-map.manifest.json
  - scripts/doc-budgets.manifest.json
  - scripts/dep-allowlist.json
  - docs/architecture.*
  - docs/commands.*
  - docs/plugins/*
  - docs/environment-independence.*
adr:
  - ../../notes/proposed/architecture/2026-10-04-basic-agent.md
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
