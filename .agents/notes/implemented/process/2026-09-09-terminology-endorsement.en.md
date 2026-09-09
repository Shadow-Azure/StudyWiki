# Agent Note: Mechanical endorsement of the translation supply chain (terminology + prompt + gate)

Status: implemented

English | [中文](2026-09-09-terminology-endorsement.md)

## Problem

The last decision gap from the blueprint review: dsh's translation supply chain is mechanically endorsed (terminology table + translation prompt + checking script); this repo had none — structural consistency (mirroring/generated regions/hashes) was already notarized by verify-translation-pairing, but word choice rested entirely on translator discipline: one term translated two ways across documents (gate/`checkpoint` for 门禁) would never go red. The user decided on mechanical endorsement (over the registered-exemption alternative).

## Decision

- Subtractive port from the blueprint: dsh is a full LLM orchestration (prompt-v4 renderer + three-section response parser + bidirectional languages); here the translator is the agent and the direction is fixed (Chinese base → English side), so only the skeleton is kept — two resident artifacts + one gate leaf.
- `docs/i18n/terminology.md` trio: data rows (中文 | English | 禁用替写) are **language-neutral data, byte-identical across both sides**; only headers localize. Banned alternates are deliberate registrations, not exhaustive — `guard` stays legal because main guard (the CLI entry-guard pattern) owns that word. First batch: 13 terms, 3 banned alternates (`checkpoint`, `sentinel`, `switching line` — corpus-scanned for zero false positives before entering the table).
- `docs/i18n/translation-prompt.md` trio: the operational template for adding the English side; its fence is byte-identical on both sides, with three placeholders `{{terminology}}`/`{{source_document}}`/`{{source_basename}}`.
- New leaf `verify-terminology` (doc-quick/doc-sync/release): ① terminology data rows reconciled across sides; ② a registered banned alternate appearing in English-side living-corpus prose goes red — fences/inline code/generated regions don't count (examples or machine-written), the base side is not scanned, and **the terminology table itself is exempt** (its data rows must name the banned words); ③ the template fence's placeholder set is exact (each known one exactly once, unknown ones red). Eight spec cases (TDD, covering the table self-exemption and the three-region exemption boundaries).
- Wiring: i18n/README gains the 「术语与提示词」 contract section (budget 700→780); docs/README's map table registers both new docs (word-count column synced to the manifest, README 540→570); ci-wiring's anti-deletion list gains verify-terminology; the gate's header comments are themselves doc-refs scan targets.

## Alternatives considered

- Registered exemption (my recommendation before this note): overruled by the user — mechanical endorsement matches the blueprint, and the banned-alternate mechanism has controllable cost (only words with a real confusion history enter the table).
- Full port of dsh's renderer/parser (render request + parse the three-section response): rejected — this repo has no "call an external model to translate" runtime; translation happens inside agent sessions, so the render/parse layer has no consumer (YAGNI). The template survives as a document artifact; a render layer can come with external translators.
- Fold the terminology table into a section of i18n/README instead of a standalone doc: rejected — README is near its 780 ceiling, and the table must be referenced wholesale by the prompt (`{{terminology}}` = full text), so a standalone file is the clean supply unit.
- Case-sensitive whole-word matching for banned alternates: rejected — terminology on the English side is mostly lowercase, so case-insensitive is sturdier (`Checkpoint`/`checkpoint` equally guilty); the whole-word `\b` boundary prevents guardrail→guard false hits.

## Consequences

- The translation supply chain moves from translator discipline to mechanical endorsement: registering a banned alternate puts it under gate enforcement, new English-side corpus joins the net automatically; terminology data-row identity across sides is reconciled, so table drift goes red.
- Zero migration on landing: all 13 terms come from actual corpus usage (gate ×46, pairing ×21, corpus ×13, …), and the banned alternates have zero false positives — on landing the gate caught this very note's English prose twice, naming banned words bare while explaining the rule; fixed per the inline-code stance. The first real captures were its own author.
- Two new resident docs — map-table registration, budget registration, and the bilingual trio constraints are all satisfied on the spot (verified by the doc-index / budget reverse-reconciliation / pairing gates).
- Banned alternates scan only English-side prose: an English alternate appearing on the Chinese side (e.g. quoting a code name) is not a violation; if a generated region (commands catalog) ever carries one, that is a source-comment problem that surfaces first at the doc-refs/locale layer — a deliberate boundary.
- The terminology table is a rolling-registration artifact: new terms must land as data rows in the same PR (identical on both sides); forgetting only forfeits endorsement without going red — "should be in the table but isn't" still rests on review.
