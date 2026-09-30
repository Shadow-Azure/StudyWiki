# Agent Note: Native close and quit guards

Status: implemented

English | [中文](2026-09-29-native-close-guard.md)

## Problem

On macOS 26 with Tauri 2.12 / tao 0.37.1, measured behavior shows the red button, Close Window, Cmd+W, and Cmd+Q bypass the frontend asynchronous `CloseRequested` cancellation chain and silently discard dirty documents. File and root switching guards work, isolating the risk to native lifecycle. The measured traffic-light target/action is the window itself with private `_close:`, and it produces neither tao `CloseRequested` nor `Destroyed`. Cmd+Q is worse still: the menu item's selector is `terminate:`, and tao's macOS app delegate declares no `applicationShouldTerminate:`, so AppKit terminates the process outright and `RunEvent::ExitRequested` never fires. VS Code / Electron uses the reliable pattern of synchronous main-process `preventDefault()` followed by an explicit close after the dirty check.

## Decision

- `WindowsService` aggregates all document plugin guards in one window into one `onCloseRequested` listener: it synchronously calls `preventDefault()`, asks dirty guards in order, stays open on any cancellation, and calls `destroy()` only after every guard allows the close.
- The macOS `native_close` module hooks `performClose:` / `close:` / `_close:` and, while ready, retargets the standard red button to `StudyWikiCloseTarget`; that target only evals `window.__studywikiNativeClose?.()` in the matching webview and never closes directly.
- The same module hooks `NSApplication.terminate:`: while any armed window exists it evals the same bridge per window and skips the original implementation, otherwise it forwards. Cmd+Q and the Quit menu item therefore run the per-window guards, and the empty-window exit request after the final window is destroyed ends the process normally.
- Rust maintains `CloseGuardRegistry`. `guardClose` marks readiness as soon as it installs the aggregate listener (independent of boot timing, so guards added mid-session arm too); unsubscription or a confirmed close restores/removes native interception first. Startup, guard-free, and confirmed windows retain native direct close so they cannot become stuck. Re-arming is idempotent: an already-armed window is never re-read, otherwise its own action would be captured as the "original" and native close would break permanently.
- System `ExitRequested` does not exit directly: prevent it, eval the same bridge in every webview on macOS (per-window `close()` elsewhere), and let each guard decide. The empty-window exit request after the final window is genuinely destroyed is allowed.
- This approach replaces neither tao nor the webview and does not mirror dirty state into Rust; the main process owns only the synchronous fact that a guard is ready while document dirtiness remains in frontend plugins. `_close:` is a measured macOS 26 private-selector fallback; when that selector is absent, that hook is skipped with a warning while the public-selector hooks and red-button retarget remain active, so private-API drift cannot panic app startup.

## Alternatives considered

- Keep trusting frontend `CloseRequestedEvent.preventDefault()`: all four native macOS 26 exits fail in measurement, and the confirmation chain depends on webview scheduling.
- Mirror dirty flags in Rust and query the frontend from the close event: the first edit can be lost before its IPC write lands, and document semantics leak into the shell.
- Disable the native close button or draw a custom red dot: this gives up platform window semantics and still cannot cover the system menu and Cmd+Q.
- Swizzle only public `performClose:` / `close:`: the measured red-button action is `_close:`, and AX press bypasses those methods, so coverage is incomplete.

## Consequences

- Clean windows also close explicitly through the frontend aggregate callback's `destroy()`; `core:window:allow-destroy` remains mandatory.
- Closing multiple dirty documents confirms them in registration order; after one cancellation, the next close asks every still-dirty guard again.
- macOS 26 needs real mouse / keyboard manual regression across the four native exits (red button / Close Window / Cmd+W / Cmd+Q) plus direct clean-window close; AX automation bypasses the red-button target/action and cannot replace real input. Automation covers aggregation, confirm/cancel, readiness arm/unsubscribe, and full unsubscription.
