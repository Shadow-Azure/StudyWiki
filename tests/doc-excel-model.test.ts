// @vitest-environment jsdom
import { Workbook } from "exceljs";
import { expect, test } from "vitest";
import { createSheetModel, visibleRowRange } from "../src/plugins/doc-excel/model";

type ModelCell = { value?: unknown; numFmt?: string; text?: unknown; style?: unknown };


function source(cells: Record<string, ModelCell>, options: Partial<{ rowCount: number; columnCount: number; merges: string[] }> = {}) {
  const rowCount = options.rowCount ?? 1;
  const columnCount = options.columnCount ?? 1;
  return {
    name: "格式",
    rowCount,
    columnCount,
    model: { merges: options.merges ?? [] },
    getColumn: () => ({}),
    eachRow: (_o: never, onRow: (row: { eachCell: (_o: never, onCell: (cell: ModelCell, columnNumber: number) => void) => void }, rowNumber: number) => void) => {
      for (const [rowText, rowCells] of Object.entries(cells)) {
        const rowNumber = Number(rowText);
        onRow({ eachCell: (_o: never, onCell) => { for (const [columnText, cell] of Object.entries(rowCells)) onCell(cell, Number(columnText)); } }, rowNumber);
      }
    },
  };
}

test("模型：支持常见数字、百分比、货币与日期格式", () => {
  const date = new Date(2025, 8, 20, 15, 7, 9);
  const model = createSheetModel(source({
    1: {
      1: { value: date, numFmt: "yyyy-mm-dd", text: "raw" },
      2: { value: date, numFmt: "m/d/yy", text: "raw" },
    },
    2: {
      1: { value: 1234.5, numFmt: "#,##0.00", text: "raw" },
      2: { value: 0.125, numFmt: "0%", text: "raw" },
    },
    3: {
      1: { value: 0.1234, numFmt: "0.00%", text: "raw" },
      2: { value: 1234.5, numFmt: '"US$"#,##0.00', text: "raw" },
    },
    4: {
      1: { value: { formula: "A1+A2", result: 42 }, numFmt: "0.00", text: "raw" },
      2: { value: 1234.5, numFmt: `0.00 "items";;\\?`, text: "raw" },
    },
    5: { 1: { value: date, numFmt: "h:mm AM/PM", text: "raw" } },
  }, { rowCount: 5, columnCount: 2 }));

  expect(model.rows[0][0].text).toBe("2025-09-20");
  expect(model.rows[0][1].text).toBe("9/20/25");
  expect(model.rows[1][0].text).toBe("1,234.50");
  expect(model.rows[1][1].text).toBe("13%");
  expect(model.rows[2][0].text).toBe("12.34%");
  expect(model.rows[2][1].text).toBe("US$1,234.50");
  expect(model.rows[3][0].text).toBe("42.00");
  expect(model.rows[3][1].text).toBe("raw");
  expect(model.rows[4][0].text).toBe("3:07 PM");
});

test("模型：合并范围一次归一进模型", () => {
  const model = createSheetModel(source({ 2: { 2: { text: "合并" } } }, {
    rowCount: 3,
    columnCount: 3,
    merges: ["B2:C3", "invalid", "C3:B2"],
  }));
  expect(model.merges).toEqual([
    { top: 1, left: 1, bottom: 2, right: 2 },
    { top: 1, left: 1, bottom: 2, right: 2 },
  ]);
  expect(model.rows[1][1]).toMatchObject({ text: "合并", rowSpan: 2, colSpan: 2, hidden: false });
  expect(model.rows[2][2].hidden).toBe(true);
});

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
  expect(model).toEqual({ name: "空", rowCount: 0, columnCount: 0, columnWidths: [], rows: [], merges: [] });
});

test("虚拟滚动：视口加 overscan，且不到底时不制造空白", () => {
  expect(visibleRowRange(0, 280, 28, 1000, 10)).toEqual({ start: 0, count: 30 });
  expect(visibleRowRange(28 * 500, 280, 28, 1000, 10)).toEqual({ start: 490, count: 30 });
  expect(visibleRowRange(28 * 995, 280, 28, 1000, 10)).toEqual({ start: 970, count: 30 });
});

test("虚拟滚动：默认 overscan 是上下各 3 行", () => {
  expect(visibleRowRange(0, 280, 28, 1000)).toEqual({ start: 0, count: 16 });
});
