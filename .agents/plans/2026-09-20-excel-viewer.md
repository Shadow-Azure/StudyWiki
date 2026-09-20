# Excel Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the m1-01 `.xlsx` viewer plus the complete human/AI-shared Excel read-write service surface, without page editing UI.

**Architecture:** ExcelJS owns the xlsx data model in the frontend; `ctx.excel` is the sixth host service and wraps `ctx.files` binary I/O; Rust remains a byte boundary with root validation and atomic writes. The viewer renders one worksheet at a time with sheet tabs, style/merge fidelity, and windowed rows.

**Tech Stack:** TypeScript, Vite, Vitest/jsdom, Tauri 2 Rust commands, ExcelJS.

**Spec:** `/Users/zn-ice/2026/StudyWiki/.agents/notes/proposed/feature/2026-09-20-excel-viewer.md`

## Global Constraints

- Format scope is `.xlsx` only; do not add csv or `.xls`.
- `exceljs` must be the only new npm dependency and must be listed in `scripts/dep-allowlist.json`.
- No CDN, runtime download, environment-variable branch, UI framework, or `node:` runtime dependency may be added.
- `src/plugins/**` must not import `@tauri-apps/*`; only `src/host/files.ts` wraps the new Rust commands.
- Every file command validates the path against an authorized workspace root before reading or writing.
- Excel writes use same-directory temporary file + rename and broadcast `fs://changed`.
- The workbook cell cap is exactly `1_000_000` cells; over-cap files are rejected with a user-readable error.
- All exported TS symbols and Tauri commands carry contract doc comments.
- Persistent docs affected by implementation are updated bilingually and re-recorded; generated sections are regenerated, never hand-edited.
- Every commit title contains `(#25)`.

---

### Task 1: Start flow state, dependency, `excel` kind, and Rust binary boundary

**Files:**

- Modify: `.agents/flow/issues/m1-01-excel-viewer.md`
- Modify: `.agents/flow/issues/m1-01-excel-viewer.en.md`
- Modify: `.agents/flow/issues/m1-01-excel-viewer.i18n.yaml`
- Modify: `.agents/flow/milestones/m1-prototype-shell.md`
- Modify: `.agents/flow/milestones/m1-prototype-shell.en.md`
- Modify: `.agents/flow/milestones/m1-prototype-shell.i18n.yaml`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `scripts/dep-allowlist.json`
- Modify: `src/types.ts`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/lib.rs` (`#[cfg(test)]` module)

**Interfaces:**

- Consumes: existing `FileNode`, `WindowRegistry`, `path_authorized`, and `generate_handler` registration pattern.
- Produces:
  - TS `FileNode.kind`: `"dir" | "markdown" | "video" | "excel" | "other"`.
  - Rust command `read_binary_file(state, path: String) -> Result<Vec<u8>, String>`.
  - Rust command `write_binary_file(app, state, path: String, bytes: Vec<u8>) -> Result<(), String>`.
  - npm dependency `exceljs`.

- [ ] **Step 1: Write the failing Rust tests**

Append these tests inside `mod tests` in `src-tauri/src/lib.rs`:

```rust
#[test]
fn classifies_excel_extensions() {
    assert_eq!(kind_for_ext("xlsx"), Some("excel"));
    assert_eq!(kind_for_ext("XLSX"), Some("excel"));
    assert_eq!(kind_for_ext("xls"), None);
    assert_eq!(kind_for_ext("csv"), None);
}

#[test]
fn atomic_write_replaces_existing_file_and_leaves_no_temp() {
    let mut path = std::env::temp_dir();
    path.push(format!("sw-atomic-{}-{}.xlsx", std::process::id(), line!()));
    std::fs::write(&path, b"old").unwrap();
    atomic_write(&path, b"new").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"new");
    let leftovers: Vec<_> = std::fs::read_dir(path.parent().unwrap())
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with(&format!(".{}", path.file_name().unwrap().to_string_lossy())))
        .collect();
    assert!(leftovers.is_empty(), "leftover temp files: {leftovers:?}");
    let _ = std::fs::remove_file(&path);
}
```

- [ ] **Step 2: Run the tests and verify the new tests fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml classifies_excel_extensions`
Expected: FAIL — `xlsx` does not map to `excel`.

Run: `cargo test --manifest-path src-tauri/Cargo.toml atomic_write_replaces_existing_file`
Expected: FAIL — `atomic_write` is not defined.

- [ ] **Step 3: Implement the Rust boundary**

Make these exact changes:

```rust
use std::ffi::OsStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const EXCEL_EXTS: &[&str] = &["xlsx"];
static ATOMIC_WRITE_SEQ: AtomicU64 = AtomicU64::new(0);

