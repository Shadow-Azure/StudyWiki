# Agent Note: md-links covers root files and dead anchors

Status: implemented

English | [中文](2026-09-09-md-links-scope-anchor.md)

## Problem

A blueprint review against dsh's verify-md-links exposed three gaps: ① the scan surface omitted the root files — dead links in README (both sides) and AGENTS.md (read every session; all of its links point into docs/) had no gate, and the surface disagreed with verify-md-wrap's; ② `#fragment` was never validated — both gates' regexes discarded fragments outright, so anchor links would rot silently on heading renames the moment anyone started using them; ③ the pairing contract demanded fragments mirror verbatim, which structurally conflicts with per-side localized headings — the dead-anchor gate caught a live case on day one: architecture.en.md copied the base side's `#已知欠账` verbatim while the English heading is `## Known debts`.

## Decision

- verify-md-links now scans root README.md / README.en.md / AGENTS.md (CLAUDE.md is a symlink to AGENTS.md and is not listed separately).
- A fragment onto a Markdown target must hit a GitHub-style heading slug (repeated headings get the `-1`/`-2` placeholder counters) or an explicit `<a id="…">`; a bare `#frag` is a same-file anchor; a query string is stripped before resolution; fragments onto non-Markdown targets (code line numbers and the like) are not anchor-checked. Headings and ids inside fences or HTML comments are examples, not anchors.
- Target parsing and anchor derivation moved into pure functions in translation-pairing-lib (parseLinkTarget / githubSlug / documentAnchors), reused by verify-agent-notes' cross-reference check — dead anchors inside notes go red too.
- Contract amendment (docs/i18n/README.md, structural mirroring): a fragment onto a Markdown target is the locale projection of its heading; it leaves the structural mirror and is validated per side by the dead-anchor gate; queries and fragments onto non-Markdown targets still mirror verbatim. normalizeLinkTarget implements this.
- Fixed the corpus rot: architecture.en.md `#已知欠账` → `#known-debts`; pair re-recorded.

## Alternatives considered

- Adopting mdast (the blueprint walks its visitor API): no parsing dependency is a standing tradeoff here; the handwritten line scanner covers the corpus's full grammar (verify-md-wrap set the precedent) and shares the fence/comment scanning definitions with the structural signature.
- Keeping fragments verbatim in the mirror and exempting the English side from anchor checks: that hides a structural conflict inside an exemption and leaves English anchors permanently dead; admitting fragments are locale content — machines validate each side is alive, reviewers judge equivalence — is more honest.
- Copying the blueprint's behavior: dsh's Chinese side also copies English fragments verbatim (e.g. `core.zh.md#the-agent-handle` pointing at the Chinese heading 「Agent 句柄」); same disease, not followed.
- Anchoring the dead-anchor check only in doc-sync, not in agent-notes: cross-reference links are the note body's own mechanism and should go red in the quick lane.

## Consequences

- Every anchor link now has gate backing; heading renames and anchor typos go red (previously silent).
- The pairing signature no longer compares Markdown fragments: each side being validly alive is green; semantic equivalence — pointing at the same section — belongs to translation review. An honest boundary instead of pretending the machine checks it.
- The i18n contract page grew by 19 words; budget 700 → 725: contract precision is structural growth, the page is load-bearing throughout, and compression was attempted first.
- External-link probing stays deferred until the site projection lands (see 2026-09-08-close-pipeline-gaps).
