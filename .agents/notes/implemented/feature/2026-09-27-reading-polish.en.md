# Agent Note: Reading polish and switch guards

Status: implemented

English | [中文](2026-09-27-reading-polish.md)

## Problem

After m1-01 and m1-03 the three viewers work individually, but the experience is not one system: markdown / excel silently discard dirty state when switching files; video failures show a black stage; loading, errors, titles, and saving follow local rules; asynchronous reads and saves also race across files or clear dirty state incorrectly. The prototype goal is comfortable reading in one window, so unification must happen in the host state machine and shared UI contract rather than per-viewer patches.

## Decision

- Switch guards belong to host `WorkspaceService`: `guardSwitch(isDirty, confirmDiscard)` lets each registrant claim unsaved work, while the viewer supplies the confirm-dialog closure. `openFile` and `setRoot` are `async → boolean`; any rejection keeps the previous state. Reopening the active dirty path is an unprompted no-op — no repeated dialog and no reload that discards edits.
- Context exposes only `WorkspaceFacade` (reads, events, guarded opens, guard registration). Bootstrap binds the full internal controller to `WindowsService`; `changeRoot(root)` runs guard confirmation → Rust authorization/registration → frontend root switch. The external-plugin guard additionally narrows workspace/windows members, leaving private root and binding seams unreachable. The external windows allowlist omits `changeRoot` / `create`: root changes and window creation widen the Rust authorization boundary, so they are initiated only by users through the built-in directory picker UI.
- Markdown and excel register switch guards only when the active path is theirs and the document is dirty; close and switch guards share confirmation semantics.
- Markdown uses a monotonic open sequence to reject late reads; excel keeps its existing sequence. Both capture an edit revision / text snapshot while saving and clear dirty state only when no newer edit occurred. Otherwise dirty state remains and a retry can save the newer work.
- Add `src/ui/viewer.ts` as the shared accessible viewer kit: error banner, loading state, window-title rule, and Mod-S binding. app-shell owns the title baseline while a document plugin overrides only while it owns the active path; CodeMirror `.cm-content` events remain owned by its keymap. Video gains Space and left/right ±5 seconds, ignores already-consumed keys and input controls, and drops late errors by render generation.
- Video shows the shared loading state until `canplay` and the shared error banner on `error`; markdown loading is added, and excel error/loading states are mutually exclusive. Toolbar height, padding, and dark-stage whitespace are aligned without introducing a UI framework.

## Alternatives considered

- Let every viewer intercept in its own file-opened handler: workspace state has already changed, so plugins can only patch afterward and cannot reliably restore activeFile or tree highlighting. Rejected.
- Centralize dirty state in the host: that requires another cross-plugin document-state service and lifts markdown / excel dirty details (text diff versus workbook state) into the wrong boundary. Rejected.
- Replace confirmation with autosave: fewer dialogs, but switching would turn half-finished work into a save, and write failures still need a decision; unsuitable for study notes. Rejected.
- Keep exposing the full WorkspaceService through Context: built-ins could use it, but an external plugin declaring workspace could reach private root mutation and break the authorized single path. Rejected in favor of a facade plus the windows internal binding.
- Let the last-registered viewer own the title: it depends on static module order and regresses whenever a viewer is added. Rejected in favor of a shell baseline plus dirty-viewer override.

## Consequences

- `openFile` / `setRoot` are asynchronous boolean APIs; `WindowsService.changeRoot` becomes the bound `changeRoot(root)` form. Callers may ignore results, but timing tests must await them.
- Root switching, file switching, and window closing — all data-losing exits — are guarded; edits made during a save are never marked clean. The plugin owning dirty state generates confirmation text, so workspace does not depend on the window service.
- External plugins cannot programmatically change roots or create windows for now; a real future use case should first design a host-mediated user-confirmation API instead of exposing the underlying authorization commands.
- `src/ui/viewer.ts` is the home for shared viewer visual/key primitives; new viewers should reuse error, loading, title, and save handling instead of copying local implementations.
- Video errors report load failure without exposing webview/codec internals; environment independence gains no runtime dependency.
- Close guarding cannot use the native confirm under real Tauri (macOS 2.11.x): the dialog is not presented while a CloseRequested handler is pending. The guard preventDefaults synchronously, confirms through an in-app dialog, and closes via the destroy seam after confirmation; switch/root native confirms are unaffected.
- m1-02 acceptance is enforced by workspace / windows / guard composition tests, three viewer DOM race tests, build, and the layering/environment gates.
