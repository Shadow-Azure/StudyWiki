# llm-wiki knowledge layer

English | [中文](m2-04-llm-wiki.md)

```yaml flow
kind: issue
milestone: m2
priority: P0
status: in-progress
scope:
  - .agents/flow/issues/m2-04-llm-wiki.*
  - .agents/flow/issues/m3-03-raw-index.*
  - plans/2026-10-18-llm-wiki-*.md
  - walkthrough/assets/m2-04-llm-wiki/**
  - src/plugins/**
  - src/host/**
  - src/loader/**
  - src-tauri/**
  - tests/**
  - docs/architecture.*
  - docs/commands.*
  - scripts/code-map.manifest.json
  - walkthrough/files/**
  - walkthrough/features/**
  - walkthrough/changes/**
  - .agents/notes/**
adr:
  - ../../notes/implemented/architecture/2026-10-18-llm-wiki.md
github:
  number: 31
  url: https://github.com/Shadow-Azure/StudyWiki/issues/31
```

## Background

llm-wiki is the compiled knowledge layer built on the agent (immutable raw + an LLM-maintained wiki + a schema), the key capability for compounding knowledge.

## Goals

- Schema v1 belongs to the `app-wiki` plugin and is injected through the agent prompt contribution seam.
- The agent maintains `.study-wiki/llm-wiki/` with the generic file tools; the program exclusively materializes `.study-wiki/index.yaml`.
- Text sources close the ingest/query/lint loop; video sources only report that m3 transcription is pending.

## Acceptance

- The agent updates wiki pages and appends the log without editing the machine index; query reads `llm-wiki/index.md` first; lint checks contradictions, orphans, and gaps according to the schema.
- `index.yaml` records source path, kind, SHA-256 content hash, size, analysis time, and artifact, and is deterministically rebuilt from surviving artifact evidence.
- `probe_source_file` provides authorized size/mtime/SHA-256; state classification follows same path, same content hash, then unknown, producing fresh/stale/moved/unknown.
- Moved sources re-point the index row while building prompt context; text writes create parent directories automatically.
