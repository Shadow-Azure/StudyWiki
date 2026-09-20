# Local ASR helper

English | [中文](m3-04-local-asr-helper.md)

```yaml flow
kind: issue
milestone: m3
priority: P2
status: backlog
scope:
  - src/plugins/**
  - src-tauri/**
  - docs/environment-independence.*
  - .agents/notes/**
adr:
  - ../../notes/proposed/architecture/2026-09-19-ai-inference-supply.md
github:
  number: 35
  url: https://github.com/Shadow-Azure/StudyWiki/issues/35
```

## Background

An optional helper that downloads and quickly starts a local small ASR model; it has environment requirements and needs environment detection.

## Goals

- Download and start a local ASR service, with environment detection and clear failure guidance.
- Settle the runtime form here (WASM vs a host-native runtime).

## Acceptance

- It enables only when a usable environment is detected; otherwise it gives actionable guidance; it is excluded from the offline guarantee.
