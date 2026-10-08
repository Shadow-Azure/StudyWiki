# Agent Note: Main window Activity Rail and collapsible sidebars

Status: proposed

English | [中文](2026-10-08-shell-rails-v2.md)

## Problem

The main window currently has only one file-sidebar drag handle: its hit target is narrow and has no drag feedback, so users perceive it as non-draggable; the Agent sidebar has no equivalent handle. Global actions (new window, open folder, plugins, models) live in the app topbar alongside the brand, active filename and plugin button, which muddles ownership. The sidebars also have no unified hide entry points or persisted widths. The approved interactive prototype requires a white Activity Rail, independent Files/Agent collapse, panel toggles in the window-control layer, and no red-badge reminder when the Agent sidebar is hidden.

## Decision

Use a four-column shell: `Activity Rail(54px) | Files(collapsible) | Reader(flexible) | Agent(collapsible)`. The Activity Rail uses existing theme tokens for a white/paper appearance and fixed-width `activity.left` slot; `app-windows`, `plugin-manager` and `llm-settings` register there in the order open folder, new window, plugins, models. `topbar.left` remains an API-v1 compatibility alias normalized by `SlotsService` to `activity.left`, so external plugins do not need a contract upgrade.

The shell removes the in-app `SW + StudyWiki` brand; the title row keeps only the active-file title. On macOS, Tauri uses `TitleBarStyle::Overlay`, hides the native title, and positions traffic lights inside the title row; DOM panel toggles share that layer with native controls. Non-macOS platforms retain the system native titlebar and render the app title row as the first toolbar row; this is the accepted platform difference for this phase. The title row is a drag region; buttons and interactive controls are no-drag.

Both collapsible sidebars share one interaction language: a 12px hit strip, a 1px divider, a blue line and vertical pill on hover/drag, Pointer Capture, rAF batching, animation disabled while dragging, double-click reset, and a `role="separator"` keyboard surface. Geometry is Activity Rail 54px, Files 220–440px, Agent 300–520px, Reader at least 340px. Hidden rails have zero width but remain mounted; dragging to the minimum never hides a rail. Shortcuts are `Cmd/Ctrl+B` for Files and `Cmd/Ctrl+Option/Alt+B` for Agent; the Agent toggle shows no red badge.

Layout state persists in `localStorage` under `studywiki.shell-layout.v1` as `{ version: 1, files: { width, open }, agent: { width, open } }`. Reads and writes pass through clamping/default normalization; corrupt or newer data falls back to defaults without failing loud. Changes save immediately and multiple windows follow the last written value through the `storage` event. This is local UI preference only; it does not enter settings.json or user workspace documents.

Implementation is split between `src/plugins/app-shell/layout.ts` (constants, clamping, state normalization and serialization) and `src/plugins/app-shell/index.ts` (DOM, slots, gestures and events). Both `src-tauri/tauri.conf.json` and dynamic window creation in `src-tauri/src/windows.rs` apply the macOS overlay settings. Documentation updates the architecture map and external plugin slot contract together.

## Alternatives considered

- **Keep `topbar.left` and move its container to the leftmost column**: external plugins remain unchanged, but the slot name and visual location diverge indefinitely; normalization gives both v1 compatibility and a clear new name.
- **Keep a dsh-style 56px icon rail when the sidebar hides**: useful for quick recovery, but inconsistent with the approved “fully hide + corner toggle” prototype and consumes reading space; rejected.
- **Store layout in `~/.studywiki/settings.json`**: more formal across processes, but requires extending the strict versioned config and resolving multi-window write races; UI width is not inference configuration. Start with localStorage and upgrade later if export/sync is needed.
- **Use a frameless window and draw window controls on all platforms**: fully uniform, but requires reworking close guarding, maximize state and platform keyboard semantics—more risk than this phase needs. Use macOS overlay and keep native titlebars elsewhere.

## Consequences

- Benefit: both sidebars get a consistent, discoverable drag/hide experience; global commands get a stable Activity Rail; external v1 slot contracts remain compatible; Agent state survives hiding.
- Cost: the shell must understand the macOS overlay safe area, and dynamic windows must stay consistent with main-window config; localStorage is last-writer-wins and provides no settings sync or merge.
- Debt: non-macOS still has a native titlebar plus an app title row, not controls in the same OS layer; a frameless-window evaluation is required if three-platform parity becomes a goal. The Activity Rail carries command icons only and does not introduce multi-view switching yet.