fn kind_for_ext(ext: &str) -> Option<&'static str> {
    let ext = ext.to_ascii_lowercase();
    if MARKDOWN_EXTS.contains(&ext.as_str()) {
        Some("markdown")
    } else if EXCEL_EXTS.contains(&ext.as_str()) {
        Some("excel")
    } else if VIDEO_EXTS.contains(&ext.as_str()) {
        Some("video")
    } else {
        None
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let name = path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| format!("路径没有文件名：{}", path.display()))?;
    let seq = ATOMIC_WRITE_SEQ.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = path.with_file_name(format!(
        ".{name}.studywiki-{}-{seq}-{nanos}.tmp",
        std::process::id()
    ));
    fs::write(&tmp, bytes).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    if let Err(e) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("rename {} -> {}: {e}", tmp.display(), path.display()));
    }
    Ok(())
}
```

Add these commands near the text-file commands:

```rust
/// 读取整文件字节（excel 等二进制文档的数据源）；错误携带 OS 失败原文。
/// 路径须在已授权文件夹内（欢迎态无授权即拒）。
#[tauri::command]
fn read_binary_file(
    state: tauri::State<'_, std::sync::Mutex<windows::WindowRegistry>>,
    path: String,
) -> Result<Vec<u8>, String> {
    ensure_authorized(&state, &path)?;
    fs::read(&path).map_err(|e| format!("read {path}: {e}"))
}

/// 原子写二进制文件（同目录 tmp + rename），成功后广播 `fs://changed`。
/// 路径须在已授权文件夹内（欢迎态无授权即拒）。
#[tauri::command]
fn write_binary_file(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Mutex<windows::WindowRegistry>>,
    path: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    ensure_authorized(&state, &path)?;
    atomic_write(Path::new(&path), &bytes)?;
    app.emit("fs://changed", &path)
        .map_err(|e| format!("emit: {e}"))
}
```

Register both commands in `tauri::generate_handler![...]` immediately after `write_text_file`.

Change the TS kind union and dispatch comment in `src/types.ts` to:

```ts
/** Dispatches handling: directories expand; markdown/video/excel open; other lists only. */
kind: "dir" | "markdown" | "video" | "excel" | "other";
```

- [ ] **Step 4: Add the dependency and whitelist it**

Run: `pnpm add exceljs`

Add `"exceljs"` to `deps` in `scripts/dep-allowlist.json` in the existing alphabetical/append style that keeps the list a precise set.

- [ ] **Step 5: Update flow state and run focused verification**

In both m1-01 issue language files, change `status: backlog` to `status: in-progress`. In both m1 milestone language files, change `status: planned` to `status: active`. Re-record both pairs:

```sh
pnpm record:i18n -- .agents/flow/issues/m1-01-excel-viewer .agents/flow/milestones/m1-prototype-shell
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
pnpm verify:flow
pnpm verify:dep-audit
pnpm verify:env-independence
```

Expected: all commands pass. If `pnpm add exceljs` needs network approval, request it; do not use a CDN or manual vendor copy.

- [ ] **Step 6: Commit**

```sh
git add package.json pnpm-lock.yaml scripts/dep-allowlist.json src/types.ts src-tauri/src/lib.rs .agents/flow/issues/m1-01-excel-viewer.* .agents/flow/milestones/m1-prototype-shell.*
git commit -m "打通 Excel 字节边界：xlsx 分派与原子二进制读写 (#25)"
```

---

### Task 2: Files service binary methods

**Files:**

- Modify: `src/host/files.ts`
- Test: `tests/host-services.test.ts`

**Interfaces:**

- Consumes: Rust commands `read_binary_file` / `write_binary_file` from Task 1.
- Produces:
  - `FilesService.readBinary(path: string): Promise<Uint8Array>`
  - `FilesService.writeBinary(path: string, bytes: Uint8Array): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `tests/host-services.test.ts`:

