// @vitest-environment jsdom
import { Workbook } from "exceljs";
import { beforeEach, expect, test, vi } from "vitest";
import { ExcelService, parseWorkbook } from "../src/host/excel";
import { apply } from "../src/plugins/doc-excel";
import type { FileNode } from "../src/types";

function workbook(): Workbook {
  const wb = new Workbook();
  const ws = wb.addWorksheet("S");
  ws.getCell("A1").value = "007";
  ws.getCell("B1").value = "B";
  ws.getCell("A2").value = 1;
  ws.getCell("B2").value = 2;
  return wb;
}

function makeCtx(wb: Workbook, write: ((path: string, workbook: Workbook) => Promise<void>) | null = null) {
  const file: FileNode = { name: "a.xlsx", path: "/lib/a.xlsx", kind: "excel" };
  const writes: Array<[string, Workbook]> = [];
  const savedBytes: Uint8Array[] = [];
  const excel = {
    read: vi.fn(async () => wb),
    write: vi.fn(async (path: string, book: Workbook) => {
      writes.push([path, book]);
      if (write) {
        await write(path, book);
        return;
      }
      await new ExcelService({
        readBinary: async () => { throw new Error("not read in this harness"); },
        writeBinary: async (_path: string, bytes: Uint8Array) => { savedBytes.push(bytes); },
      }).write(path, book);
    }),
  };
  let opened!: (file: FileNode | null) => void;
  const workspace = {
    activeFile: null as FileNode | null,
    events: { on: (_k: string, fn: (file: FileNode | null) => void) => { opened = fn; return () => {}; } },
  };
  let guardShould: () => boolean = () => false;
  let guardConfirm: () => Promise<boolean> = async () => true;
  const guardClose = vi.fn(async (should: () => boolean, confirm: () => Promise<boolean>) => {
    guardShould = should;
    guardConfirm = confirm;
    return () => {};
  });
  const windows = { confirmDialog: vi.fn(async () => true), guardClose };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  return {
    file, excel, writes, savedBytes, guardShould: () => guardShould(), guardConfirm: () => guardConfirm(),
    opened: () => opened, ctx: { excel, workspace, windows, slots } as never,
  };
}

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>(".excel-toolbar button")].find((b) => b.textContent === text);
  expect(found, text).toBeTruthy();
  return found!;
}

function clickCell(address: string, shift = false): void {
  const cell = document.querySelector<HTMLElement>(`[data-address="${address}"]`);
  expect(cell, address).toBeTruthy();
  cell!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: shift }));
}

function dblClickCell(address: string): void {
  const cell = document.querySelector<HTMLElement>(`[data-address="${address}"]`);
  expect(cell, address).toBeTruthy();
  cell!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
}

function editor(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(".excel-cell-editor");
  expect(input).toBeTruthy();
  return input!;
}

beforeEach(() => {
  document.body.replaceChildren();
  document.title = "StudyWiki";
});

test("双击编辑：`'` 预填保留文本，Enter 提交数值并记脏；保存清脏", async () => {
  const wb = workbook();
  const c = makeCtx(wb);
  apply(c.ctx, {});
  await c.opened()(c.file);

  dblClickCell("A1");
  expect(editor().value).toBe("'007"); // 原值是会被数值化的字符串，编辑期显式转文本
  editor().value = "42";
  editor().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector(".excel-cell-editor")).toBeNull());
  expect(wb.getWorksheet("S")!.getCell("A1").value).toBe(42);
  expect(document.querySelector(".save-btn")?.classList.contains("dirty")).toBe(true);
  expect(document.title).toContain("●");

  button("保存").click();
  await vi.waitFor(() => expect(c.excel.write).toHaveBeenCalledWith("/lib/a.xlsx", wb));
  await vi.waitFor(() => expect(document.querySelector(".save-btn")?.classList.contains("dirty")).toBe(false));
  expect(c.guardShould()).toBe(false);
  await vi.waitFor(() => expect(c.savedBytes.length).toBe(1));
  const reopened = await parseWorkbook(c.savedBytes[0]!);
  expect(reopened.getWorksheet("S")!.getCell("A1").value).toBe(42);
  expect(reopened.getWorksheet("S")!.getCell("B1").value).toBe("B");
});

test("Esc 不落值，Ctrl+S 保存，失败保持脏并显示错误", async () => {
  const wb = workbook();
  const c = makeCtx(wb, async () => { throw new Error("disk full"); });
  apply(c.ctx, {});
  await c.opened()(c.file);

  dblClickCell("B1");
  editor().value = "changed";
  editor().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(wb.getWorksheet("S")!.getCell("B1").value).toBe("B");
  expect(document.querySelector(".save-btn")?.classList.contains("dirty")).toBe(false);

  dblClickCell("B1");
  editor().value = "changed";
  editor().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.waitFor(() => expect(c.guardShould()).toBe(true));
  document.querySelector<HTMLElement>(".excel-viewer")!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }),
  );
  await vi.waitFor(() => expect(document.querySelector(".doc-error")?.textContent).toContain("保存失败"));
  expect(document.querySelector(".save-btn")?.classList.contains("dirty")).toBe(true);
  expect(c.guardConfirm()).toBeInstanceOf(Promise);
});

