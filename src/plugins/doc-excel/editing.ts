import type { ExcelMerge } from "./model";

/** Zero-based cell coordinate in worksheet space. */
export interface CellAddress {
  row: number;
  column: number;
}

/** Zero-based rectangular selection in worksheet coordinates (inclusive bounds). */
export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Structural subset of an ExcelJS worksheet cell mutated by edit operations. */
export interface EditCell {
  value: unknown;
  style: {
    font?: { bold?: boolean; italic?: boolean; color?: { argb?: string } };
    fill?: unknown;
  };
}

/** Structural subset of an ExcelJS worksheet for edit operations. */
export interface WorksheetEditSource {
  getCell(row: number, column: number): EditCell;
  mergeCells(range: string): void;
  unMergeCells(range: string): void;
}

/** Convert a one-based column number to Excel A1 notation.
 * @param column One-based column number.
 * @returns Column letters (A…Z, AA…). */
export function columnAddress(column: number): string {
  let text = "";
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) {
    text = String.fromCharCode(65 + ((value - 1) % 26)) + text;
  }
  return text;
}

/** Format a zero-based range as an Excel A1 reference.
 * @param range Zero-based inclusive range.
 * @returns `A1` for a single cell, `A1:B2` for a rectangle. */
export function rangeAddress(range: CellRange): string {
  const tl = `${columnAddress(range.left + 1)}${range.top + 1}`;
  if (range.top === range.bottom && range.left === range.right) return tl;
  return `${tl}:${columnAddress(range.right + 1)}${range.bottom + 1}`;
}

/** Normalize two corners into a top/left/bottom/right rectangle.
 * @param a One corner (zero-based).
 * @param b Opposite corner (zero-based).
 * @returns Range with ordered bounds. */
export function normalizeRange(a: CellAddress, b: CellAddress): CellRange {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.column, b.column),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.column, b.column),
  };
}

/** Test whether two ranges share at least one cell.
 * @param a First range.
 * @param b Second range.
 * @returns True when the rectangles overlap. */
export function rangesIntersect(a: CellRange, b: CellRange): boolean {
  return a.top <= b.bottom && b.top <= a.bottom && a.left <= b.right && b.left <= a.right;
}

/** The selection a click produces: the containing merge's bounds, or the single cell.
 * @param merges Normalized merges of the sheet model.
 * @param row Zero-based clicked row.
 * @param column Zero-based clicked column.
 * @returns Merge bounds when the click lands inside a merge, else a 1×1 range. */
export function clickSelection(merges: ExcelMerge[], row: number, column: number): CellRange {
  const single = { top: row, left: column, bottom: row, right: column };
  const hit = merges.find((merge) => rangesIntersect(merge, single));
  return hit ? { top: hit.top, left: hit.left, bottom: hit.bottom, right: hit.right } : single;
}

/** Parse inline-editor text into a cell value: a leading `'` forces text (Excel convention,
 * keeping leading zeros and long digit strings), blank input clears the cell, finite
 * numerics become numbers, everything else stays a string.
 * @param text Raw text from the inline editor.
 * @returns The value to store in the cell. */
export function parseCellInput(text: string): string | number | null {
  if (text.startsWith("'")) return text.slice(1);
  const trimmed = text.trim();
  if (trimmed === "") return null;
  // 十进制白名单而非裸 Number()：`Number` 会把 "0x10" / "0b101" 解析成数值，
  // 而 Excel/WPS 将它们按文本处理——只对十进制（含科学计数法）做数值化。
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;
  }
  return text;
}

/** Store inline-editor text into one cell.
 * @param sheet Worksheet to mutate.
 * @param row Zero-based row.
 * @param column Zero-based column.
 * @param text Raw editor text (see {@link parseCellInput}). */
export function setCellValue(sheet: WorksheetEditSource, row: number, column: number, text: string): void {
  sheet.getCell(row + 1, column + 1).value = parseCellInput(text);
}

/** Toggle bold/italic across a range; the target state follows the anchor cell
 * (set all when the anchor lacks the flag, clear all otherwise) — ribbon semantics.
 * @param sheet Worksheet to mutate.
 * @param range Cells to toggle.
 * @param flag Which font flag to toggle.
 * @param anchor Cell whose current state decides the direction.
 * @returns The applied flag state. */
export function toggleFontFlag(
  sheet: WorksheetEditSource,
  range: CellRange,
  flag: "bold" | "italic",
  anchor: CellAddress,
): boolean {
  const next = !sheet.getCell(anchor.row + 1, anchor.column + 1).style.font?.[flag];
  for (let row = range.top; row <= range.bottom; row += 1) {
    for (let column = range.left; column <= range.right; column += 1) {
      const cell = sheet.getCell(row + 1, column + 1);
      cell.style.font = { ...cell.style.font, [flag]: next };
    }
  }
  return next;
}

/** Convert a `#rrggbb` color-input value to the ARGB form ExcelJS stores. */
function argbOf(hex: string): string {
  return `FF${hex.slice(1)}`.toUpperCase();
}

/** Set or clear the font color across a range.
 * @param sheet Worksheet to mutate.
 * @param range Cells to recolor.
 * @param hex `#rrggbb` color, or null to clear (inherit default). */
export function setFontColor(sheet: WorksheetEditSource, range: CellRange, hex: string | null): void {
  for (let row = range.top; row <= range.bottom; row += 1) {
    for (let column = range.left; column <= range.right; column += 1) {
      const cell = sheet.getCell(row + 1, column + 1);
      const font = { ...cell.style.font };
      if (hex === null) delete font.color;
      else font.color = { argb: argbOf(hex) };
      cell.style.font = font;
    }
  }
}

/** Set or clear the solid fill color across a range.
 * @param sheet Worksheet to mutate.
 * @param range Cells to repaint.
 * @param hex `#rrggbb` color, or null to clear (pattern "none"). */
export function setFillColor(sheet: WorksheetEditSource, range: CellRange, hex: string | null): void {
  for (let row = range.top; row <= range.bottom; row += 1) {
    for (let column = range.left; column <= range.right; column += 1) {
      const cell = sheet.getCell(row + 1, column + 1);
      cell.style.fill = hex === null
        ? { type: "pattern", pattern: "none" }
        : { type: "pattern", pattern: "solid", fgColor: { argb: argbOf(hex) } };
    }
  }
}

/** Merge a rectangular range after unmerging any existing merges it intersects
 * (ExcelJS rejects overlapping merges); single-cell ranges are left untouched.
 * @param sheet Worksheet to mutate.
 * @param range Zero-based range to merge. */
export function mergeRange(sheet: WorksheetEditSource, range: CellRange): void {
  if (range.top === range.bottom && range.left === range.right) return;
  sheet.unMergeCells(rangeAddress(range));
  sheet.mergeCells(rangeAddress(range));
}

/** Unmerge every merge intersecting the range (ExcelJS scans the range itself).
 * @param sheet Worksheet to mutate.
 * @param range Zero-based range whose intersecting merges are removed. */
export function unmergeRange(sheet: WorksheetEditSource, range: CellRange): void {
  sheet.unMergeCells(rangeAddress(range));
}