```ts
test("files: readBinary 把命令字节数组归一为 Uint8Array", async () => {
  const invoke = vi.fn().mockResolvedValue([1, 2, 3]);
  const files = new FilesService({ invoke, listen: vi.fn(), openDialog: vi.fn(), assetUrl: (p) => p });
  await expect(files.readBinary("/x/a.xlsx")).resolves.toEqual(new Uint8Array([1, 2, 3]));
  expect(invoke).toHaveBeenCalledWith("read_binary_file", { path: "/x/a.xlsx" });
});

test("files: writeBinary 发送普通数组并透传错误", async () => {
  const invoke = vi.fn().mockResolvedValue(null);
  const files = new FilesService({ invoke, listen: vi.fn(), openDialog: vi.fn(), assetUrl: (p) => p });
  await files.writeBinary("/x/a.xlsx", new Uint8Array([4, 5]));
  expect(invoke).toHaveBeenCalledWith("write_binary_file", {
    path: "/x/a.xlsx",
    bytes: [4, 5],
  });
  invoke.mockRejectedValueOnce(new Error("denied"));
  await expect(files.writeBinary("/x/a.xlsx", new Uint8Array())).rejects.toThrow("denied");
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `pnpm vitest run tests/host-services.test.ts`
Expected: FAIL — `files.readBinary is not a function`.

- [ ] **Step 3: Implement the service methods**

Add these methods to `FilesService` after `writeText`:

```ts
/** Whole-file binary read — the Excel service's byte source. */
async readBinary(path: string): Promise<Uint8Array> {
  const bytes = await this.#deps.invoke("read_binary_file", { path }) as number[];
  return Uint8Array.from(bytes);
}

/** Whole-file binary write; Rust writes atomically and broadcasts the change. */
writeBinary(path: string, bytes: Uint8Array): Promise<void> {
  return this.#deps.invoke("write_binary_file", {
    path,
    bytes: Array.from(bytes),
  }) as Promise<void>;
}
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm vitest run tests/host-services.test.ts && pnpm verify:layering`
Expected: both pass.

```sh
git add src/host/files.ts tests/host-services.test.ts
git commit -m "文件服务补二进制读写通道 (#25)"
```

---

### Task 3: Sixth host service `ctx.excel` and bootstrap wiring

**Files:**

- Create: `src/host/excel.ts`
- Modify: `src/host/context.d.ts`
- Modify: `src/bootstrap.ts`
- Test: Create `tests/excel-service.test.ts`
- Modify: `tests/bootstrap.test.ts`

**Interfaces:**

- Consumes: `FilesService.readBinary` / `writeBinary` from Task 2.
- Produces:
  - `ExcelService.read(path: string): Promise<Workbook>`
  - `ExcelService.write(path: string, workbook: Workbook): Promise<void>`
  - exported constant `MAX_EXCEL_CELLS = 1_000_000`
  - context service key `excel`

- [ ] **Step 1: Write the failing service tests**

Create `tests/excel-service.test.ts`:

```ts
import { Workbook } from "exceljs";
import { expect, test, vi } from "vitest";
import { ExcelService, MAX_EXCEL_CELLS } from "../src/host/excel";

async function fixtureBytes(): Promise<Uint8Array> {
  const wb = new Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getCell("A1").value = "Alpha";
  const raw = await wb.xlsx.writeBuffer();
  return new Uint8Array(raw as ArrayBuffer);
}

test("excel: read/write 经 files 字节通道并保留单元格", async () => {
  const bytes = await fixtureBytes();
  const files = {
    readBinary: vi.fn(async () => bytes),
    writeBinary: vi.fn(async (_path: string, written: Uint8Array) => {
      expect(written.byteLength).toBeGreaterThan(4);
    }),
  };
  const excel = new ExcelService(files);
  const wb = await excel.read("/lib/a.xlsx");
  expect(wb.getWorksheet("Sheet1")?.getCell("A1").text).toBe("Alpha");
  await excel.write("/lib/a.xlsx", wb);
  expect(files.readBinary).toHaveBeenCalledWith("/lib/a.xlsx");
  expect(files.writeBinary).toHaveBeenCalledWith("/lib/a.xlsx", expect.any(Uint8Array));
});

test("excel: 超过单元格上限拒绝读取", async () => {
  const files = { readBinary: vi.fn(), writeBinary: vi.fn() };
  const wb = new Workbook();
  const ws = wb.addWorksheet("huge");
  Object.defineProperty(ws, "rowCount", { value: 1001 });
  Object.defineProperty(ws, "columnCount", { value: 1001 });
  const excel = new ExcelService(files, { parseWorkbook: async () => wb });
  await expect(excel.read("/lib/huge.xlsx")).rejects.toThrow(/过大/);
  expect(MAX_EXCEL_CELLS).toBe(1_000_000);
});
```

- [ ] **Step 2: Write the failing bootstrap assertion**

In `tests/bootstrap.test.ts`, extend the first bootstrap test after `ctx.files`:

```ts
expect((ctx as any).excel).toBeDefined();
```

Extend the probe's `inject` to `["files", "windows", "workspace", "slots", "excel"]` and its `ran` string to include `!!(ctx as any).excel`.

Run: `pnpm vitest run tests/excel-service.test.ts tests/bootstrap.test.ts`
Expected: module-resolution failure for `../src/host/excel`, then bootstrap failure after the service file exists.

- [ ] **Step 3: Implement `src/host/excel.ts`**

```ts
import { Workbook } from "exceljs";

