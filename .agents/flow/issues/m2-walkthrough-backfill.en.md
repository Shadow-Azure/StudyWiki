# Walkthrough full backfill: file/feature/change pages + bootstrap flag removal

English | [中文](m2-walkthrough-backfill.md)

```yaml flow
kind: issue
milestone: m2
priority: P0
status: in-progress
scope:
  - walkthrough/**
  - scripts/build-walkthrough.mjs
  - scripts/build-walkthrough.spec.mjs
  - scripts/walkthrough-lib.mjs
  - scripts/walkthrough-lib.spec.mjs
  - scripts/verify-walkthrough.mjs
  - scripts/verify-walkthrough.spec.mjs
  - .agents/flow/issues/m2-walkthrough-backfill.*
  - .agents/flow/issues/m2-walkthrough-site.*
  - .agents/notes/implemented/process/2026-10-15-walkthrough-site.*
  - plans/2026-10-15-walkthrough-backfill.md
adr: []
github:
  number: 59
  url: https://github.com/Shadow-Azure/StudyWiki/issues/59
```

## Background

The mechanism skeleton has merged in PR #58, and walkthrough is still in the bootstrap downgrade period: 65 source files have no file pages, 9 change pages are missing, and explanation line coverage is 0. The file-page, change, and coverage gate tiers issue warnings only, so the freshness contract after backfill is not yet truly enforced.

## Goals

- Backfill file pages for 65 source files in six batches, prioritizing public exits, state machines, boundaries, and failure handling.
- Complete 13 feature pages and 10 change pages while keeping source code, flow issues, and walkthrough content reconcilable.
- Reach ≥90% line coverage, registering only reasoned exemptions when necessary.
- Remove the manifest bootstrap flag so the three downgrade tiers turn fully red.

## Acceptance

- All gates are green.
- After bootstrap removal, the file-page, change, and coverage tiers move from downgraded warnings to fully red checks and pass.
- Feature, file, and change page diffs pass maintainer skimming; explanations explain why and what-for rather than restating code.