test("工具条：选区加粗/斜体/颜色，Shift 扩选；合并与取消合并", async () => {
  const wb = workbook();
  const c = makeCtx(wb);
  apply(c.ctx, {});
  await c.opened()(c.file);

  clickCell("A1");
  button("加粗").click();
  expect(wb.getWorksheet("S")!.getCell("A1").style.font?.bold).toBe(true);

  clickCell("B1", true);
  button("斜体").click();
  expect(wb.getWorksheet("S")!.getCell("A1").style.font?.italic).toBe(true);
  expect(wb.getWorksheet("S")!.getCell("B1").style.font?.italic).toBe(true);

  clickCell("A1");
  const textColor = document.querySelector<HTMLInputElement>('.excel-toolbar input[aria-label="字体颜色"]')!;
  textColor.value = "#cc0000";
  textColor.dispatchEvent(new Event("input", { bubbles: true }));
  expect(wb.getWorksheet("S")!.getCell("A1").style.font?.color?.argb).toBe("FFCC0000");
  button("默认字色").click();
  expect(wb.getWorksheet("S")!.getCell("A1").style.font?.color).toBeUndefined();

  clickCell("A2", true); // A1:A2
  button("合并").click();
  expect(wb.getWorksheet("S")!.model.merges).toEqual(["A1:A2"]);
  expect(document.querySelector('[data-address="A1"]')?.getAttribute("data-selected")).toBe("true");
  button("取消合并").click();
  expect(wb.getWorksheet("S")!.model.merges ?? []).toEqual([]);
  expect(document.querySelector(".save-btn")?.classList.contains("dirty")).toBe(true);
});

test("合并覆盖格点击选中整段，双击编辑 anchor；关闭守卫读取实时脏状态", async () => {
  const wb = workbook();
  wb.getWorksheet("S")!.mergeCells("A1:B2");
  const c = makeCtx(wb);
  apply(c.ctx, {});
  await c.opened()(c.file);

  clickCell("A1");
  expect(document.querySelector('[data-address="A1"]')?.getAttribute("data-selected")).toBe("true");
  dblClickCell("A1");
  editor().value = "'075";
  editor().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector(".excel-cell-editor")).toBeNull());
  expect(wb.getWorksheet("S")!.getCell("A1").value).toBe("075");
  expect(c.guardShould()).toBe(true);
});

test("长合并 anchor 滚出视口后，双击可见片段仍可编辑并写回 anchor", async () => {
  const wb = workbook();
  wb.getWorksheet("S")!.mergeCells("A1:A200");
  const c = makeCtx(wb);
  apply(c.ctx, {});
  await c.opened()(c.file);

  const scroller = document.querySelector<HTMLElement>(".excel-scroll")!;
  scroller.scrollTop = 28 * 20;
  scroller.dispatchEvent(new Event("scroll"));
  const segment = document.querySelector<HTMLElement>(".excel-grid > .excel-cell");
  expect(segment).toBeTruthy();
  expect(segment.dataset.address).not.toBe("A1");

  segment.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  const input = document.querySelector<HTMLInputElement>(".excel-cell-editor")!;
  input.value = "42";
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector(".excel-cell-editor")).toBeNull());
  expect(wb.getWorksheet("S")!.getCell("A1").value).toBe(42);
});

test("Shift 扩选保持原始锚点：方向反转后再扩选不漂移", async () => {
  const wb = new Workbook();
  const ws = wb.addWorksheet("S");
  for (const address of ["A1", "B1", "C1", "A2", "B2", "C2", "A3", "B3", "C3", "A4", "B4", "C4"]) {
    ws.getCell(address).value = address;
  }
  const c = makeCtx(wb);
  apply(c.ctx, {});
  await c.opened()(c.file);

  clickCell("B3");
  clickCell("A1", true);
  let selected = [...document.querySelectorAll<HTMLElement>("[data-selected]")]
    .map((el) => el.dataset.address).sort();
  expect(selected).toEqual(["A1", "A2", "A3", "B1", "B2", "B3"]);

  clickCell("C4", true);
  selected = [...document.querySelectorAll<HTMLElement>("[data-selected]")]
    .map((el) => el.dataset.address).sort();
  expect(selected).toEqual(["B3", "B4", "C3", "C4"]);
});
