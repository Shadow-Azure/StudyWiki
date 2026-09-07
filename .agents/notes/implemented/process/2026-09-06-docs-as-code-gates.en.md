# Agent Note: docs-as-code gate system

Status: implemented

English | [中文](2026-09-06-docs-as-code-gates.md)

## Problem

Early on, the project had no documentation discipline, and knowledge drifts and rots alongside code. A mechanism matched to the project's scale — and able to grow with it — is needed; its core principle comes from the blueprint (deepseek-harness): "behind every consistency requirement stands a script that can go red; humans only make judgments".

## Decision

Gate leaves + a scheduler (zero-dependency node scripts, `scripts/run-gates.mjs`), currently nine leaves:

- `verify-agent-notes`: lifecycle × class closed sets, first-three-lines format, Status/folder cross-check, reachable cross-reference links (the `.en.md` side is governed by the pairing gate).
- `verify-doc-index`: every `docs/**/*.md` (except postmortem incident files and `.en.md` sides) must be registered in the `docs/README.md` map table.
- `verify-doc-budgets`: word-count caps on resident docs (registered in a manifest, attached to the base side only); over budget goes red.
- `verify-md-links`: relative links inside docs and Notes are reachable.
- `verify-env-independence`: source/config/artifact checks for the environment-independence constraint.
- `verify-translation-pairing`: bilingual triplets (hash + structure signature + switcher line + link locale + generated regions).
- `verify-type-equiv`: type-equiv fences are verbatim-equal to source, manifest is 1:1.
- `doc-typecheck`: plain ts fences are really compiled.
- `verify-commands-catalog`: freshness of the commands-catalog generated region (gen --check).

Tiered composition: `doc-quick` (seconds) and `doc-sync` (full) and `release`; CI's static lane embeds doc-sync, ruling out "CI forgot to configure". At initialization, bilingual/type-equiv/generated catalogs were trimmed under a monolingual-small-repo assumption; restored on 2026-09-07 (decision and direction in [2026-09-07-restore-docs-pipeline.en.md](2026-09-07-restore-docs-pipeline.en.md)). The VitePress projection site is still deferred.

## Alternatives considered

- **Convention only, no gates**: conventions inevitably drift; the blueprint already proved mechanization is the only path that keeps consistency alive long-term.
- **Off-the-shelf tools (markdownlint / vale)**: fine as future supplements, but they don't cover project-specific invariants like "index registration" or "Note state machine".

## Consequences

- New documentation species require syncing both `verify-doc-index`'s exception list and `docs/README.md`.
- Gate scripts are a third language besides Rust+TS; keep them zero-dependency node so the constraint stays unpolluted (build tools may depend on the environment, artifacts may not — boundary in [docs/environment-independence.en.md](../../../../docs/environment-independence.en.md)). type-equiv/doc-typecheck exceptionally borrow the existing typescript devDep.
- When doc scale trips a restoration condition listed in `docs/README.md` (e.g. a publishing site is needed), a new Agent Note must record it and restore the corresponding mechanism.