/** Files seams needed by the Excel service; tests inject memory fakes. */
export interface ExcelFiles {
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, bytes: Uint8Array): Promise<void>;
}

/** Injectable parser seam; production uses ExcelJS, tests inject a prepared workbook. */
export interface ExcelDeps {
  parseWorkbook?: (bytes: Uint8Array) => Promise<Workbook>;
}

/** Upper bound on rowCount × columnCount across all worksheets. */
export const MAX_EXCEL_CELLS = 1_000_000;

/** Parse raw xlsx bytes into an ExcelJS workbook. */
export async function parseWorkbook(bytes: Uint8Array): Promise<Workbook> {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const workbook = new Workbook();
  await workbook.xlsx.load(copy as Parameters<Workbook["xlsx"]["load"]>[0]);
  return workbook;
}

/** Spreadsheet host service: the human/AI-shared xlsx data-model boundary. */
export class ExcelService {
  readonly #files: ExcelFiles;
  readonly #parse: (bytes: Uint8Array) => Promise<Workbook>;

  constructor(files: ExcelFiles, deps: ExcelDeps = {}) {
    this.#files = files;
    this.#parse = deps.parseWorkbook ?? parseWorkbook;
  }

  /** Read and parse an xlsx workbook; rejects corrupt or over-cap files. */
  async read(path: string): Promise<Workbook> {
    let workbook: Workbook;
    try {
      workbook = await this.#parse(await this.#files.readBinary(path));
    } catch (error) {
      if (error instanceof Error && error.message.includes("过大")) throw error;
      throw new Error(`读取 Excel 失败：${(error as Error).message}`);
    }
    const cells = workbook.worksheets.reduce(
      (sum, ws) => sum + Math.max(1, ws.rowCount) * Math.max(1, ws.columnCount),
      0,
    );
    if (cells > MAX_EXCEL_CELLS)
      throw new Error(`Excel 过大：${cells} 个单元格超过上限 ${MAX_EXCEL_CELLS}`);
    return workbook;
  }

  /** Serialize a workbook and atomically write it through the files service. */
  async write(path: string, workbook: Workbook): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    } catch (error) {
      throw new Error(`序列化 Excel 失败：${(error as Error).message}`);
    }
    await this.#files.writeBinary(path, bytes);
  }
}
```

If ExcelJS's installed typings reject the `ArrayBuffer` cast, keep the runtime conversion and use the narrowest possible `as unknown as Parameters<Workbook["xlsx"]["load"]>[0]`; do not import Node's `Buffer`.

- [ ] **Step 4: Wire context and bootstrap**

In `src/host/context.d.ts`, import `ExcelService` and add:

```ts
/** Excel 数据模型服务（xlsx 解析/序列化；人与 AI 共用读写面）。 */
excel: ExcelService;
```

In `src/bootstrap.ts`, import `ExcelService`, construct it with the already-created `files` service, and provide it under `"excel"` immediately after `"files"`.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run tests/excel-service.test.ts tests/bootstrap.test.ts && pnpm build`
Expected: all pass, including TypeScript.

```sh
git add src/host/excel.ts src/host/context.d.ts src/bootstrap.ts tests/excel-service.test.ts tests/bootstrap.test.ts
git commit -m "新增 Excel 宿主服务：ExcelJS 数据模型与读写契约 (#25)"
```

---

### Task 4: Worksheet-to-view pure model

**Files:**

- Create: `src/plugins/doc-excel/model.ts`
- Test: Create `tests/doc-excel-model.test.ts`

**Interfaces:**

- Consumes: an ExcelJS-shaped worksheet through the structural `SheetSource` interface (no Tauri or DOM imports).
- Produces:
  - `createSheetModel(sheet: SheetSource): ExcelSheetModel`
  - `visibleRowRange(scrollTop: number, viewportHeight: number, rowHeight: number, totalRows: number, overscan?: number): { start: number; count: number }`

- [ ] **Step 1: Write the failing model tests**

Create `tests/doc-excel-model.test.ts`:

