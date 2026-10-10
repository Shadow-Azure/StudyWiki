# Agent panel UI v2: turn folding and composer approval takeover

English | [中文](m2-agent-ui-v2.md)

```yaml flow
kind: issue
milestone: m2
priority: P1
status: ready
scope:
  - .agents/flow/issues/m2-agent-ui-v2.*
  - .agents/notes/implemented/feature/2026-10-07-agent-ui-v2.*
  - docs/architecture.*
  - scripts/code-map.manifest.json
  - src/plugins/app-agent/**
  - src/styles.css
  - tests/app-agent*.ts
  - plans/2026-10-07-agent-ui-*.md
  - plans/agent-ui-preview-v2.html
adr:
  - ../../notes/implemented/feature/2026-10-07-agent-ui-v2.md
github:
  number: 52
  url: https://github.com/Shadow-Azure/StudyWiki/issues/52
```

## Background

The agent panel currently floods the transcript with per-tool cards, stacks session/mode/model controls in the header, and injects bulky approval cards into the chat. A live MiniMax run confirmed the noise buries conclusions. Final design: plans/2026-10-07-agent-ui-dsh.md (dsh turn folding + codex/claude composer takeover).

<to fill: why>

## Goals

- Fold tool calls per turn: show the live action while running, collapse to one summary line on turn end, expandable timeline.
- Approval takes over the composer: summary + detail popover + approve/deny with shortcuts; restore draft after deciding; queue multiple requests.
- Single-row header: title + new/history/more; searchable history popover; model picker moves into the composer grouped by provider.
- Closable error toast, attachment hint, composer status line.

## Acceptance

- tests/app-agent-render.test.ts and tests/app-agent.test.ts cover folding, decision lines, approval takeover/popover/queue/draft restore, history search, model grouping, toast.
- pnpm test, verify:layering, route:gates all green.
- Visual matches plans/agent-ui-preview-v2.html (existing tokens only).

- <to fill>
