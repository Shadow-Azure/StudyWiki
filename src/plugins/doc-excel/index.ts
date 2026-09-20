import type { Context } from "cordis";
import type { Workbook } from "exceljs";
import type { FileNode } from "../../types";
import { createSheetModel, visibleRowRange, type ExcelSheetModel, type SheetSource } from "./model";

/** Plugin id in the manifest and the static module table. */
export const name = "doc-excel";
/** Service keys awaited before apply runs. */
export const inject = ["excel", "workspace", "slots"];

/** Fixed row pitch shared by the scrollbar geometry, virtual-window math, and grid rows. */
const ROW_HEIGHT = 28;
/** Initial fallback used before layout reports the real scroll-viewport height. */
const INITIAL_VIEWPORT_HEIGHT = 280;

/** Convert a one-based column number to Excel A1 notation. */
function columnAddress(column: number): string {
  let text = "";
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) {
    text = String.fromCharCode(65 + ((value - 1) % 26)) + text;
  }
  return text;
}

/** Apply the model's plain style fields as inline CSS and border classes. */
function paintCellStyle(cell: HTMLElement, model: ExcelSheetModel["rows"][number][number]): void {
  const { style } = model;
  cell.style.fontWeight = style.bold === undefined ? "" : style.bold ? "700" : "400";
  cell.style.fontStyle = style.italic === undefined ? "" : style.italic ? "italic" : "normal";
  cell.style.color = style.color ?? "";
  cell.style.backgroundColor = style.background ?? "";
  cell.style.textAlign = style.horizontal ?? "";
  cell.style.verticalAlign = style.vertical ?? "";
  if (style.border?.top) cell.classList.add("excel-border-top");
  if (style.border?.right) cell.classList.add("excel-border-right");
  if (style.border?.bottom) cell.classList.add("excel-border-bottom");
  if (style.border?.left) cell.classList.add("excel-border-left");
}

/** Excel viewer for the active workbook: sheet tabs, styled grid cells, merged
 * placeholders, and row-windowed repaint driven by the pure sheet model.
 * @param ctx Host context (excel/workspace/slots injected).
 * @param _config Unused; the plugin takes no options.
 * @returns Teardown removing the file-opened subscription, slot renderer and scroll listener. */
