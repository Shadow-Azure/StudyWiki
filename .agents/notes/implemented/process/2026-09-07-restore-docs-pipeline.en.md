# Agent Note: Restoring the blueprint's docs pipeline (bilingual/type-equiv/generated catalog)

Status: implemented

English | [中文](2026-09-07-restore-docs-pipeline.md)

## Problem

At initialization, three mechanisms of the blueprint's docs pipeline were trimmed under a monolingual-small-repo assumption (see the history in [2026-09-06-docs-as-code-gates.en.md](2026-09-06-docs-as-code-gates.en.md)). The project is about to enter sustained development; both code and docs will grow, the trimming assumption expires, and the restoration condition (introducing bilingual docs) is effectively triggered.

## Decision

Port the three mechanisms per the blueprint (scripts zero-dependency; type-equiv/doc-typecheck borrow the existing typescript devDep): `verify-translation-pairing` (blob hash + structure signature + switcher line + link locale + generated regions; the contract's home is [docs/i18n/README.en.md](../../../../docs/i18n/README.en.md)), `verify-type-equiv` (fences equivalent to source in structure + JSDoc, manifest 1:1), `gen-commands-catalog` (lib.rs command surface → generated regions on both sides; verify is `--check`), and `doc-typecheck` (plain ts fences really compiled). Direction decision: **Chinese as base (`foo.md`) + English side (`foo.en.md`)**, reversed from the blueprint (en base + `.zh.md`) — this repo's commits and existing docs are all Chinese, writing the source in the native language has the least friction, and the pairing mechanism is symmetric so the porting cost is unchanged. AGENTS.md (root + docs subtree) stays monolingual, explicitly exempted (same as the blueprint); Agent Notes are bilingual (same as the blueprint). The VitePress projection site is still deferred.

## Alternatives considered

- **Copy the blueprint's direction (en base + .zh.md)**: highest script isomorphism, but this repo treats Chinese as the first-class language and English as the translated side; with the direction reversed, the mechanism is fully symmetric anyway.
- **Restore only type-equiv/generated catalog, stay monolingual**: saves half the translation duty, but the notarization that "both sides say the same thing" is missing — the blueprint treats translation consistency as an invariant on par with code consistency.
- **Wait until the code grows before restoring**: the doc debt balloons first, and the restoration has to happen sooner or later; the later, the higher the migration cost.

## Consequences

- Every PR's doc duty doubles: touch either side → minimally patch the other → re-record with `pnpm record:i18n`; fences and generated regions are copied verbatim, never translated.
- Translation quality belongs to review: the gate only notarizes structural consistency and no drift; it does not judge semantic fidelity (the contract page declares this boundary).
- The structure-signature parser is a hand-rolled minimal line scanner (the price of the zero-dependency constraint); when the corpus adopts new Markdown syntax, extend the parser before writing the docs.
- Projection-site restoration condition: when an outward-facing doc site is needed, record it in a new Note, then build the `website/` projection layer (the repo keeps no second copy of the content).
