/** Structural subset of an ExcelJS worksheet; keeping it local avoids leaking ExcelJS types into DOM code. */
export interface SheetSource {
  name: string;
  rowCount: number;
  columnCount: number;
  model?: { merges?: string[] };
  getColumn(columnNumber: number): { width?: number };
  eachRow(options: { includeEmpty: boolean }, onRow: (row: {
    eachCell(options: { includeEmpty: boolean }, onCell: (cell: {
      text?: unknown;
      value?: unknown;
      numFmt?: string;
      style?: CellStyleSource;
    }, columnNumber: number) => void): void;
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

/** A merge normalized to zero-based, in-grid worksheet coordinates. */
export interface ExcelMerge {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Plain view model for one worksheet. */
export interface ExcelSheetModel {
  name: string;
  rowCount: number;
  columnCount: number;
  columnWidths: number[];
  rows: ExcelCell[][];
  merges: ExcelMerge[];
}

/** Create an untouched, renderable placeholder cell. */
function emptyCell(): ExcelCell {
  return { text: "", style: {}, rowSpan: 1, colSpan: 1, hidden: false };
}

/** Convert an Excel color to lowercase CSS hexadecimal color, or omit invalid values. */
function cssColor(color: { argb?: string; rgb?: string } | undefined): string | undefined {
  const value = color?.argb ?? color?.rgb;
  if (value === undefined) return undefined;
  if (/^[0-9a-f]{8}$/i.test(value)) return `#${value.slice(2).toLowerCase()}`;
  if (/^[0-9a-f]{6}$/i.test(value)) return `#${value.toLowerCase()}`;
  return undefined;
}

/** The formatter supports common date/time placeholders only; any other grammar falls back to ExcelJS text. */
const DATE_LOCALE = "en-CA";

/** Get the effective scalar behind direct, formula, and other ExcelJS value envelopes. */
function scalarValue(cell: { value?: unknown; text?: unknown }): unknown {
  const value = cell.value;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "formula" in value) {
    return (value as { result?: unknown }).result;
  }
  return value;
}

/** Format one date component through Intl so browser locale data supplies numeric rendering. */
function datePart(date: Date, component: string, twoDigit: boolean, hasAmPm: boolean): string {
  const width = twoDigit ? "2-digit" : "numeric";
  const options: Intl.DateTimeFormatOptions = component === "year" ? { year: width }
    : component === "month" ? { month: width }
    : component === "day" ? { day: width }
    : component === "hour" ? { hour: width, hourCycle: hasAmPm ? "h11" : "h23" }
    : component === "minute" ? { hour: "numeric", hourCycle: hasAmPm ? "h11" : "h23", minute: width }
    : component === "second"
    ? { hour: "numeric", hourCycle: hasAmPm ? "h11" : "h23", minute: "2-digit", second: width }
    : { second: width };
  const parts = new Intl.DateTimeFormat(DATE_LOCALE, options).formatToParts(date);
  return parts.find((part) => part.type === (component === "hour" ? "hour" : component))?.value ?? "";
}

/** Render supported date/time tokens in their authored order, keeping separator literals. */
function formatDate(value: unknown, numFmt: string): string | undefined {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return undefined;
  const hasAmPm = numFmt.includes("AM/PM");
  let output = "";
  let index = 0;
  let afterHour = false;
  while (index < numFmt.length) {
    if (numFmt[index] === '"') {
      const end = numFmt.indexOf('"', index + 1);
      if (end < 0) return undefined;
      output += numFmt.slice(index + 1, end);
      index = end + 1;
      continue;
    }
    if (numFmt[index] === "\\") {
      if (index + 1 >= numFmt.length) return undefined;
      output += numFmt[index + 1];
      index += 2;
      continue;
    }
    const token = (/^(yyyy|yy|mm|dd|hh|ss)/.exec(numFmt.slice(index)) ?? /^(y|m|d|h|s)/.exec(numFmt.slice(index)))?.[0];
    if (token) {
      const component = token.startsWith("y") ? "year"
        : token.startsWith("d") ? "day"
        : token.startsWith("h") ? "hour"
        : token.startsWith("s") ? "second"
        : afterHour ? "minute" : "month";
      if (component === "hour") afterHour = true;
      else if (component !== "minute") afterHour = false;
      output += datePart(value, component, token.length === 2, hasAmPm);
      index += token.length;
      continue;
    }
    if (numFmt.startsWith("AM/PM", index)) {
      const parts = new Intl.DateTimeFormat(DATE_LOCALE, { hour: "numeric", hourCycle: "h11" }).formatToParts(value);
      const period = parts.find((part) => part.type === "dayPeriod")?.value.toUpperCase().replace(/\./g, "");
      if (period !== "AM" && period !== "PM") return undefined;
      output += period;
      index += 5;
      continue;
    }
    const character = numFmt[index];
    if (/[a-z]/i.test(character) || !" -/:.,()".includes(character)) return undefined;
    output += character;
    index += 1;
  }
  return output;
}

/** Parse the supported numeric body and adjacent literal, currency, grouping, and percent decorations. */
function parseNumberFormat(numFmt: string): {
  prefix: string;
  suffix: string;
  grouping: boolean;
  decimals: number;
  percent: boolean;
} | undefined {
  let prefix = "";
  let index = 0;
  while (index < numFmt.length) {
    if (numFmt[index] === '"') {
      const end = numFmt.indexOf('"', index + 1);
      if (end < 0) return undefined;
      prefix += numFmt.slice(index + 1, end);
      index = end + 1;
      continue;
    }
    if (numFmt[index] === "\\") {
      if (index + 1 >= numFmt.length) return undefined;
      prefix += numFmt[index + 1];
      index += 2;
      continue;
    }
    if ("$€¥£".includes(numFmt[index])) {
      prefix += numFmt[index];
      index += 1;
      continue;
    }
    break;
  }

  const core = /^(\#?,##)?0(?:\.(0+))?/.exec(numFmt.slice(index));
  if (!core) return undefined;
  index += core[0].length;
  const grouping = core[1] !== undefined;
  const decimals = core[2]?.length ?? 0;
  let percent = false;
  let suffix = "";
  while (index < numFmt.length) {
    if (numFmt.startsWith("%", index)) {
      percent = true;
      index += 1;
      continue;
    }
    if (numFmt[index] === '"') {
      const end = numFmt.indexOf('"', index + 1);
      if (end < 0) return undefined;
      suffix += numFmt.slice(index + 1, end);
      index = end + 1;
      continue;
    }
    if (numFmt[index] === "\\") {
      if (index + 1 >= numFmt.length) return undefined;
      suffix += numFmt[index + 1];
      index += 2;
      continue;
    }
    if ("$€¥£".includes(numFmt[index])) {
      suffix += numFmt[index];
      index += 1;
      continue;
    }
    if (numFmt[index] === " ") {
      suffix += " ";
      index += 1;
      continue;
    }
    return undefined;
  }
  return { prefix, suffix, grouping, decimals, percent };
}

/** Format supported decimal, grouped, percent, and currency numbers; ambiguous formats return undefined. */
function formatNumber(value: unknown, numFmt: string): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const format = parseNumberFormat(numFmt);
  if (!format) return undefined;
  const formatted = new Intl.NumberFormat(DATE_LOCALE, {
    style: format.percent ? "percent" : "decimal",
    useGrouping: format.grouping,
    minimumFractionDigits: format.decimals,
    maximumFractionDigits: format.decimals,
  }).format(value);
  return format.prefix + formatted + format.suffix;
}

/** Render supported numeric/date values without mutating the ExcelJS source; unsupported data falls back to its text. */
function formatCellValue(cell: { text?: unknown; value?: unknown; numFmt?: string }): string {
  try {
    if (cell.numFmt) {
      const value = scalarValue(cell);
      if (value instanceof Date) {
        return formatDate(value, cell.numFmt) ?? String(cell.text ?? "");
      }
      const formatted = formatNumber(value, cell.numFmt);
      if (formatted !== undefined) return formatted;
    }
  } catch {
    // Formatting is a presentation enhancement; never let an unsupported webview locale break the grid.
  }
  const fallback = cell.text ?? scalarValue(cell);
  return typeof fallback === "number" || typeof fallback === "string" ? String(fallback) : "";
}

/** Parse an A1:B2 Excel merge reference and clamp it to the initialized worksheet grid. */
function parseMergeRange(merge: string, rowCount: number, columnCount: number): ExcelMerge | undefined {
  const match = /^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/.exec(merge);
  if (!match) return undefined;

  const toColumn = (letters: string) =>
    Array.from(letters).reduce((column, character) => column * 26 + (character.toUpperCase().charCodeAt(0) - 64), 0);
  const firstRow = Number(match[2]);
  const firstColumn = toColumn(match[1]);
  const lastRow = Number(match[4]);
  const lastColumn = toColumn(match[3]);
  const top = Math.max(0, Math.min(firstRow, lastRow) - 1);
  const left = Math.max(0, Math.min(firstColumn, lastColumn) - 1);
  const bottom = Math.min(rowCount - 1, Math.max(firstRow, lastRow) - 1);
  const right = Math.min(columnCount - 1, Math.max(firstColumn, lastColumn) - 1);
  if (top > bottom || left > right) return undefined;
  return { top, left, bottom, right };
}

/** Convert one Excel worksheet and its merges into a framework-independent view model.
 * @param sheet Structural worksheet source supplied by the Excel host service.
 * @returns CSS-ready cells, column widths, merges, and dimensions. */
export function createSheetModel(sheet: SheetSource): ExcelSheetModel {
  const rows: ExcelCell[][] = Array.from({ length: sheet.rowCount }, () =>
    Array.from({ length: sheet.columnCount }, emptyCell),
  );
  const columnWidths = Array.from({ length: sheet.columnCount }, (_, index) => {
    const width = sheet.getColumn(index + 1).width;
    return Math.min(240, Math.max(64, Math.round((width ?? 7) * 8 + 8)));
  });

  const merges = (sheet.model?.merges ?? [])
    .map((merge) => parseMergeRange(merge, sheet.rowCount, sheet.columnCount))
    .filter((merge): merge is ExcelMerge => merge !== undefined);
  const owner = rows.map(() => Array.from({ length: sheet.columnCount }, () => undefined as ExcelMerge | undefined));
  for (const merge of merges) {
    for (let row = merge.top; row <= merge.bottom; row += 1) {
      for (let column = merge.left; column <= merge.right; column += 1) {
        owner[row][column] ??= merge;
      }
    }
  }

  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const rowIndex = rowNumber - 1;
      const columnIndex = columnNumber - 1;
      if (rowIndex < 0 || rowIndex >= sheet.rowCount || columnIndex < 0 || columnIndex >= sheet.columnCount) {
        return;
      }

      const ownedMerge = owner[rowIndex][columnIndex];
      const isCovered = ownedMerge !== undefined && !(rowIndex === ownedMerge.top && columnIndex === ownedMerge.left);

      const sourceStyle = cell.style;
      const style: ExcelCellStyle = {};
      if (sourceStyle?.font?.bold !== undefined) style.bold = sourceStyle.font.bold;
      if (sourceStyle?.font?.italic !== undefined) style.italic = sourceStyle.font.italic;
      const color = cssColor(sourceStyle?.font?.color);
      if (color !== undefined) style.color = color;
      const background = cssColor(sourceStyle?.fill?.fgColor);
      if (background !== undefined) style.background = background;
      if (sourceStyle?.alignment?.horizontal !== undefined) style.horizontal = sourceStyle.alignment.horizontal;
      if (sourceStyle?.alignment?.vertical !== undefined) style.vertical = sourceStyle.alignment.vertical;
      if (sourceStyle?.border) {
        style.border = {
          top: Boolean(sourceStyle.border.top),
          right: Boolean(sourceStyle.border.right),
          bottom: Boolean(sourceStyle.border.bottom),
          left: Boolean(sourceStyle.border.left),
        };
      }

      rows[rowIndex][columnIndex] = {
        // Do not read ExcelJS covered-cell text getters: they can throw for an empty merge master.
        text: isCovered ? "" : formatCellValue(cell),
        style,
        rowSpan: 1,
        colSpan: 1,
        hidden: isCovered,
      };
    });
  });

