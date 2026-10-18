# Agent Note: Walkthrough change-page flowcharts (dagre hand-drawn SVG)

Status: implemented

English | [中文](2026-10-18-walkthrough-flowchart.md)

## Problem

The "architectural impact" and "design" sections of change pages were text-only: a solo maintainer reviewing a PR had to reconstruct chains and branches from prose, which hurts most on multi-feature PRs. We needed text-plus-diagram, with diagrams that — like every other walkthrough source — can be diffed, gated, inlined at build time, and carry zero runtime dependencies.

## Decision

Change-page yaml gains two structured fields, rendered to inline SVG at build time:

- `architecturalFlowchart`: required whenever `architectural` has substantive content (placeholders like `无`/`无。` exempt), rendered at the end of the architecture section.
- `designFlowcharts`: required whenever `design` is non-empty — one entry per `#### ` feature subsection of the landing mapping, with two-way reconciliation between `feature` and the subsection title (missing or extra entries both fail).

Every chart also requires `explanation`: state what mechanism or chain the chart expresses, then why that main path, branch, or back edge is the right representation. It is the reader's entry point below the chart, complements adjacent prose, and fails schema when missing.

The chart body is a closed-schema nodes/edges shape (shape limited to rect/rounded/stadium/diamond, direction to LR/TB, edge endpoints must resolve). The renderer lives in `scripts/walkthrough-flowchart.mjs`: **dagre only computes pure graph layout; rectangles, diamonds, arrows, and labels are hand-drawn SVG**. Text width uses a per-character model (CJK 1em, Latin 0.55em) with token-aware wrapping for long labels; styling follows site CSS tokens so light/dark themes follow automatically.

## Alternatives considered

- mermaid-cli (puppeteer/Chromium): the most mature mermaid DSL ecosystem, but install-time browser binary downloads make CI heavy and violate the "no binary downloads" preference. Rejected.
- mermaid + jsdom: lightweight but unsupported — mermaid's own test utilities state layout cannot work in jsdom (no rendering engine); community recipes survive by faking getBBox measurements, making every version upgrade a recurring risk. Rejected.
- beautiful-mermaid and similar zero-DOM renderers: claim pure TypeScript direct-to-SVG, but sources contradict each other and npm maintenance status could not be verified. Rejected.
- Force-directed/ELK layouts: dagre's layered layout fits flowcharts better, and mermaid flowcharts use dagre internally anyway, so the visual habit carries over.

## Consequences

Walkthrough sources grow from "text only" to "text + structured diagrams"; the walkthrough YAML-subset parser stays dependency-free (flowchart fields fit the existing list/nested-map shapes). Schema validation gains a hard text-diagram pairing gate (CI and build run the same check), and the `walkthrough-change-metadata-gen` skill owns diagram quality at generation time. The cost is a capability ceiling at flowcharts (DAG + branches + terminal/decision shapes); sequence or state diagrams would need new fields or a different renderer and a reopened evaluation.