```ts
// @vitest-environment jsdom
import { Workbook } from "exceljs";
import { expect, test } from "vitest";
import { createSheetModel, visibleRowRange } from "../src/plugins/doc-excel/model";

test("模型：文本、样式、列宽与合并单元格", () => {
  const wb = new Workbook();
  const ws = wb.addWorksheet("数据");
  ws.getColumn(1).width = 18;
  ws.getCell("A1").value = "标题";
  ws.getCell("A1").style.font = { bold: true, italic: true, color: { argb: "FF123456" } };
  ws.getCell("A1").style.fill = { pattern: "solid", fgColor: { argb: "FFABCDEF" } };
  ws.getCell("A1").style.alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell("B2").value = 7;
  ws.mergeCells("A3:B4");
  const model = createSheetModel(ws as never);
  expect(model.name).toBe("数据");
  expect(model.columnWidths).toEqual([152, 64]);
  expect(model.rows[0][0]).toMatchObject({
    text: "标题",
    style: { bold: true, italic: true, color: "#123456", background: "#abcdef", horizontal: "center", vertical: "middle" },
    rowSpan: 1,
    colSpan: 1,
    hidden: false,
  });
  expect(model.rows[2][0]).toMatchObject({ text: "", rowSpan: 2, colSpan: 2, hidden: false });
  expect(model.rows[3][1].hidden).toBe(true);
});

test("模型：空 sheet 是显式空模型", () => {
  const wb = new Workbook();
  const ws = wb.addWorksheet("空");
  const model = createSheetModel(ws as never);
  expect(model).toEqual({ name: "空", rowCount: 0, columnCount: 0, columnWidths: [], rows: [] });
});

test("虚拟滚动：视口加 overscan，且不到底时不制造空白", () => {
  expect(visibleRowRange(0, 280, 28, 1000, 10)).toEqual({ start: 0, count: 30 });
  expect(visibleRowRange(28 * 500, 280, 28, 1000, 10)).toEqual({ start: 490, count: 30 });
  expect(visibleRowRange(28 * 995, 280, 28, 1000, 10)).toEqual({ start: 970, count: 30 });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/doc-excel-model.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the pure model**

Create `src/plugins/doc-excel/model.ts` with these exact exported types and functions:

```ts
/** Structural subset of an ExcelJS worksheet; keeping it local avoids leaking ExcelJS types into DOM code. */
export interface SheetSource {
  name: string;
  rowCount: number;
  columnCount: number;
  model?: { merges?: string[] };
  getColumn(columnNumber: number): { width?: number };
  eachRow(options: { includeEmpty: boolean }, onRow: (row: {
    eachCell(options: { includeEmpty: boolean }, onCell: (cell: { text?: unknown; style?: CellStyleSource }, columnNumber: number) => void): void;
  }, rowNumber: number) => void): void;
}

/** Style fields the viewer can render without a style-editing toolbar. */
export interface CellStyleSource {
  font?: { bold?: boolean; italic?: boolean; color?: { argb?: string; rgb?: string } };
  fill?: { fgColor?: { argb?: string; rgb?: string } };
  alignment?: { horizontal?: "left" | "center" | "right"; vertical?: "top" | "middle" | "bottom" };
  border?: Partial<Record<"top" | "right" | "bottom" | "left", unknown>>;
}

/** Plain CSS-ready cell style; absent optional fields mean inherit. */
export interface ExcelCellStyle {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  background?: string;
  horizontal?: "left" | "center" | "right";
  vertical?: "top" | "middle" | "bottom";
  border?: { top: boolean; right: boolean; bottom: boolean; left: boolean };
}

/** One rendered worksheet cell. */
export interface ExcelCell {
  text: string;
  style: ExcelCellStyle;
  rowSpan: number;
  colSpan: number;
  hidden: boolean;
}

