# Agent Note: Excel viewer and editable data model

Status: implemented

English | [中文](2026-09-20-excel-viewer.md)

## Problem

M1 requires markdown / excel / video to be readable; excel is missing. The need goes beyond viewing: humans will edit cells and styles from the page, and AI agents (m2) must read and write the same files. The design must be bundlable at build time (environment independence), preserve fidelity across read-modify-write, and expose one host contract shared by humans and AI.

## Decision

- Architecture: frontend ExcelJS data model + Rust byte boundary. The ExcelJS workbook is the single xlsx data model (parsing, editing, serialization all frontend); Rust never understands xlsx — it only moves bytes, validates path roots, and writes atomically.
- Add a sixth host service `ctx.excel` (independent from `ctx.files`): `read(path) → Workbook`, `write(path, workbook) → void`. Spreadsheet semantics get their own service so guard whitelists, AI tool surfaces, and test boundaries stay clean; humans and AI share one contract with no special cases.
- Binary I/O in `ctx.files` uses Tauri 2 raw IPC: the body is a `Uint8Array`, and the path travels UTF-8 percent-encoded in an `x-studywiki-path` header. `ctx.excel` wraps ExcelJS on top. Layering keeps format semantics frontend and system access in the host.
- Format scope is `.xlsx` only; csv, legacy .xls, and .xlsm are `other`, remain visible in the file tree, and their click goes to the shell main area for an unsupported hint. Future support gets a separate issue rather than special cases in the multi-sheet contract.
- Rust `EXCEL_EXTS = ["xlsx"]` dispatch; `FileNode.kind` gains `"excel"` (TS/Rust same shape, type-equiv fence updated).
- Viewer (this phase, m1-01): sheet switching, virtual scrolling, style rendering (font, bold/italic, fill, borders, alignment, a supported common number/date-format subset, merged cells, column widths), empty-sheet state. The `ctx.excel.write` service lands now (contract complete), but page editing UI does not.
- Editing (implemented by m1-03): inline cell-value editing, a style toolbar (bold/italic/font color/fill color/merge), click + Shift-click rectangular selection, a dirty flag and close guard, and save via `ctx.excel.write` → atomic Rust write → `fs://changed` broadcast.
- Editor input follows the spreadsheet convention but narrowed: decimal-shaped text (including scientific notation) becomes a number, blank input clears the cell, and everything else stays text; a leading ASCII `'` forces text so values such as `007`, student IDs, and ID-card numbers survive. `0x10` / `0b101` are not numeralized, matching Excel/WPS.
- Drag range selection is split to #42: with virtual scrolling, target rows are unmounted and require edge auto-scroll and index tracking. This issue ships click + Shift-click only; the contract remains incremental.
- Raw binary IPC gains in-process integration tests: both read and write commands traverse Tauri MockRuntime's real IPC resolver (`InvokeRequest` + raw body/path header). macOS requires WebviewWindow creation on the main thread, so that test crate uses `harness = false`.
- Fidelity boundary A+B: data-level plus style-level editing; writes preserve most styles/merges/formulas. Charts and pivot tables are not promised lossless — content wins for study material.
- Errors: parsing failures converge at the service layer to one stable “file is damaged or not a valid .xlsx; confirm the source or save as .xlsx” message, shown by the in-viewer error panel without dependency internals; very large files hit a cell-count cap (about 1M) and are declined with a message; write failures during editing keep the dirty state and show an error so input is never lost.

## Alternatives considered

- Rust-side calamine parsing: best for read-only and environment independence, but calamine cannot write; switching to umya-spreadsheet for editing raises maintenance and performance doubts and splits format semantics across sides. Rejected — its advantage vanishes once editing matters.
- Frontend SheetJS (npm 0.18.5): data editing works, but the community edition drops styles/charts on write, the npm release has been frozen since 2022, and the official distribution moved to its own CDN (violates environment independence). Rejected.
- Hand-rolled minimal parser: reading is plausible (zip + XML), but doing both read and write is a trap. Rejected.
- Folding excel semantics into `ctx.files`: one fewer service, but guard whitelists and AI tool surfaces blur and test boundaries muddy. Rejected — keep `ctx.excel` separate.

## Consequences

- The flow gate supports activating a backlog issue within the same PR: when PR HEAD advances it to ready/in-progress/done, the issue is treated as started; references to a base-done issue remain rejected.
- `exceljs` joins `dependencies` and `scripts/dep-allowlist.json`; bundled at build time, no CDN or runtime loading. `verify:env-independence` / `verify:dep-audit` must stay green.
- Bundle size grows; large workbooks live fully in frontend memory, protected by virtual scrolling and the cell cap. The cap is checked after ExcelJS parsing and accumulates declared dimensions (rowCount × columnCount) per sheet — it protects rendering and model residency, not the parse-time memory peak; a near-empty file with formatting traces in far cells counts too.
- Host services grow from five to six (files / windows / workspace / slots / plugins / excel); architecture docs and code map update accordingly.
- m1-01 delivers the viewer plus the complete read/write service surface; m1-03 delivers page editing and the style toolbar; drag range selection is tracked by #42. m1-02 reading polish depends on the viewer existing first.
- AI integration (m2) only needs `ctx.excel` on the guard whitelist; its read/write path is identical to the human one.
