# Agent Note: Budget reverse reconciliation and secondary command-list pins

Status: implemented

English | [中文](2026-09-09-budgets-reverse-wiring.md)

## Problem

Reviewing gate gaps against the blueprint (same review line as [2026-09-09-md-wrap-gate.en.md](2026-09-09-md-wrap-gate.en.md)) surfaced two meta-coverage holes: ① verify-doc-budgets iterates only manifest entries — a resident doc that is never registered escapes the budget entirely; PR #6's registration cleanup fixed the stock but not the flow (a new doc landing without registration silently bypasses the guardrail). ② ci-wiring pins only the root AGENTS.md command list against package.json; the three secondary command surfaces — docs/AGENTS.md, docs/development.md, root README.md — can carry a wrong pnpm command (typo, or a rename not propagated) with no gate going red.

## Decision

- verify-doc-budgets gains reverse reconciliation: discovery = existing docs/**\/*.md base side + root README.md + AGENTS.md (CLAUDE.md is its symlink, not listed separately) + .agents/notes/README.md; excluding .en.md (budgets count the base side) and postmortem incident files (frozen history; README.md is the resident rule doc). A discovered resident file missing from the manifest goes red, with the error saying registration is what opts a file in.
- Six fixture cases for the orchestration layer (createGateRunner; the manifest is read from cwd): unregistered → red (one docs-side case, one root-trio case), unregistered postmortem incident → green, .en.md unregistered → green, plus two forward cases (registered-but-missing, over-budget) pinning existing behavior.
- ci-wiring gains the secondary-list pin: extract `pnpm <token>` over the full text of all three docs (charset-bounded extraction naturally skips CJK punctuation and backticks) and check each against package.json scripts; install stays exempt as a builtin; each page must yield at least one command (anti-blindness on the extractor). Watched RED by temporarily corrupting the corpus (`lint:docs` → `lint:docz`), then reverted.
- docs/AGENTS.md's budget rule sentence gains 「常驻即须登记（未登记红门禁）」 — contract and gate landing together (that file is single-language-exempt, no pairing needed).

## Alternatives considered

- A separate leaf for reverse reconciliation instead of folding it into verify-doc-budgets: rejected — both directions share one source (one manifest, one residency definition); splitting would force shared discovery logic, while folding into the existing leaf is minimal.
- Force incident files to register too: rejected — incidents are append-only frozen history; registering them would mean rolling registration on every incident, and the dispose order (move layer → compress) doesn't apply to history that must not be rewritten.
- Make the secondary pin bidirectional (every script must appear in secondary pages): rejected — completeness has exactly one home, the root AGENTS.md list (already pinned by ci-wiring); secondary pages cite on demand, and forcing completeness would grow them into command mirrors.

## Consequences

- Green on landing: the manifest and the doc tree are exact mirrors right now (PR #6's stock cleanup still holds); from now on a resident doc landing without registration goes red in doc-quick.
- The residency definition deliberately matches the pairing corpus definition (docs + .agents/notes + root README) with different exemption sets (postmortem incidents ungoverned by both, archived governed only by pairing) — two discovery logics coexist, and a directory-structure change must touch both.
- `pnpm <token>` extraction covers full text (tables' inline code and prose alike), so new commands written on secondary pages join the net automatically; writing a non-script command (e.g. a future `pnpm dlx`) needs a new exemption.
- docs/README.md's map table is index-only and the manifest is the word budget's single home — the dual-home debt is cured by dropping the column (see [2026-09-09-budget-map-single-home.en.md](2026-09-09-budget-map-single-home.en.md)).