/** Plain view model for one worksheet. */
export interface ExcelSheetModel {
  name: string;
  rowCount: number;
  columnCount: number;
  columnWidths: number[];
  rows: ExcelCell[][];
}
```

Implementation requirements (write them as real code, not pseudocode):

- `emptyCell()` returns `{ text: "", style: {}, rowSpan: 1, colSpan: 1, hidden: false }`.
- Clamp column width with `Math.min(240, Math.max(64, Math.round((width ?? 8) * 8 + 8)))`; the default is therefore `72`, width `18` maps to `152`.
- Convert ARGB by dropping the first two hex digits; convert RGB directly; lowercase the result. Invalid/non-hex colors are omitted.
- Map border presence with `Boolean(style.border?.top)` etc.
- Initialize `rowCount × columnCount`; call `eachRow({ includeEmpty: true })` and `eachCell({ includeEmpty: true })`; write `String(cell.text ?? "")` only into valid in-range positions.
- Parse `A3:B4` merge ranges from `sheet.model?.merges ?? []`; set top-left `rowSpan`/`colSpan`, mark covered cells `hidden: true`, and leave their text empty.
- `visibleRowRange` computes capacity as `Math.ceil(viewportHeight / rowHeight) + overscan * 2`, starts at `floor(scrollTop / rowHeight) - overscan`, clamps to `[0, max(0, totalRows - capacity)]`, and returns the intersection with remaining rows.

- [ ] **Step 4: Verify and commit**

Run: `pnpm vitest run tests/doc-excel-model.test.ts && pnpm build`
Expected: pass.

```sh
git add src/plugins/doc-excel/model.ts tests/doc-excel-model.test.ts
git commit -m "Excel 视图纯模型：样式合并与虚拟滚动窗口 (#25)"
```

---

### Task 5: doc-excel viewer plugin, registration, and file-tree dispatch

**Files:**

- Create: `src/plugins/doc-excel/index.ts`
- Modify: `src/loader/table.ts`
- Modify: `src/plugins/view-filetree/index.ts`
- Modify: `src/styles.css`
- Test: Create `tests/doc-excel.test.ts`

**Interfaces:**

- Consumes:
  - `ctx.excel.read(path)`
  - `ctx.workspace.events.on("file-opened", ...)`
  - `ctx.slots.register("main.viewer", ...)`
  - `createSheetModel` / `visibleRowRange` from Task 4
- Produces:
  - plugin id `doc-excel`
  - manifest row `{ id: "doc-excel", defaults: {} }`
  - file-tree click opening `kind === "excel"`

- [ ] **Step 1: Write the failing plugin tests**

Create `tests/doc-excel.test.ts` with a fake workbook whose worksheet implements `SheetSource`:

```ts
// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { apply } from "../src/plugins/doc-excel";

function workbook() {
  return {
    worksheets: [{
      name: "一",
      rowCount: 1,
      columnCount: 2,
      model: { merges: [] },
      getColumn: () => ({ width: 10 }),
      eachRow: (_o: never, onRow: any) => onRow({
        eachCell: (_o: never, onCell: any) => {
          onCell({ text: "A", style: { font: { bold: true }, fill: { fgColor: { argb: "FF112233" } } } }, 1);
          onCell({ text: "B", style: {} }, 2);
        },
      }, 1),
    }, {
      name: "二",
      rowCount: 0,
      columnCount: 0,
      model: { merges: [] },
      getColumn: () => ({}),
      eachRow: () => {},
    }],
  };
}

function harness(wb: unknown = workbook()) {
  let opened!: (f: unknown) => void;
  const workspace = {
    activeFile: null as unknown,
    events: { on: (_k: string, fn: (f: unknown) => void) => { opened = (f: unknown) => { workspace.activeFile = f; fn(f); }; return () => {}; } },
  };
  const excel = { read: vi.fn(async () => wb) };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ excel, workspace, slots } as never, {});
  return { opened, excel };
}

test("DOM：渲染 sheet 页签、样式与单元格；可切换 sheet", async () => {
  const { opened } = harness();
  await opened({ name: "a.xlsx", path: "/x/a.xlsx", kind: "excel" });
  expect(document.querySelector(".excel-tabs")?.textContent).toContain("一二");
  const cell = document.querySelector<HTMLElement>('[data-address="A1"]');
  expect(cell?.textContent).toBe("A");
  expect(cell?.style.fontWeight).toBe("700");
  expect(cell?.style.backgroundColor).toBe("rgb(17, 34, 51)");
  document.querySelectorAll<HTMLButtonElement>(".excel-tab")[1].click();
  expect(document.querySelector(".excel-empty")?.textContent).toContain("此 sheet 为空");
});

test("DOM：非 excel 清空；读取失败显示错误面板", async () => {
  const { opened } = harness();
  await opened({ name: "a.md", path: "/x/a.md", kind: "markdown" });
  expect(document.querySelector(".excel-viewer")).toBeNull();
  const failing = { read: vi.fn(async () => { throw new Error("bad zip"); }) };
  let open!: (f: unknown) => void;
  const workspace = { activeFile: null, events: { on: (_k: string, fn: (f: unknown) => void) => { open = fn; return () => {}; } } };
  apply({ excel: failing, workspace, slots: { register: (_s: string, r: (el: HTMLElement) => void) => { r(document.body); return () => {}; } } } as never, {});
  await open({ name: "bad.xlsx", path: "/x/bad.xlsx", kind: "excel" });
  await vi.waitFor(() => expect(document.querySelector(".doc-error")?.textContent).toContain("读取失败"));
});
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/doc-excel.test.ts`
Expected: FAIL — plugin module does not exist.

- [ ] **Step 3: Implement the plugin**

Create `src/plugins/doc-excel/index.ts` with:

```ts
import type { Context } from "cordis";
import type { Workbook } from "exceljs";
import type { FileNode } from "../../types";
import { createSheetModel, visibleRowRange, type ExcelSheetModel } from "./model";

