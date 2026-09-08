# Agent Note: Agent Note body-skeleton gate and root README budget

Status: implemented

English | [中文](2026-09-08-note-structure-gate.md)

## Problem

A fresh comparison against the blueprint's ten-step pipeline (same review that produced [2026-09-08-close-pipeline-gaps.en.md](2026-09-08-close-pipeline-gaps.en.md)) found two leftovers: the README "File format" contract fixes the four-section body skeleton with "section names are fixed", yet verify-agent-notes only checked paths, the first three lines, Status, and links — the skeleton was a soft requirement with no red script (the body half of the blueprint's verify-agent-note-format was never ported); and the root README.md, a standing front page inside the bilingual corpus, was missing from the doc-budgets manifest. The living corpus already contained the proof: dynamic-asset-scope (proposed) headed a section `## Decision (proposal)`, which violates "section names are fixed" — and no gate could go red.

## Decision

- verify-agent-notes gains a body-skeleton check (folded into the existing leaf, no new leaf): after stripping fences, the first H2 must be literally `## Problem`, and Problem → Decision → Alternatives considered → Consequences must appear in order as a subsequence; free sections may sit only between skeleton sections (the literal reading of "free technical sections may be inserted between them" — nothing after the final section). Both base and .en.md sides are pinned individually: the pairing gate's structure signature compares heading levels, not names, so name drift had no red path (same pattern as the postmortem gate). The SKELETON constant cross-checks the README "File format" line, spec-backed.
- The corpus violation is fixed in place: `## Decision（提案）` and `## Decision (proposal)` become the literal `## Decision` — the proposed state is already carried by the Status line and the folder; the section name no longer restates it.
- doc-budgets.manifest.json gains `README.md: 350` (currently 298 words, small headroom).

## Alternatives considered

- Per-lifecycle skeletons (the blueprint requires Proposal/Acceptance criteria/Risks for proposed): closer to the blueprint, but this repo's README defines one universal skeleton; splitting would mean rewriting the contract and every existing note in the same PR — not worth it; keep the universal skeleton.
- Porting the blueprint's banned headings (proposal-era headings banned in implemented/) and the grandfather escape hatch: here the format goes green corpus-wide on day one, so there is no pre-format corpus to grandfather; the banned-heading list is another layer of discretion, skipped for now.
- A separate new gate leaf (the blueprint splits classification/format): this repo already merged classification and the first-three-lines format into verify-agent-notes; folding the body skeleton in avoids cascading edits to run-gates' three modes and ci-wiring.

## Consequences

- The mechanical boundary for writing notes is harder: section names cannot vary (suffixes, parentheticals, translations all red), all three lifecycles share one skeleton, and free sections may only sit in between; loosening that means changing README and spec together.
- The .en.md side gains an obligation: skeleton section names identical to base (they are English proper nouns already, zero translation cost).
- The root README is now budget-bound: think about which tier content belongs in before expanding it.
