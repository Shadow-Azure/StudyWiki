# Agent Note: Closing the blueprint pipeline gaps (except the site projection)

Status: implemented

English | [中文](2026-09-08-close-pipeline-gaps.md)

## Problem

A review against the blueprint's ten-step pipeline (context: [2026-09-07-restore-docs-pipeline.en.md](2026-09-07-restore-docs-pipeline.en.md)) surfaced six gaps: the gate scripts themselves had zero tests; three comments referenced an archival gate that does not exist; exported doc comments had no enforcement end (both lib.rs commands lacked `///`, leaving the command catalog bare signatures); local git hooks were absent; verify-md-links claimed external links were the "site projection's" responsibility while no projection exists; and the root had no CLAUDE.md symlink, so agent sessions did not auto-load the standing rules. The site projection (step 8) stays deferred.

## Decision

- The archival freeze gate lands for real (verify-archived-agent-notes, a doc-quick leaf): archived/ triplets freeze whole, every file's sha256 recorded in an append-only manifest (cross-checked against git HEAD to catch edits/removals); the `pnpm archive:note` helper does the move, the Status rewrite, and the hash recording; frozen records leave the living-corpus checks (pairing, fence compilation, links).
- New gate verify-export-docs (a doc-quick leaf): top-level exports in src/ must carry JSDoc, functions must have `@param`/`@returns` (void exempt); `#[tauri::command]` must sit directly under a `///` comment. It pins "presence" only; content quality belongs to review. Both lib.rs commands gained contract-semantic comments.
- Local hooks stay deliberately narrow (the blueprint's philosophy): pre-commit checks only staged trailing whitespace, pre-push runs only doc-quick; `pnpm install:hooks` installs idempotently.
- Gate self-tests: vitest covers the pairing pure-logic layer, word counting, and closed-set ↔ README cross-checks; CI's static lane gains `pnpm test`.
- `CLAUDE.md` becomes a symlink to `AGENTS.md` (as in the blueprint), so agent sessions auto-load the standing rules.
- The verify-md-links comment now tells the truth: external links get no mechanical check; fold them in when a projection lands.

## Alternatives considered

- A fail-closed placeholder (any `archived/` content going red): cheapest to implement, but the mechanism would have no real data to verify against; since check code has to be written anyway, land the full freeze gate and verify it end-to-end with one real archived note (the maintainer chose the full implementation).
- Running doc-sync in the hooks: slow local feedback and duplicated CI; narrow hooks + exhaustive CI is the better division of labor.
- Probing external links inside verify-md-links: with no projection site, external links approach zero, and network probes flake red in CI; do it together with the projection.
- Folding the export-doc check into gen-commands-catalog: generator and contract gate are separate duties (the blueprint keeps verify-export-jsdoc apart from gen-*); merging them would let each obscure the other.

## Consequences

- Writing exported code now carries a comment duty (contract semantics, one line to start); the command catalog finally has content.
- CI gains a seconds-long vitest step; two-homed contracts like "change the script, change the README too" are now test-backed.
- On Windows clones the CLAUDE.md symlink may degrade to plain text (a harmless failure mode).
- Archiving is now a real workflow: the semantic call (whether to archive) is human, the mechanics are automated; touching a frozen record means unfreezing, with explicit PR justification.
- The site projection stays deferred: external-link checking and the release-manifest projection wait for it.
