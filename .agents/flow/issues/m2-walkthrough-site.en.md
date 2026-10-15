# Walkthrough engineering site: mechanism skeleton

English | [中文](m2-walkthrough-site.md)

```yaml flow
kind: issue
milestone: m2
priority: P0
status: in-progress
scope:
  - walkthrough/**
  - scripts/walkthrough-lib.mjs
  - scripts/walkthrough-yaml.mjs
  - scripts/verify-walkthrough.mjs
  - scripts/build-walkthrough.mjs
  - scripts/*walkthrough*.spec.mjs
  - scripts/run-gates.mjs
  - scripts/route-gates.mjs
  - scripts/route-gates.spec.mjs
  - scripts/gate-coverage.spec.mjs
  - scripts/ci-wiring.spec.mjs
  - package.json
  - docs/AGENTS.md
  - docs/commands.md
  - AGENTS.md
  - .gitignore
  - .github/workflows/ci.yml
  - plans/2026-10-15-walkthrough-*
  - .agents/notes/**/2026-10-15-walkthrough-site.*
adr:
  - ../../notes/implemented/process/2026-10-15-walkthrough-site.md
github:
  number: 57
  url: https://github.com/Shadow-Azure/StudyWiki/issues/57
```

## Background

AI produces code far faster than the maintainer can read and review it. The repo already has docs-as-code gates and a flow state machine, but lacks a human-facing engineering comprehension surface: no aggregated walkthrough when a feature spans many files, no per-file annotation layer for implementation details, and PRs show only diffs without layered functional/architectural/code narratives. Research and the target shape live in plans/2026-10-15-walkthrough-design.md; this issue covers the mechanism skeleton only — full content backfill gets its own issue.

## Goals

- A yaml-subset parser (zero new dependencies) and the walkthrough-lib pure library: schema validation, content-snapshot snippet locating, four reconciliation checks (file pages⇆code-map, feature registry, changes⇆flow issues, line coverage), and PR diff checks.
- The nine verify:walkthrough gates: seven static (schema/anchors/file-page reconciliation/feature reconciliation/change reconciliation/line coverage/build-as-proof) plus two diff gates (code-touched-must-touch-page, exhaustive touches); the manifest's bootstrap flag downgrades file-page/change/coverage tiers to warnings during the skeleton phase.
- The build-walkthrough generator: YAML → multi-page static HTML (overview/architecture/features/files/changes cross-linked, opens via file://; snapshots locate only, displayed code is pulled from live sources at build time).
- The walkthrough/ directory contract (README) and skeleton content (overview/architecture drafts, empty feature registry, manifest).
- Wiring: pnpm walkthrough and pnpm verify:walkthrough commands, run-gates/route-gates/CI mounts, root AGENTS.md command list, docs/AGENTS.md layer table registration.

## Acceptance

- walkthrough-yaml, walkthrough-lib, verify-walkthrough, build-walkthrough each ship vitest specs; every gate rule has representative-path cases (including the five Review Focus pins).
- pnpm test, pnpm verify:docs, and pnpm verify:flow all green.
- pnpm walkthrough builds successfully; the output navigates overview→architecture→cross-links under file://.
- Documentation registration done and verify:commands green.
