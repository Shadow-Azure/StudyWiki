import type { Context } from "cordis";
import type { Workbook } from "exceljs";
import type { FileNode } from "../../types";
import { icon } from "../../ui/icons";
import { labelButton } from "../../ui/dom";
import {
  clickSelection,
  columnAddress,
  mergeRange,
  normalizeRange,
  parseCellInput,
  rangesIntersect,
  setCellValue,
  setFillColor,
  setFontColor,
  toggleFontFlag,
  unmergeRange,
  type CellRange,
} from "./editing";
import { createSheetModel, visibleRowRange, type ExcelMerge, type ExcelSheetModel, type SheetSource } from "./model";

/** Plugin id in the manifest and the static module table. */
export const name = "doc-excel";
/** Service keys awaited before apply runs. */
export const inject = ["excel", "workspace", "windows", "slots"];

/** Fixed row pitch shared by the scrollbar geometry, virtual-window math, and grid rows. */
const ROW_HEIGHT = 28;
/** Initial fallback used before layout reports the real scroll-viewport height. */
const INITIAL_VIEWPORT_HEIGHT = 280;

/** Build the shared explicit CSS track template for a worksheet's header and data grid. */
function trackTemplate(model: ExcelSheetModel): string {
  return `36px ${model.columnWidths.map((width) => `${width}px`).join(" ")}`;
}

/** One merge anchor promoted from the plain worksheet model. */
interface MergeAnchor {
  row: number;
  column: number;
  cell: ExcelSheetModel["rows"][number][number];
}

/** A merge segment clipped to the current visible row window. */
interface MergeSegment {
  anchor: MergeAnchor;
  visualStart: number;
  visualEnd: number;
}

/** Live references to the toolbar controls whose state follows the selection. */
interface ToolbarState {
  bold: HTMLButtonElement;
  italic: HTMLButtonElement;
  merge: HTMLButtonElement;
  unmerge: HTMLButtonElement;
}

/** Collect normalized merge anchors directly from the sheet-model index. */
function mergeAnchors(model: ExcelSheetModel): MergeAnchor[] {
  const anchors: MergeAnchor[] = [];
  for (const { top, left } of model.merges satisfies ExcelMerge[]) {
    const cell = model.rows[top]?.[left];
    if (cell) anchors.push({ row: top, column: left, cell });
  }
  return anchors;
}

