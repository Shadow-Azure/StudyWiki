# Model supply decision and inference service

English | [中文](m2-01-ai-inference-supply.md)

```yaml flow
kind: issue
milestone: m2
priority: P0
status: backlog
scope:
  - src-tauri/**
  - src/host/**
  - src/plugins/**
  - docs/environment-independence.*
  - docs/architecture.*
  - docs/commands.*
  - package.json
  - scripts/dep-allowlist.json
  - .agents/notes/**
adr:
  - ../../notes/proposed/architecture/2026-09-19-ai-inference-supply.md
github:
  number: 28
  url: https://github.com/Shadow-Azure/StudyWiki/issues/28
```

## Background

Environment independence conflicts directly with AI inference; the decision is "configurable remote endpoint + self-hosted closed loop", which needs its configuration contract landed and the exemption registered.

## Goals

- Land the LLM/VLM/ASR endpoint configuration contract (base URL / model / key).
- Register the exemption in environment-independence.md and file the ADR.

## Acceptance

- The three endpoint kinds are configurable and probeable, with clear error semantics; the product ships no key.
- The exemption and ADR are registered, and `pnpm verify:env-independence` is green.
