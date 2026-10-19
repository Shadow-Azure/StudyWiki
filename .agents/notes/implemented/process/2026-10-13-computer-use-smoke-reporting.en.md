# Agent Note: Computer Use smoke reporting skill

Status: implemented

English | [中文](2026-10-13-computer-use-smoke-reporting.md)

## Problem

Computer Use smoke runs produce screenshots, accessibility evidence, defect conclusions, and automation-coverage judgments. Hand-writing HTML each time makes evidence paths, escaping, status semantics, and regression claims drift, and the report becomes hard to reuse.

## Decision

Add the `computer-use-smoke-reporting` skill: collect stable screenshots and redacted JSON first, then use a local renderer to create standalone HTML. The template handles presentation only; the renderer escapes user text, validates screenshot evidence, checks for unreplaced markers, and requires report data and evidence to exist before HTML generation.

## Alternatives considered

- Continue hand-writing HTML: the generated artifact would become the source of truth and be hard to rerun or audit. Rejected.
- Put StudyWiki scenarios into the generic skill: that breaks reusability; app details belong in the run-specific JSON. Rejected.
- Save only screenshots: without a status matrix, root cause, fix state, and coverage conclusion, the evidence cannot support review decisions. Rejected.

## Consequences

- Smoke reports must maintain JSON and stable evidence before rendering HTML.
- Reports must not be hand-edited; fix the JSON first, then rerender.
- All evidence must be redacted; API keys, tokens, and private absolute paths must not enter reports.
