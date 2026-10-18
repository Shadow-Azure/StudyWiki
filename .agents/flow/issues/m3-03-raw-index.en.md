# Raw landing and index

English | [中文](m3-03-raw-index.md)

```yaml flow
kind: issue
milestone: m3
priority: P0
status: backlog
scope:
  - src/plugins/**
  - src/host/**
  - src-tauri/**
  - docs/architecture.*
  - docs/commands.*
adr: []
github:
  number: 34
  url: https://github.com/Shadow-Azure/StudyWiki/issues/34
```

## Background

The raw mirror folder holds only markdown and images; the machine index continues to use #31's `.study-wiki/index.yaml`, recording the "source → artifacts" mapping, SHA-256 content hash, and timestamps for later lookup.

## Goals

- The `.study-wiki/raw/<source-relative-path-without-extension>/` layout.
- Extend `.study-wiki/index.yaml` with raw artifact registration and later fields.

## Acceptance

- A source `./xxxx/yyy/zzzz.mp4` maps to `.study-wiki/raw/xxxx/yyy/zzzz/`, containing only markdown and images.
- The machine-readable fields of index.yaml allow content-hash and timestamp-mapping verification.
