# Agent Note: Budget numbers gain a single home (map-table word column dropped)

Status: implemented

English | [中文](2026-09-09-budget-map-single-home.md)

## Problem

A debt registered in [md-wrap-gate](2026-09-09-md-wrap-gate.en.md)'s Alternatives/Consequences: the "Budget (words)" column of the docs/README.md map table formed a second home alongside scripts/doc-budgets.manifest.json — the gate reads only the manifest, so table numbers relied on eyesight, and the 2026-09-08 budget raises drifted 5 cells before anyone noticed. The blueprint's same-shaped restatement (the prose Targets sentence in its docs/AGENTS.md) still lists the deleted examples/AGENTS.md at 310, likewise with no gate going red. docs/README.md's own prose had long declared "this table is just the index" while the table kept a numbers column — the document contradicted itself.

## Decision

- Drop the map table's "Budget (words)" column on both sides, minimally patch the English side, re-record. The manifest is the single home for word budgets; the existing prose pointer ("budgets are enforced by the manifest … this table is just the index") now tells the truth and stays.
- Rewrite two now-stale living-document facts in place: the "dual-home debt remains / still awaits its fix" Consequences lines in [md-wrap-gate](2026-09-09-md-wrap-gate.en.md) and [budgets-reverse-wiring](2026-09-09-budgets-reverse-wiring.en.md) now state the present fact and link to this note.

## Alternatives considered

- A sync gate (parse the table column, cross-check against the manifest, go red on mismatch): roughly 30 lines and workable, but it is a permanent machine protecting redundancy that should not exist — it walks against "one home per fact" (the docs/AGENTS.md tier table). The budget reverse reconciliation (budgets-reverse-wiring) chose to force registration into the single home, not to keep two lists in sync.
- Generate the budget column as a generated region like gen:commands: a mixed table of hand-written role cells plus generated number cells makes marker regions awkward; a gen/verify pair for a handful of digits is out of proportion.
- Keep the column and rely on eyesight: this repo drifted once and the blueprint is drifting right now — verified to drift.

## Consequences

- Future budget moves touch only the manifest; docs/README.md's word count drops with its 570 budget unchanged (nowhere near the ceiling).
- Readers lose the at-a-glance view of each document's size; for numbers, read the manifest (this repo's verify-doc-budgets has no `--list`; the blueprint does — trivial to add later if wanted).
