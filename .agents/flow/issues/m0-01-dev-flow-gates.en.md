# Land the development-flow gates

English | [中文](m0-01-dev-flow-gates.md)

```yaml flow
kind: issue
milestone: m0
priority: P0
status: done
scope:
  - scripts/**
  - .agents/flow/**
  - .agents/notes/**
  - .github/**
  - package.json
  - AGENTS.md
  - docs/development.*
  - docs/AGENTS.md
  - docs/i18n/README.*
  - docs/environment-independence.*
adr:
  - ../../notes/implemented/process/2026-09-19-dev-flow-gates.md
github:
  number: 24
  url: https://github.com/Shadow-Azure/StudyWiki/issues/24
```

## Background

Ad-hoc development has no flow constraints, and requirements scattered across conversations cannot settle. A mechanical roadmap → milestone → issue → ADR gate is needed, enforcing "file an issue first, stay inside the milestone, advance by priority".

## Goals

- Flow working files and their contract live in `.agents/flow/` (as trios).
- The offline verify-flow gate enters doc-quick / doc-sync / release; the --diff mode and the online lane enter CI.
- A commit-msg hook enters install:hooks.
- Companion tooling: flow:sync and flow:new-issue.

## Acceptance

- `pnpm verify:flow` is green; `pnpm verify:docs` and `pnpm test` are green.
- The flow tree contains the roadmap, milestones m0–m4, and this issue; the prototype requirements are decomposed into m1–m4.
- The number is backfilled (#24) and the bootstrap flag is gone with it; the PR title carries a `(#24)` reference.