  for (const { top, left, bottom, right } of merges) {
    if (rows[top][left].rowSpan === 1 && rows[top][left].colSpan === 1) {
      rows[top][left] = { ...rows[top][left], rowSpan: bottom - top + 1, colSpan: right - left + 1, hidden: false };
    }
    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) {
        if ((row !== top || column !== left) && rows[row][column].rowSpan === 1 && rows[row][column].colSpan === 1) {
          rows[row][column] = { ...rows[row][column], text: "", hidden: true };
        }
      }
    }
  }

  return {
    name: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    columnWidths,
    rows,
    merges,
  };
}

/** Return the safe row window for a virtualized worksheet viewport; overscan defaults to 3 rows on each side.
 * @param scrollTop Current viewport top position in pixels.
 * @param viewportHeight Visible viewport height in pixels.
 * @param totalRows Total worksheet rows.
 * @param rowHeight Fixed row pitch in pixels.
 * @param overscan Extra rows rendered above and below the window.
 * @returns Zero-based start row and clamped rendered-row count. */
export function visibleRowRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  totalRows: number,
  overscan = 3,
): { start: number; count: number } {
  const capacity = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const maxStart = Math.max(0, totalRows - capacity);
  const start = Math.min(maxStart, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
  return { start, count: Math.min(capacity, totalRows - start) };
}
