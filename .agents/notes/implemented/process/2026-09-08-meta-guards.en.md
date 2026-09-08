# Agent Note: Gates for the gates — self-test coverage and wiring protection

Status: implemented

English | [中文](2026-09-08-meta-guards.md)

## Problem

A blueprint comparison (the dsh ten-step docs pipeline) exposed three layers of gaps that no *functional* leaf can catch: ① the complex gates (the three compiler-API ones: export-docs / type-equiv / doc-typecheck) had no self-tests, so regressions only surfaced when the real corpus tripped over them; ② if CI's static lane, run-gates' mode arrays, or AGENTS.md's command list drift or get trimmed, the whole repo goes silently blind — "sync the command list when gate scripts change" was itself a soft requirement with no gate behind it; ③ install-merge-driver.mjs was an orphan script: `.gitattributes` referenced `merge=studywiki-i18n`, yet no command, doc, or install entry pointed at it, so a fresh clone would never install it.

## Decision

- Self-tests now cover every leaf. Fixture mechanism: temp repo root + a chdir window covering both import and call (gates anchor cwd at import; `path.relative("")` reads cwd at call time), shared via `scripts/spec-fixture.mjs`; CLI-shaped scripts (gen-commands-catalog, archive-agent-note) run as subprocess end-to-end. gen-commands-catalog exports its pure functions behind a main guard for testability; run-gates exports `LEAVES`/`MODES` — both pure refactors, CLI behavior unchanged.
- New `ci-wiring.spec.mjs` pins the wiring: mode integrity (doc-quick ⊆ doc-sync, release = doc-sync + verify-release, critical leaves present), embedded steps in ci.yml / release.yml, and a two-way AGENTS.md command list ↔ package.json check — gate-class scripts (`verify:`/`lint:`/`gen:`/`record:`/`archive:`/`install:`/`test`) must be listed, turning the soft requirement into a gate that can go red.
- `pnpm install:hooks` also registers the merge driver: install-merge-driver refactored to an exported `registerMergeDriver()` plus a main guard, called by the hooks installer; the install funnel collapses back to a single command.

## Alternatives considered

- Running every gate test as a subprocess (instead of chdir + dynamic import): more black-box, but each case spawns a TS-compiling process — an order of magnitude slower; vitest's forks pool isolates each test file in its own process, so the chdir window is safe.
- Moving the command list into docs/development.md and leaving a link in AGENTS.md: saves words, but the command list is a standing order needed every session — relocating loses more than it saves. Compressed the new comments and raised the budget instead (below).
- Inlining the merge driver into install-git-hooks: duplicates the driver string in two places; kept the separate script and exported the function for reuse.

## Consequences

- `pnpm test` grows from 4 specs to 12 (70 cases); "touch the gate, touch its spec" becomes a workable discipline.
- AGENTS.md budget 600→660: structural growth of the command list (three gate commands added plus the merge-driver note); compressed first, the remainder justified here. docs/development.md gained one driver sentence on both sides and was re-recorded.
- Left open (explicitly registered; see the same-round analysis in [2026-09-08-close-pipeline-gaps.en.md](2026-09-08-close-pipeline-gaps.en.md)): the postmortem structure gate is deferred until the first incident file exists; the site projection step is absent pending a product decision.
