# Agent Note: Excel viewer and editable data model

Status: implemented

English | [中文](2026-09-20-excel-viewer.md)

## Problem

M1 requires markdown / excel / video to be readable; excel is missing. The need goes beyond viewing: humans will edit cells and styles from the page, and AI agents (m2) must read and write the same files. The design must be bundlable at build time (environment independence), preserve fidelity across read-modify-write, and expose one host contract shared by humans and AI.

## Decision

- Architecture: frontend ExcelJS data model + Rust byte boundary. The ExcelJS workbook is the single xlsx data model (parsing, editing, serialization all frontend); Rust never understands xlsx — it only moves bytes, validates path roots, and writes atomically.
- Add a sixth host service `ctx.excel` (independent from `ctx.files`): `read(path) → Workbook`, `write(path, workbook) → void`. Spreadsheet semantics get their own service so guard whitelists, AI tool surfaces, and test boundaries stay clean; humans and AI share one contract with no special cases.
- Binary I/O in `ctx.files` uses Tauri 2 raw IPC: the body is a `Uint8Array`, and the path travels UTF-8 percent-encoded in an `x-studywiki-path` header. `ctx.excel` wraps ExcelJS on top. Layering keeps format semantics frontend and system access in the host.
- Format scope is `.xlsx` only; csv and legacy .xls would be separate issues rather than special cases in the multi-sheet contract.
- Rust `EXCEL_EXTS = ["xlsx"]` dispatch; `FileNode.kind` gains `"excel"` (TS/Rust same shape, type-equiv fence updated).
- Viewer (this phase, m1-01): sheet switching, virtual scrolling, style rendering (font, bold/italic, fill, borders, alignment, a supported common number/date-format subset, merged cells, column widths), empty-sheet state. The `ctx.excel.write` service lands now (contract complete), but page editing UI does not.
- Editing (new issue): cell value editing, style toolbar (font/color/merge), dirty flag and close guard, save via `ctx.excel.write` → atomic Rust write → `fs://changed` broadcast.
- Fidelity boundary A+B: data-level plus style-level editing; writes preserve most styles/merges/formulas. Charts and pivot tables are not promised lossless — content wins for study material.
- Errors: corrupt file / non-zip → in-viewer error panel (no white screen); very large files hit a cell-count cap (about 1M) and are declined with a message; write failures during editing keep the dirty state and show an error so input is never lost.

## Alternatives considered

- Rust-side calamine parsing: best for read-only and environment independence, but calamine cannot write; switching to umya-spreadsheet for editing raises maintenance and performance doubts and splits format semantics across sides. Rejected — its advantage vanishes once editing matters.
- Frontend SheetJS (npm 0.18.5): data editing works, but the community edition drops styles/charts on write, the npm release has been frozen since 2022, and the official distribution moved to its own CDN (violates environment independence). Rejected.
- Hand-rolled minimal parser: reading is plausible (zip + XML), but doing both read and write is a trap. Rejected.
- Folding excel semantics into `ctx.files`: one fewer service, but guard whitelists and AI tool surfaces blur and test boundaries muddy. Rejected — keep `ctx.excel` separate.

## Consequences

- `exceljs` joins `dependencies` and `scripts/dep-allowlist.json`; bundled at build time, no CDN or runtime loading. `verify:env-independence` / `verify:dep-audit` must stay green.
- Bundle size grows; large workbooks live fully in frontend memory, protected by virtual scrolling and the cell cap.
- Host services grow from five to six (files / windows / workspace / slots / plugins / excel); architecture docs and code map update accordingly.
- m1-01 delivers the viewer plus the complete read/write service surface; editing gets its own issue (page editing and style toolbar). m1-02 reading polish depends on the viewer existing first.
- AI integration (m2) only needs `ctx.excel` on the guard whitelist; its read/write path is identical to the human one.