export function apply(ctx: Context, _config: Record<string, never>): () => void {
  let host: HTMLElement | null = null;
  let current: FileNode | null = null;
  let workbook: Workbook | null = null;
  let sheetIndex = -1;
  let models: ExcelSheetModel[] = [];
  let error: string | null = null;
  let loading = false;
  let openSeq = 0;
  let firstRow = 0;
  let scroll: HTMLDivElement | null = null;

  const clearDocument = (): void => {
    workbook = null;
    models = [];
    sheetIndex = -1;
    firstRow = 0;
  };

  const paintWindow = (): void => {
    if (!scroll) return;
    const model = models[sheetIndex];
    const topSpacer = scroll.querySelector<HTMLElement>(".excel-top-spacer");
    const bottomSpacer = scroll.querySelector<HTMLElement>(".excel-bottom-spacer");
    const grid = scroll.querySelector<HTMLElement>(".excel-grid");
    if (!model || !topSpacer || !bottomSpacer || !grid) return;

    const range = visibleRowRange(scroll.scrollTop, scroll.clientHeight || INITIAL_VIEWPORT_HEIGHT, ROW_HEIGHT, model.rowCount);
    firstRow = range.start;
    topSpacer.style.height = `${range.start * ROW_HEIGHT}px`;
    bottomSpacer.style.height = `${Math.max(0, model.rowCount - (range.start + range.count)) * ROW_HEIGHT}px`;
    grid.style.setProperty("--excel-cols", String(model.columnCount));
    grid.style.setProperty("--excel-rows", String(range.count));
    grid.style.setProperty("--excel-col-width", `${model.columnWidths[0] ?? 64}px`);
    grid.replaceChildren();

    for (let rowIndex = range.start; rowIndex < range.start + range.count; rowIndex += 1) {
      const row = document.createElement("div");
      row.className = "excel-row";
      for (const [columnIndex, cellModel] of model.rows[rowIndex].entries()) {
        const cell = document.createElement("div");
        cell.className = cellModel.hidden ? "excel-cell excel-cell-hidden" : "excel-cell";
        cell.dataset.address = `${columnAddress(columnIndex + 1)}${rowIndex + 1}`;
        cell.style.gridColumn = `${columnIndex + 2} / span ${cellModel.colSpan}`;
        cell.style.gridRow = `${rowIndex - range.start + 1} / span ${cellModel.rowSpan}`;
        paintCellStyle(cell, cellModel);
        cell.textContent = cellModel.text;
        row.append(cell);
      }
      grid.append(row);
    }
  };

  const render = (): void => {
    if (!host) return;
    scroll?.removeEventListener("scroll", onScroll);
    host.replaceChildren();
    if (!current || current.kind !== "excel") {
      host.hidden = true;
      return;
    }

    host.hidden = false;
    if (error) {
      const bar = document.createElement("div");
      bar.className = "doc-error";
      const message = document.createElement("span");
      message.textContent = error;
      bar.append(message);
      host.append(bar);
      return;
    }
    if (loading || !workbook) {
      const loadingRow = document.createElement("div");
      loadingRow.className = "excel-loading";
      loadingRow.textContent = "加载中…";
      host.append(loadingRow);
      return;
    }

    const viewer = document.createElement("div");
    viewer.className = "excel-viewer";
    const tabs = document.createElement("div");
    tabs.className = "excel-tabs";
    models.forEach((model, index) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "excel-tab";
      tab.textContent = model.name;
      tab.setAttribute("aria-pressed", String(index === sheetIndex));
      tab.addEventListener("click", () => {
        if (index === sheetIndex) return;
        sheetIndex = index;
        firstRow = 0;
        if (scroll) scroll.scrollTop = 0;
        render();
      });
      tabs.append(tab);
    });

    scroll = document.createElement("div");
    scroll.className = "excel-scroll";
    scroll.tabIndex = 0;
    const topSpacer = document.createElement("div");
    topSpacer.className = "excel-top-spacer";
    const header = document.createElement("div");
    header.className = "excel-header-row";
    header.setAttribute("aria-hidden", "true");
    const bottomSpacer = document.createElement("div");
    bottomSpacer.className = "excel-bottom-spacer";
    const grid = document.createElement("div");
    grid.className = "excel-grid";
    scroll.append(topSpacer, header, grid, bottomSpacer);
    viewer.append(tabs, scroll);
    host.append(viewer);

    const selectedModel = model();
    grid.style.setProperty("--excel-cols", String(selectedModel?.columnCount ?? 0));
    grid.style.setProperty("--excel-col-width", `${selectedModel?.columnWidths[0] ?? 64}px`);
    if (!selectedModel || selectedModel.rowCount === 0) {
      const empty = document.createElement("div");
      empty.className = "excel-empty";
      empty.textContent = "此 sheet 为空";
      scroll.append(empty);
      return;
    }
    paintHeader(header);
    paintWindow();
    scroll.addEventListener("scroll", onScroll);
  };

  /** Paint the sticky row-number/column-letter header for the selected model. */
  function paintHeader(header: HTMLElement): void {
    const model = models[sheetIndex];
    header.replaceChildren();
    if (!model) return;
    header.style.setProperty("--excel-cols", String(model.columnCount));
    header.style.setProperty("--excel-col-width", `${model.columnWidths[0] ?? 64}px`);
    const corner = document.createElement("div");
    corner.className = "excel-header-cell";
    corner.style.gridColumn = "1";
    corner.style.gridRow = "1";
    header.append(corner);
    for (let column = 1; column <= model.columnCount; column += 1) {
      const label = document.createElement("div");
      label.className = "excel-header-cell";
      label.style.gridColumn = String(column + 1);
      label.style.gridRow = "1";
      label.textContent = columnAddress(column);
      header.append(label);
    }
  }

  const model = (): ExcelSheetModel | null => models[sheetIndex] ?? null;

  function onScroll(): void {
    if (!scroll) return;
    const selected = model();
    if (!selected) return;
    const range = visibleRowRange(
      scroll.scrollTop,
      scroll.clientHeight || INITIAL_VIEWPORT_HEIGHT,
      ROW_HEIGHT,
      selected.rowCount,
    );
    if (range.start === firstRow) return;
    paintWindow();
  }

  const open = async (file: FileNode | null): Promise<void> => {
    const seq = ++openSeq;
    current = file;
    error = null;
    clearDocument();
    if (file?.kind !== "excel") {
      loading = false;
      render();
      return;
    }

    loading = true;
    render();
    try {
      const loaded = await ctx.excel.read(file.path);
      if (seq !== openSeq) return;
      loading = false;
      workbook = loaded;
      models = loaded.worksheets.map((sheet) => createSheetModel(sheet as unknown as SheetSource));
      sheetIndex = models.length > 0 ? 0 : -1;
      firstRow = 0;
      render();
    } catch (e) {
      if (seq !== openSeq) return;
      loading = false;
      clearDocument();
      error = `读取失败：${e instanceof Error ? e.message : String(e)}`;
      render();
    }
  };

  const offFile = ctx.workspace.events.on("file-opened", (file) => void open(file));
  const offSlot = ctx.slots.register("main.viewer", (el) => {
    host = el;
    render();
    void open(ctx.workspace.activeFile);
  });
  return () => {
    scroll?.removeEventListener("scroll", onScroll);
    scroll = null;
    host = null;
    offFile();
    offSlot();
  };
}
