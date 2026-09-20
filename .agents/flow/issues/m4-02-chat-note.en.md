# Interaction note persistence

English | [中文](m4-02-chat-note.md)

```yaml flow
kind: issue
milestone: m4
priority: P0
status: backlog
scope:
  - src/plugins/**
  - src/host/**
  - docs/architecture.*
adr: []
github:
  number: 37
  url: https://github.com/Shadow-Azure/StudyWiki/issues/37
```

## Background

Interactions must settle into the source folder's AI-chat-note.md and backfill llm-wiki to compound knowledge.

## Goals

- Append Q&A to `.study-wiki/raw/<source>/AI-chat-note.md`.
- Backfill valuable conclusions into the wiki layer and update index/log.

## Acceptance

- Interactions land in AI-chat-note.md; backfill updates wiki index/log.
