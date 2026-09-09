# Bilingual pairing

English | [中文](README.md)

Every in-scope document is maintained as a Chinese/English pair, and "both sides say the same thing" is notarized by machine: humans only make translation judgments; consistency belongs to the gates. This page is the sole home of the pairing contract.

## The triplet

- A pair is three sibling files: Chinese base `foo.md`, English side `foo.en.md`, and consistency record `foo.i18n.yaml`. Pairs merge whole — a PR always lands all three, never one side alone.
- Both languages carry equal authority: either side may be authored first, the other translated against it; neither side is a subordinate translation.
- The record stores each side's git blob hash (`git hash-object` semantics; uncommitted content also hashes, so it is locally checkable). After editing either side, **minimally patch** the other against the edited side's diff (never re-translate wholesale), then re-record with `pnpm record:i18n -- docs/foo.md`; the yaml diff is the reviewable act of confirming consistency.
- Recovery: in any historical version of the record yaml, both sides' blobs are reachable in the git object database, usable as the reference text before re-recording.

## Language switcher

Every corpus document carries a switcher: `[English](foo.en.md) | 中文` on the base side, `English | [中文](foo.md)` on the English side. Ordinary documents place it as the first non-blank line after the H1; Agent Notes place it after the `Status:` line (the first-three-lines format is another gate's fixed contract). Both sides must carry it; the gate checks.

## Structural mirroring

Both sides must mirror: heading depths and order, code fences (info string and content **byte-identical** — comments and diagram text inside fences are not translated), table row/column counts, list kinds/ordered starts/item counts, link targets (the switcher excepted). In-scope relative links: the base side uses `.md`, the English side uses `.en.md`; query strings and fragments onto non-Markdown targets are preserved verbatim; a fragment onto a Markdown target is the locale projection of its heading, exempt from mirroring and validated per side by the dead-anchor gate. Generated regions (`<!-- BEGIN GENERATED -->`) are byte-identical apart from locale-projected document paths.

## Gate and workflow

- `pnpm verify:docs` includes verify-translation-pairing: triplet completeness, hash match, switchers, link locale, generated regions, structure signature — any miss goes red.
- Daily loop: edit side A → minimally patch side B → re-record with `--write`, all in the same PR; a drifted pair cannot pass CI.
- The gate's limit: green only proves "the content last confirmed has not drifted", not that the translation is right — semantic fidelity and wording are review's responsibility.

## Scope and exclusions

The corpus = root `README.md`, `docs/**`, `.agents/notes/**` (except `archived/` — frozen records governed by the archival gate, whose sha256 freeze is stronger than pairing). The sole exclusion registry is [scripts/translation-pairing.manifest.json](../../scripts/translation-pairing.manifest.json) (a single excluded field): currently the two AGENTS.md files (the agent-instruction tier, monolingual like the blueprint). New exclusions must edit the manifest with justification in the PR.
