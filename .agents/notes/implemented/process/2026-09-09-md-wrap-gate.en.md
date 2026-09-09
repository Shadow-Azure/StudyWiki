# Agent Note: Hard-wrap gate and budget-registration backfill

Status: implemented

English | [中文](2026-09-09-md-wrap-gate.md)

## Problem

A gate-gap review against the blueprint's verify-md-wrap (same line of review as [2026-09-08-note-structure-gate.en.md](2026-09-08-note-structure-gate.en.md)) found three leftovers: the docs/AGENTS.md writing rule "one paragraph, one line" was a soft requirement with no red script, so hard-wrapped paragraphs could drift in unchecked — and they are exactly what pollutes translation-pairing's minimal-patch diffs and structural signatures; .agents/notes/README.md is a standing rules document yet absent from the doc-budgets manifest (the gate only checks listed entries, so unlisted means unchecked); and the word-count column of the docs/README.md map table had five cells out of sync with the manifest (the 2026-09-08 budget raises were not propagated), so the current-state documentation was lying.

## Decision

- Added the verify-md-wrap leaf to doc-quick/doc-sync/release (the blueprint files it as quick): a hand-rolled line scanner with no mdast dependency; fence and generated-region markers reuse translation-pairing-lib's single definitions, newly exported as REGION_BEGIN/REGION_END/FENCE_OPEN_RE. A prose paragraph spanning physical lines goes red — reported once, at its start line — and so do wrapped list items and paragraphs inside blockquotes. Scope: root README both sides + AGENTS.md + docs/** + .agents/notes/** (both locales); archived/ frozen snapshots are exempt (sha256-sealed; unseal to change); CLAUDE.md is a symlink of AGENTS.md, not listed separately. Five spec cases back it (92 total).
- docs/AGENTS.md now cites the gate at the end of that rule, and the gate sh comment enumeration gains "段落换行" (paragraph wrapping).
- Three budget moves: register .agents/notes/README.md at 980 (currently 968 words); docs/AGENTS.md 670→690 (standing content added by wiring the rule); docs/README.md map table's five word-count cells aligned to the manifest with the pair re-recorded.

## Alternatives considered

- Pull in mdast and match the blueprint's AST approach: rejected — this repo's gates are all hand-rolled zero-dependency structural scanners, and the line scanner already covers the blueprint's core semantics (wrapped paragraphs, wrapped list items, paragraphs inside blockquotes); the corpus structure is simple enough.
- Exempt 4-space-indented code blocks as code: rejected — this repo's code examples always live in fences (writing rule), so an indented code block is itself style drift worth seeing; the boundary is declared in the script's header comment.
- Drop the word-count column from the docs/README.md map table (the manifest is the budget's only home; two homes will drift again): right direction, but beyond this change's footprint — numbers aligned for now, debt noted in Consequences.

## Consequences

- The existing corpus has zero hard wraps, so the gate lands green with no migration cost; only the docs/README.md pair needed re-recording.
- ci-wiring's deletion-proof list gains verify-md-wrap; removing the leaf goes red.
- If YAML frontmatter or indented-code style ever lands, the scanner semantics must be revised alongside (current boundaries are in the script header).
- The map-table/manifest dual-home debt remains: a future budget raise that misses the table is invisible to gates; the real fix is dropping the column, which deserves its own note.
