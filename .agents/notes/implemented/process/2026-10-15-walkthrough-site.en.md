# Agent Note: Walkthrough engineering site

Status: implemented

English | [中文](2026-10-15-walkthrough-site.md)

## Problem

AI produces code far faster than the maintainer can read and review it, and the repo lacks a human-facing engineering comprehension surface: no aggregated walkthrough when a feature spans many files, no per-file annotation layer, and PRs show only diffs without layered functional/architectural/code narratives. The existing layers each cover one slice — docs record the present, Agent Notes record decisions, flow records process — but "how to read this codebase" has no home.

## Decision

Establish a top-level `walkthrough/` directory (Chinese-only, an explicitly registered tier): a five-tier site (overview/architecture/feature pages/file pages/change history) cross-linked on two axes; sources are YAML rendered by a hand-written yaml-subset parser into multi-page static HTML that opens via file://. Code blocks use content-snapshot anchors for locating only — displayed code is pulled from live sources at build time, so the displayed-code layer cannot go stale. Nine gates keep it fresh: schema closure, anchor locating, file-page⇆code-map reconciliation, feature registry reconciliation, changes⇆flow-issue reconciliation, line coverage (threshold and exemptions registered in walkthrough/manifest.json), build-as-proof, plus two diff-tier gates (code-touched-must-touch-page and exhaustive touches); a PR updates its walkthrough sources alongside the code — merge-in is same-PR commit, no post-merge merging. During the skeleton phase the manifest's bootstrap flag downgrades the file-page/change/coverage tiers to warnings and they turn red once backfill completes and the flag is removed. Full design: plans/2026-10-15-walkthrough-design.md; the four research borrowings: Swimm's drift-gate semantics, CodeTour's pattern addressing, DeepWiki's declarative page manifest, CodeRabbit's layered PR narrative with linked-issue assessment.

## Alternatives considered

- DeepWiki-style fully automatic generation: officially documented to miss directories and components; explanations untrusted with no human-confirmed state. No.
- Swimm (SaaS): proprietary format plus online dependency violates the offline hard constraint; we borrow only its gate semantics. No.
- CodeTour (VS Code extension): excellent anchor design but IDE-bound, with no site aggregation or PR narrative tier. No.
- Generate on demand without committing: irreproducible, no confirmed state — the AI-speed problem reappears at the explanation layer. No.
- Symbol-level anchors: require a TS+Rust dual parser; content-snapshot substring locating already handles drift. No.
- Single-file HTML: feature⇄file cross-linking is more natural across multiple pages, and it avoids single-file bloat. No.

## Consequences

Every code PR must maintain walkthrough sources in the same PR (enforced by gates); AI carries generation and drift repair while the human only skims the changes page and file-page diffs. Explanation semantic quality cannot be judged mechanically — a standing debt backed by "red anchor forces rewrite" plus human review. The 60% line-coverage threshold is an uncalibrated starting point to be revisited against real distributions after backfill. The bootstrap backfill is a one-time large skim cost, digested in feature-page batches.

Backfill facts: the coverage threshold is finalized at 90%; across 65 registered files, the minimum is 90% (`src/loader/boot.ts`) and the median is 106.47%, with no exemptions registered — the semantically complete windows for `context.d.ts`, `styles.css`, and `icons.ts` already meet the bar, so exemptions remain restrained. Snapshot granularity uses semantically complete segments: each block starts from a source-level visible boundary, locating strips trailing whitespace only, and adjacent/overlapping windows may cover imports, exports, branches, and error handling. Coverage divides the union of located line ranges by non-empty source lines; blank lines inside segments also count, so values over 100% mean those windows contain blank lines.
