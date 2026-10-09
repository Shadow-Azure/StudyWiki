# Main window activity rail and collapsible sidebars

English | [中文](m2-shell-rails-v2.md)

```yaml flow
kind: issue
milestone: m2
priority: P1
status: ready
scope:
  - src/plugins/app-shell/**
  - src/plugins/app-windows/**
  - src/plugins/plugin-manager/**
  - src/plugins/llm-settings/**
  - src/host/slots.ts
  - src/styles.css
  - tests/app-shell*.ts
  - tests/ui-preview*.ts
  - src-tauri/tauri.conf.json
  - src-tauri/src/windows.rs
  - scripts/code-map.manifest.json
  - src/ui/icons.ts
  - plans/2026-10-08-shell-rails-v2-plan.md
  - .agents/notes/proposed/architecture/2026-10-08-shell-rails-v2.*
  - .agents/notes/implemented/architecture/2026-10-08-shell-rails-v2.*
  - docs/architecture.*
  - docs/plugins/contract.*
  - scripts/gen-plugin-template.mjs
  - scripts/gen-plugin-template.spec.mjs
  - plugins-dev/hello/**
  - docs/plugins/authoring.*
  - docs/plugins/dynamic.*
  - src/preview.ts
adr:
  - ../../notes/implemented/architecture/2026-10-08-shell-rails-v2.md
github:
  number: 53
  url: https://github.com/Shadow-Azure/StudyWiki/issues/53
```

## Background

The current shell has only one low-discoverability file-sidebar handle and no equivalent handle for the Agent sidebar; global actions, brand and file title crowd the topbar. The user approved the prototype at `plans/preview-html/workspace-rails-preview.html`: a fixed white Activity Rail, independent Files/Agent collapse, toggles in the window-control layer, and no red badge when Agent is hidden.

## Goals

- Establish a fixed 54px Activity Rail and migrate global command plugins to `activity.left`; keep `topbar.left` as an API-v1 compatibility alias.
- Give Files and Agent one drag interaction with a 12px hit strip, visible feedback, Pointer Capture/rAF, keyboard support and double-click reset, plus independent hiding.
- Use an overlay titlebar for the macOS main and dynamic windows; remove the in-app SW brand and place panel toggles beside native window controls.
- Persist both widths and visibility; corrupt state falls back to defaults and multi-window changes follow the last write.
- Preserve the Reader minimum width, keep Agent mounted while hidden, and maintain external plugin v1 contract compatibility.

## Acceptance

- Vitest covers slot normalization, the four-column shell, clamping for both handles, toggles/shortcuts, persistence fallback and Activity Rail retention.
- `pnpm test`, `cargo test`, `pnpm build`, `pnpm lint:docs` and `pnpm verify:layering` pass.
- A macOS packaged smoke run confirms overlay traffic lights do not cover toggles, Activity Rail remains when Files hides, Agent hides without a red dot, and both widths restore after restart.
- The external `hello` sample can still register the legacy slot and appear in the Activity Rail.