export const name = "doc-excel";
export const inject = ["excel", "workspace", "slots"];
```

Implementation contract:

- Keep local state: `host`, `current: FileNode | null`, `workbook: Workbook | null`, `sheetIndex`, `models: ExcelSheetModel[]`, `error: string | null`, `loading`, `openSeq`, and first visible row.
- Increment `openSeq` on every file event; ignore stale async results.
- On `kind !== "excel"`, hide/clear the viewer. On Excel, show a loading row, call `ctx.excel.read`, replace all sheet models, select worksheet `0`, and clear errors.
- Read failures render `.doc-error` with exactly `读取失败：${message}` and retain no stale workbook.
- Toolbar contains `.excel-tabs`; one `button.excel-tab` per worksheet, `aria-pressed` reflects selection, and clicking resets scroll/range and repaints.
- Scroll host is `.excel-scroll`; row height is `28`; repaint only when `visibleRowRange(...).start` changes. Top and bottom spacers plus sticky header preserve scrollbar geometry.
- Grid cells use `data-address` generated from one-based row/column (A1 notation helper may remain private). Apply text with `textContent` only; map style to inline CSS (`fontWeight: 700`, font style, color, background, textAlign, vertical alignment, borders via classes/inline styles). Never use `innerHTML`.
- Cells from `createSheetModel` use explicit `grid-column` and `grid-row`; hidden covered cells remain empty placeholders.
- Empty selected sheet renders `.excel-empty` with text `此 sheet 为空`.
- Teardown removes the file-opened subscription, slot registration, and scroll listener.

Register the row in `src/loader/table.ts` after `doc-video`:

```ts
"doc-excel": { plugin: docExcel as PluginModule, defaults: {} },
```

Update file-tree dispatch:

```ts
} else if (node.kind === "markdown" || node.kind === "video" || node.kind === "excel") {
  ctx.workspace.openFile(node);
}
```

Use the existing `module` icon for `kind-excel` rows and keep `play` for video.

- [ ] **Step 4: Add styles**

Append a dedicated Excel section to `src/styles.css` using existing CSS variables:

- `.excel-viewer`: grid rows `auto minmax(0, 1fr)`, paper background.
- `.excel-tabs`: horizontal flex, hairline bottom, no-wrap, quiet inactive buttons and azurite active state.
- `.excel-scroll`: overflow both axes, paper background.
- `.excel-grid`: CSS grid, `width: max-content; min-width: 100%; grid-template-columns: 36px repeat(var(--excel-cols), var(--excel-col-width));`.
- `.excel-header-row`, `.excel-row`, `.excel-cell`, `.excel-cell-hidden`, border/hover/focus styles.
- Respect `prefers-reduced-motion`; do not add animations beyond existing hover transitions.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run tests/doc-excel.test.ts tests/doc-excel-model.test.ts tests/loader.test.ts && pnpm verify:layering`
Expected: pass.

```sh
git add src/plugins/doc-excel/index.ts src/loader/table.ts src/plugins/view-filetree/index.ts src/styles.css tests/doc-excel.test.ts
git commit -m "新增 doc-excel 查看器：多 sheet 样式渲染与虚拟滚动 (#25)"
```

---

### Task 6: Follow-up issue, documentation, generated catalogs, and final gates

**Files:**

- Create: `.agents/flow/issues/m1-03-excel-editing.md`
- Create: `.agents/flow/issues/m1-03-excel-editing.en.md`
- Create: `.agents/flow/issues/m1-03-excel-editing.i18n.yaml`
- Modify: `.agents/flow/issues/m1-01-excel-viewer.md`
- Modify: `.agents/flow/issues/m1-01-excel-viewer.en.md`
- Modify: `.agents/flow/issues/m1-01-excel-viewer.i18n.yaml`
- Modify: `.agents/notes/proposed/feature/2026-09-20-excel-viewer.md`
- Modify: `.agents/notes/proposed/feature/2026-09-20-excel-viewer.en.md`
- Modify: `.agents/notes/proposed/feature/2026-09-20-excel-viewer.i18n.yaml`
- Modify: `docs/architecture.md`
- Modify: `docs/architecture.en.md`
- Modify: `docs/commands.md`
- Modify: `docs/commands.en.md`
- Modify: `scripts/code-map.manifest.json`

**Interfaces:**

- Consumes: all implementation from Tasks 1–5.
- Produces:
  - backlog GitHub issue for m1-03 Excel editing
  - implemented Agent Note for the viewer architecture
  - fresh command catalog and architecture code map
  - m1-01 status `done`

