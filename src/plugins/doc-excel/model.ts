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

/** A merge range normalized to zero-based, in-grid coordinates. */
interface MergeRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Parse an A1:B2 Excel merge reference and clamp it to the initialized worksheet grid. */
function parseMergeRange(merge: string, rowCount: number, columnCount: number): MergeRange | undefined {
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
    .filter((merge): merge is MergeRange => merge !== undefined);

  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const rowIndex = rowNumber - 1;
      const columnIndex = columnNumber - 1;
      if (rowIndex < 0 || rowIndex >= sheet.rowCount || columnIndex < 0 || columnIndex >= sheet.columnCount) {
        return;
      }

      const mergeRange = merges.find(
        ({ top, left, bottom, right }) =>
          rowIndex >= top && rowIndex <= bottom && columnIndex >= left && columnIndex <= right,
      );
      const isCovered = mergeRange !== undefined && !(rowIndex === mergeRange.top && columnIndex === mergeRange.left);

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
        text: isCovered ? "" : String(cell.text ?? ""),
        style,
        rowSpan: 1,
        colSpan: 1,
        hidden: isCovered,
      };
    });
  });

  for (const { top, left, bottom, right } of merges) {
    rows[top][left] = { ...rows[top][left], rowSpan: bottom - top + 1, colSpan: right - left + 1 };
    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) {
        if (row !== top || column !== left) rows[row][column] = { ...rows[row][column], text: "", hidden: true };
      }
    }
  }

  return {
    name: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    columnWidths,
    rows,
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
