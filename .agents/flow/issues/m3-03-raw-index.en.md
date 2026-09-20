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

The raw mirror folder holds only markdown and images; a machine index records the "source → artifacts" mapping, md5, and timestamps for later lookup.

## Goals

- The `.study-wiki/raw/<source-relative-path-without-extension>/` layout.
- `.study-wiki/index.md` (a yaml fence) records mapping + md5 + timestamps.

## Acceptance

- A source `./xxxx/yyy/zzzz.mp4` maps to `.study-wiki/raw/xxxx/yyy/zzzz/`, containing only markdown and images.
- The machine-readable fields of index.md allow md5 and timestamp-mapping verification.