/** Clip every merge intersecting the window to one segment, including anchors above the window. */
function visibleMergeSegments(model: ExcelSheetModel, start: number, end: number): Map<string, MergeSegment> {
  const segments = new Map<string, MergeSegment>();
  for (const anchor of mergeAnchors(model)) {
    const anchorEnd = anchor.row + anchor.cell.rowSpan - 1;
    // Reject both directions: an anchor wholly below has anchorStart > end, wholly above has anchorEnd < start.
    if (anchor.row > end || anchorEnd < start) continue;
    const visualStart = Math.max(anchor.row, start);
    const visualEnd = Math.min(anchorEnd, end);
    segments.set(`${anchor.row}:${anchor.column}`, { anchor, visualStart, visualEnd });
  }
  return segments;
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

/** Seed the inline editor while preserving text-typed values: strings that the
 * input parser would numeralize gain the Excel `'` text-force prefix. */
function initialEditorText(cell: { value: unknown; text: string }): string {
  return typeof cell.value === "string" && parseCellInput(cell.value) !== cell.value ? `'${cell.value}` : cell.text;
}

/** Excel editor for the active workbook: sheet tabs, styled grid cells, merged
 * merge segments, row-windowed repaint driven by the pure sheet model, plus
 * inline cell editing, a style toolbar, save, and a close guard.
 * @param ctx Host context (excel/workspace/windows/slots injected).
 * @param _config Unused; the plugin takes no options.
 * @returns Teardown removing the file-opened subscription, slot renderer, scroll listener and close guard. */
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
  let selection: CellRange | null = null;
  let editing: { row: number; column: number } | null = null;
  let dirtyState = false;
  let toolbarState: ToolbarState | null = null;

  const clearDocument = (): void => {
    workbook = null;
    models = [];
    sheetIndex = -1;
    firstRow = 0;
    selection = null;
    editing = null;
    dirtyState = false;
  };

  const dirty = (): boolean => current?.kind === "excel" && dirtyState;

  const model = (): ExcelSheetModel | null => models[sheetIndex] ?? null;

  const worksheet = (): Workbook["worksheets"][number] | null => workbook?.worksheets[sheetIndex] ?? null;

  const paintChrome = (): void => {
    const isDirty = dirty();
    host?.querySelector(".save-btn")?.classList.toggle("dirty", isDirty);
    document.title = isDirty && current ? `● ${current.name}` : current?.name ?? "StudyWiki";
  };

  const errorBanner = (parent: HTMLElement): HTMLElement => {
    parent.querySelector(".doc-error")?.remove();
    const bar = document.createElement("div");
    bar.className = "doc-error";
    const message = document.createElement("span");
    message.textContent = error ?? "";
    const dismiss = labelButton("close", "", { className: "", ariaLabel: "关闭错误提示" });
    dismiss.addEventListener("click", () => { error = null; bar.remove(); });
    bar.append(icon("alert", 15), message, dismiss);
    parent.prepend(bar);
    return bar;
  };

  const save = async (): Promise<void> => {
    if (!current || current.kind !== "excel" || !workbook || !dirtyState) return;
    try {
      await ctx.excel.write(current.path, workbook);
      host?.querySelector(".doc-error")?.remove();
      error = null;
      dirtyState = false;
      paintChrome();
    } catch (e) {
      error = `保存失败：${e instanceof Error ? e.message : String(e)}`;
      if (host) errorBanner(host);
    }
  };

  const rebuildModel = (): void => {
    const ws = worksheet();
    if (!ws) return;
    models[sheetIndex] = createSheetModel(ws as unknown as SheetSource);
  };

  const commitEdit = (text: string): void => {
    const ws = worksheet();
    if (!editing || !ws) {
      editing = null;
      return;
    }
    setCellValue(ws, editing.row, editing.column, text);
    editing = null;
    dirtyState = true;
    rebuildModel();
    render();
  };

  const selected = (row: number, column: number): boolean =>
    selection !== null && row >= selection.top && row <= selection.bottom && column >= selection.left && column <= selection.right;

  const updateToolbar = (): void => {
    const tools = toolbarState;
    if (!tools) return;
    const ws = worksheet();
    const sheetModel = model();
    const noSelection = !ws || !sheetModel || !selection;
    tools.bold.disabled = noSelection;
    tools.italic.disabled = noSelection;
    if (!noSelection && selection) {
      const range = selection;
      const anchor = ws!.getCell(range.top + 1, range.left + 1);
      tools.bold.setAttribute("aria-pressed", String(anchor.style.font?.bold === true));
      tools.italic.setAttribute("aria-pressed", String(anchor.style.font?.italic === true));
      const single = range.top === range.bottom && range.left === range.right;
      const hit = sheetModel.merges.some((merge) => rangesIntersect(merge, range));
      tools.merge.disabled = single && !hit;
      tools.unmerge.disabled = !hit;
    } else {
      tools.bold.setAttribute("aria-pressed", "false");
      tools.italic.setAttribute("aria-pressed", "false");
      tools.merge.disabled = true;
      tools.unmerge.disabled = true;
    }
  };

  const select = (row: number, column: number, extend: boolean): void => {
    const sheetModel = model();
    if (!sheetModel) return;
    const next = extend && selection
      ? normalizeRange({ row: selection.top, column: selection.left }, { row, column })
      : clickSelection(sheetModel.merges, row, column);
    selection = next;
    paintSelection();
    updateToolbar();
  };

  const paintSelection = (): void => {
    if (!scroll) return;
    for (const el of scroll.querySelectorAll<HTMLElement>("[data-selected]")) el.removeAttribute("data-selected");
    if (!selection) return;
    const sheetModel = model();
    if (!sheetModel) return;
    const range = visibleRowRange(
      scroll.scrollTop,
      scroll.clientHeight || INITIAL_VIEWPORT_HEIGHT,
      ROW_HEIGHT,
      sheetModel.rowCount,
    );
    for (let row = range.start; row < range.start + range.count; row += 1) {
      for (let column = 0; column < sheetModel.columnCount; column += 1) {
        if (!selected(row, column)) continue;
        const address = `${columnAddress(column + 1)}${row + 1}`;
        scroll.querySelector<HTMLElement>(`[data-address="${address}"]`)?.setAttribute("data-selected", "true");
      }
    }
  };

  const startEdit = (row: number, column: number): void => {
    const ws = worksheet();
    const sheetModel = model();
    if (!ws || !sheetModel || editing) return;
    const merge = sheetModel.merges.find(
      (item) => row >= item.top && row <= item.bottom && column >= item.left && column <= item.right,
    );
    const targetRow = merge?.top ?? row;
    const targetColumn = merge?.left ?? column;
    const cellEl = scroll?.querySelector<HTMLElement>(`[data-address="${columnAddress(targetColumn + 1)}${targetRow + 1}"]`);
    if (!cellEl) return;
    const cell = ws.getCell(targetRow + 1, targetColumn + 1);
    editing = { row: targetRow, column: targetColumn };

    const input = document.createElement("input");
    input.className = "excel-cell-editor";
    input.value = initialEditorText(cell);
    input.setAttribute("aria-label", `编辑 ${columnAddress(targetColumn + 1)}${targetRow + 1}`);
    cellEl.textContent = "";
    cellEl.append(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = (commit: boolean): void => {
      if (finished) return;
      finished = true;
      const value = input.value;
      input.remove();
      if (commit) commitEdit(value);
      else {
        editing = null;
        render();
      }
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
  };

  const paintWindow = (): void => {
    if (!scroll) return;
    const sheetModel = model();
    const topSpacer = scroll.querySelector<HTMLElement>(".excel-top-spacer");
    const bottomSpacer = scroll.querySelector<HTMLElement>(".excel-bottom-spacer");
    const grid = scroll.querySelector<HTMLElement>(".excel-grid");
    if (!sheetModel || !topSpacer || !bottomSpacer || !grid) return;

    const range = visibleRowRange(scroll.scrollTop, scroll.clientHeight || INITIAL_VIEWPORT_HEIGHT, ROW_HEIGHT, sheetModel.rowCount);
    firstRow = range.start;
    topSpacer.style.height = `${range.start * ROW_HEIGHT}px`;
    bottomSpacer.style.height = `${Math.max(0, sheetModel.rowCount - (range.start + range.count)) * ROW_HEIGHT}px`;
    const segments = visibleMergeSegments(sheetModel, range.start, range.start + range.count - 1);
    grid.style.gridTemplateColumns = trackTemplate(sheetModel);
    grid.style.gridTemplateRows = `repeat(${range.count}, 28px)`;
    grid.replaceChildren();

    const bindCell = (cell: HTMLElement, row: number, column: number): void => {
      if (selected(row, column)) cell.setAttribute("data-selected", "true");
      cell.addEventListener("click", (event) => {
        if (editing) return;
        select(row, column, event.shiftKey);
      });
      cell.addEventListener("dblclick", () => {
        if (editing) return;
        select(row, column, false);
        startEdit(row, column);
      });
    };

    for (let rowIndex = range.start; rowIndex < range.start + range.count; rowIndex += 1) {
      const row = document.createElement("div");
      row.className = "excel-row";
      for (const [columnIndex, cellModel] of sheetModel.rows[rowIndex].entries()) {
        if (cellModel.hidden || segments.has(`${rowIndex}:${columnIndex}`)) continue;
        const cell = document.createElement("div");
        cell.className = "excel-cell";
        cell.dataset.address = `${columnAddress(columnIndex + 1)}${rowIndex + 1}`;
        cell.style.gridColumn = `${columnIndex + 2} / span ${cellModel.colSpan}`;
        cell.style.gridRow = `${rowIndex - range.start + 1} / span 1`;
        paintCellStyle(cell, cellModel);
        cell.textContent = cellModel.text;
        bindCell(cell, rowIndex, columnIndex);
        row.append(cell);
      }
      grid.append(row);
    }

    for (const segment of segments.values()) {
      const { anchor, visualStart, visualEnd } = segment;
      const cell = document.createElement("div");
      cell.className = "excel-cell";
      cell.dataset.address = `${columnAddress(anchor.column + 1)}${visualStart + 1}`;
      cell.style.gridColumn = `${anchor.column + 2} / span ${anchor.cell.colSpan}`;
      cell.style.gridRow = `${visualStart - range.start + 1} / span ${visualEnd - visualStart + 1}`;
      paintCellStyle(cell, anchor.cell);
      cell.textContent = anchor.cell.text;
      bindCell(cell, anchor.row, anchor.column);
      grid.append(cell);
    }
  };

  const toolbar = (): HTMLElement => {
    const bar = document.createElement("div");
    bar.className = "viewer-toolbar excel-toolbar";
    const boldBtn = labelButton("bold", "加粗", { className: "btn btn-ghost excel-tool" });
    boldBtn.addEventListener("click", () => {
      const ws = worksheet();
      if (!ws || !selection) return;
      toggleFontFlag(ws, selection, "bold", { row: selection.top, column: selection.left });
      dirtyState = true;
      rebuildModel();
      render();
    });
    const italicBtn = labelButton("italic", "斜体", { className: "btn btn-ghost excel-tool" });
    italicBtn.addEventListener("click", () => {
      const ws = worksheet();
      if (!ws || !selection) return;
      toggleFontFlag(ws, selection, "italic", { row: selection.top, column: selection.left });
      dirtyState = true;
      rebuildModel();
      render();
    });

    const colorControl = (title: string, clearText: string, apply: (hex: string | null) => void): HTMLElement => {
      const wrap = document.createElement("div");
      wrap.className = "excel-color";
      const input = document.createElement("input");
      input.type = "color";
      input.title = title;
      input.setAttribute("aria-label", title);
      input.addEventListener("input", () => apply(input.value));
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "btn btn-ghost";
      clear.textContent = clearText;
      clear.addEventListener("click", () => apply(null));
      wrap.append(input, clear);
      return wrap;
    };
    const editStyle = (apply: (sheet: NonNullable<ReturnType<typeof worksheet>>, range: CellRange) => void): void => {
      const ws = worksheet();
      if (!ws || !selection) return;
      apply(ws, selection);
      dirtyState = true;
      rebuildModel();
      render();
    };
    const textColor = colorControl("字体颜色", "默认字色", (hex) =>
      editStyle((sheet, range) => setFontColor(sheet, range, hex)));
    const fillColor = colorControl("填充颜色", "无填充", (hex) =>
      editStyle((sheet, range) => setFillColor(sheet, range, hex)));

    const mergeBtn = labelButton("merge", "合并", { className: "btn btn-ghost excel-tool" });
    mergeBtn.addEventListener("click", () => {
      const ws = worksheet();
      if (!ws || !selection) return;
      const range = selection;
      mergeRange(ws, range);
      dirtyState = true;
      rebuildModel();
      selection = clickSelection(models[sheetIndex]?.merges ?? [], range.top, range.left);
      render();
    });
    const unmergeBtn = labelButton("unmerge", "取消合并", { className: "btn btn-ghost excel-tool" });
    unmergeBtn.addEventListener("click", () => {
      const ws = worksheet();
      if (!ws || !selection) return;
      unmergeRange(ws, selection);
      dirtyState = true;
      rebuildModel();
      render();
    });

    const saveBtn = labelButton("save", "保存", { className: "btn btn-ghost save-btn" });
    saveBtn.setAttribute("aria-keyshortcuts", "Control+S");
    saveBtn.addEventListener("click", () => void save());

    bar.append(boldBtn, italicBtn, textColor, fillColor, mergeBtn, unmergeBtn, saveBtn);
    toolbarState = { bold: boldBtn, italic: italicBtn, merge: mergeBtn, unmerge: unmergeBtn };
    return bar;
  };

  const render = (): void => {
    if (!host) return;
    scroll?.removeEventListener("scroll", onScroll);
    scroll = null;
    toolbarState = null;
    host.replaceChildren();
    if (!current || current.kind !== "excel") {
      host.hidden = true;
      paintChrome();
      return;
    }

    host.hidden = false;
    if (error) errorBanner(host);
    if (loading || !workbook) {
      const loadingRow = document.createElement("div");
      loadingRow.className = "excel-loading";
      loadingRow.textContent = "加载中…";
      host.append(loadingRow);
      return;
    }

    const viewer = document.createElement("div");
    viewer.className = "excel-viewer";
    viewer.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    });
    const tabs = document.createElement("div");
    tabs.className = "excel-tabs";
    models.forEach((sheetModel, index) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "excel-tab";
      tab.textContent = sheetModel.name;
      tab.setAttribute("aria-pressed", String(index === sheetIndex));
      tab.addEventListener("click", () => {
        if (index === sheetIndex) return;
        sheetIndex = index;
        firstRow = 0;
        selection = null;
        editing = null;
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
    scroll.append(header, topSpacer, grid, bottomSpacer);
    viewer.append(toolbar(), tabs, scroll);
    host.append(viewer);

    const sheetModel = model();
    const tracks = sheetModel ? trackTemplate(sheetModel) : "36px";
    header.style.gridTemplateColumns = tracks;
    grid.style.gridTemplateColumns = tracks;
    grid.style.gridTemplateRows = "repeat(0, 28px)";
    if (!sheetModel || sheetModel.rowCount === 0) {
      const empty = document.createElement("div");
      empty.className = "excel-empty";
      empty.textContent = "此 sheet 为空";
      scroll.append(empty);
      updateToolbar();
      return;
    }
    paintHeader(header);
    paintWindow();
    updateToolbar();
    paintChrome();
    scroll.addEventListener("scroll", onScroll);
  };

  /** Paint the sticky column-letter header for the selected model. */
  function paintHeader(header: HTMLElement): void {
    const sheetModel = model();
    header.replaceChildren();
    if (!sheetModel) return;
    header.style.gridTemplateColumns = trackTemplate(sheetModel);
    const corner = document.createElement("div");
    corner.className = "excel-header-cell";
    corner.style.gridColumn = "1";
    corner.style.gridRow = "1";
    header.append(corner);
    for (let column = 1; column <= sheetModel.columnCount; column += 1) {
      const label = document.createElement("div");
      label.className = "excel-header-cell";
      label.style.gridColumn = String(column + 1);
      label.style.gridRow = "1";
      label.textContent = columnAddress(column);
      header.append(label);
    }
  }

  function onScroll(): void {
    if (!scroll) return;
    const sheetModel = model();
    if (!sheetModel) return;
    const range = visibleRowRange(
      scroll.scrollTop,
      scroll.clientHeight || INITIAL_VIEWPORT_HEIGHT,
      ROW_HEIGHT,
      sheetModel.rowCount,
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
      selection = null;
      editing = null;
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
  const offGuardPromise = ctx.windows.guardClose(
    () => dirty(),
    () => ctx.windows.confirmDialog(`放弃对 ${current?.name} 的未保存修改并关闭？`),
  );
  let offGuard: (() => void) | null = null;
  void offGuardPromise.then((off) => { offGuard = off; });
  return () => {
    scroll?.removeEventListener("scroll", onScroll);
    scroll = null;
    host = null;
    offFile();
    offSlot();
    offGuard?.();
    // guardClose promise may resolve after teardown; always drain it.
    void offGuardPromise.then((off) => off());
  };
}
