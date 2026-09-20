# llm-wiki knowledge layer

English | [中文](m2-04-llm-wiki.md)

```yaml flow
kind: issue
milestone: m2
priority: P0
status: backlog
scope:
  - src/plugins/**
  - src/host/**
  - docs/architecture.*
  - .agents/notes/**
adr: []
github:
  number: 31
  url: https://github.com/Shadow-Azure/StudyWiki/issues/31
```

## Background

llm-wiki is the compiled knowledge layer built on the agent (immutable raw + an LLM-maintained wiki + a schema), the key capability for compounding knowledge.

## Goals

- The `.study-wiki/wiki/` structure: index/log/overview/concepts/entities/sources.
- The ingest/query/lint workflows plus a schema contract.

## Acceptance

- ingest updates the index and related pages and appends the log; query reads the index first; lint finds contradictions/orphans/gaps.