- [ ] **Step 1: Create the editing follow-up issue**

First add `.agents/flow/issues/m1-03-excel-editing.*` to m1-01's scope union in both language files, then run:

```sh
pnpm flow:new-issue -- --milestone m1 --priority P0 --slug excel-editing \
  --title "excel 页面编辑" \
  --title-en "Excel page editing" \
  --scope "src/plugins/doc-excel/**,src/styles.css,tests/**,docs/architecture.*,docs/commands.*"
```

Fill both language bodies concretely:

- Background: viewer and shared read/write service exist; humans still need page editing and the style toolbar promised by the approved design.
- Goals: cell value editing, font/color/merge style controls, dirty flag, close guard, save through `ctx.excel.write`; preserve data + styles while explicitly not promising chart/pivot losslessness.
- Acceptance: edits survive reopen; dirty state and guard behave like doc-markdown; `verify:layering`, `verify:env-independence`, and `verify:dep-audit` pass.

Add the approved proposed Note to its `adr` list, run `pnpm flow:sync` to create the GitHub issue and backfill its number, then re-record all changed flow pairs. Also add `.agents/notes/implemented/feature/2026-09-20-excel-viewer.*` to m1-01's scope before moving the Note in Step 3.

- [ ] **Step 2: Update architecture and command/catalog generated regions**

Manual bilingual changes in `docs/architecture.*`:

- bootstrap line: five host services becomes six and mentions `excel`.
- context map entry: add `excel` service.
- code tree entries: add `src/host/excel.ts`, `src/plugins/doc-excel/index.ts`, and `src/plugins/doc-excel/model.ts`.
- data-flow paragraph: excel opens through `ctx.excel.read` (ExcelJS workbook) and future saves/writes pass through `ctx.excel.write` → binary command → atomic Rust write → `fs://changed`.
- `FileNode` type-equivalence fence: add `"excel"` and update the dispatch comment on both sides.
- key decisions: add that xlsx semantics live in frontend ExcelJS while Rust stays a byte boundary.

Add all three new source files to `scripts/code-map.manifest.json` with accurate one-line descriptions, then run:

```sh
pnpm gen:commands
pnpm gen:code-map
pnpm record:i18n -- docs/architecture
```

- [ ] **Step 3: Move the design Note to implemented**

Move the three `2026-09-20-excel-viewer` files from `.agents/notes/proposed/feature/` to `.agents/notes/implemented/feature/`; change both `Status:` values to `implemented`; update the issue `adr` path from `proposed` to `implemented`; re-record the Note pair. Do not rewrite history or add implementation narration—the Note remains the decision record.

- [ ] **Step 4: Close local issue state**

Set m1-01 to `status: done` in both language files; keep m1 milestone `active` because m1-02 and m1-03 remain open. Re-record the issue pair.

- [ ] **Step 5: Run final verification**

Run exactly:

```sh
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm verify:docs
pnpm verify:env-independence
pnpm verify:dep-audit
pnpm verify:layering
pnpm verify:flow
pnpm verify:commands
```

Expected: every command passes. If sandbox network restrictions affect the npm-pack-based plugin template test, rerun that single test with approved network exactly as in PR #39; all repository-owned gates must still pass locally.

- [ ] **Step 6: Commit and prepare PR**

```sh
git add .agents/flow .agents/notes docs scripts/code-map.manifest.json
git commit -m "补齐 Excel 文档面并拆分页面编辑后续 (#25)"
```

Push the branch and open a PR titled:

```text
Excel 查看器与可编辑数据模型 (#25)
```

PR body must include: architecture summary, viewer-only scope, m1-03 editing follow-up number, full gate output summary, and the explicit fidelity caveat that charts/pivot tables are not promised lossless. After CI passes and the PR is merged, close GitHub issue #25 and attach the m1 milestone to the PR before merging (or immediately afterward and rerun `flow-online` if timing caused a stale check).

---

## Self-Review

- Spec coverage: `.xlsx` dispatch (Task 1), byte boundary + atomic write (Task 1), binary service (Task 2), ExcelJS workbook service and cell cap (Task 3), style/merge/empty/virtual reading (Tasks 4–5), dependency/environment gates (Tasks 1 and 6), human/AI shared surface (Task 3), editing split (Task 6), docs/generated catalogs (Task 6).
- Placeholder scan: no TBD/TODO or unspecified error handling remains; every code task has concrete tests and interfaces.
- Type consistency: `readBinary`/`writeBinary`, `ExcelService.read/write`, `createSheetModel`, `visibleRowRange`, plugin id `doc-excel`, and `FileNode.kind: "excel"` are used consistently across tasks.
