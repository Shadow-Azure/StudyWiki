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

test("虚拟滚动：默认 overscan 是上下各 3 行", () => {
  expect(visibleRowRange(0, 280, 28, 1000)).toEqual({ start: 0, count: 16 });
});
