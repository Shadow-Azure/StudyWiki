import { Workbook } from "exceljs";
import { expect, test } from "vitest";
import {
  clickSelection,
  columnAddress,
  mergeRange,
  normalizeRange,
  parseCellInput,
  rangeAddress,
  rangesIntersect,
  setCellValue,
  setFillColor,
  setFontColor,
  toggleFontFlag,
  unmergeRange,
  type WorksheetEditSource,
} from "../src/plugins/doc-excel/editing";

function sheet(): WorksheetEditSource {
  const wb = new Workbook();
  return wb.addWorksheet("S") as unknown as WorksheetEditSource;
}

test("parseCellInput：十进制数值化、`'` 前缀强制文本、空白清空、非十进制留文本", () => {
  expect(parseCellInput("123")).toBe(123);
  expect(parseCellInput(" 1.5 ")).toBe(1.5);
  expect(parseCellInput("-2e3")).toBe(-2000);
  expect(parseCellInput("")).toBeNull();
  expect(parseCellInput("   ")).toBeNull();
  expect(parseCellInput("'007")).toBe("007");
  expect(parseCellInput("'123")).toBe("123");
  expect(parseCellInput("'''")).toBe("''");
  expect(parseCellInput("0x10")).toBe("0x10"); // Excel 同样按文本处理
  expect(parseCellInput("Infinity")).toBe("Infinity");
  expect(parseCellInput("甲")).toBe("甲");
});

test("地址与选区工具：columnAddress / rangeAddress / normalizeRange / rangesIntersect / clickSelection", () => {
  expect(columnAddress(1)).toBe("A");
  expect(columnAddress(27)).toBe("AA");
  expect(rangeAddress({ top: 0, left: 0, bottom: 0, right: 0 })).toBe("A1");
  expect(rangeAddress({ top: 0, left: 0, bottom: 2, right: 1 })).toBe("A1:B3");
  expect(normalizeRange({ row: 3, column: 2 }, { row: 1, column: 4 }))
    .toEqual({ top: 1, left: 2, bottom: 3, right: 4 });
  expect(rangesIntersect({ top: 0, left: 0, bottom: 1, right: 1 }, { top: 1, left: 1, bottom: 2, right: 2 })).toBe(true);
  expect(rangesIntersect({ top: 0, left: 0, bottom: 1, right: 1 }, { top: 2, left: 0, bottom: 3, right: 1 })).toBe(false);
  const merges = [{ top: 4, left: 1, bottom: 6, right: 2 }];
  expect(clickSelection(merges, 5, 2)).toEqual({ top: 4, left: 1, bottom: 6, right: 2 }); // 覆盖格→整段
  expect(clickSelection(merges, 5, 5)).toEqual({ top: 5, left: 5, bottom: 5, right: 5 });
});

test("setCellValue 写入解析后的值", () => {
  const ws = sheet();
  setCellValue(ws, 0, 0, "42");
  setCellValue(ws, 0, 1, "'042");
  setCellValue(ws, 1, 0, "文本");
  setCellValue(ws, 1, 1, "");
  expect(ws.getCell(1, 1).value).toBe(42);
  expect(ws.getCell(1, 2).value).toBe("042");
  expect(ws.getCell(2, 1).value).toBe("文本");
  expect(ws.getCell(2, 2).value).toBeNull();
});

test("toggleFontFlag：方向由锚点决定，二次调用还原", () => {
  const ws = sheet();
  const range = { top: 0, left: 0, bottom: 1, right: 1 };
  expect(toggleFontFlag(ws, range, "bold", { row: 0, column: 0 })).toBe(true);
  expect(ws.getCell(1, 1).style.font?.bold).toBe(true);
  expect(ws.getCell(2, 2).style.font?.bold).toBe(true);
  expect(toggleFontFlag(ws, range, "bold", { row: 0, column: 0 })).toBe(false);
  expect(ws.getCell(1, 1).style.font?.bold).toBe(false);
  // 斜体独立于加粗
  toggleFontFlag(ws, range, "italic", { row: 1, column: 1 });
  expect(ws.getCell(2, 2).style.font?.italic).toBe(true);
});

test("setFontColor / setFillColor：设置与清除", () => {
  const ws = sheet();
  const range = { top: 0, left: 0, bottom: 0, right: 1 };
  setFontColor(ws, range, "#112233");
  setFillColor(ws, range, "#ffee00");
  expect(ws.getCell(1, 1).style.font?.color).toEqual({ argb: "FF112233" });
  expect(ws.getCell(1, 2).style.font?.color).toEqual({ argb: "FF112233" });
  expect(ws.getCell(1, 1).style.fill).toMatchObject({ pattern: "solid", fgColor: { argb: "FFFFEE00" } });
  setFontColor(ws, range, null);
  setFillColor(ws, range, null);
  expect(ws.getCell(1, 1).style.font?.color).toBeUndefined();
  expect(ws.getCell(1, 1).style.font?.bold).toBeUndefined();
  expect(ws.getCell(1, 1).style.fill).toMatchObject({ pattern: "none" });
});

test("mergeRange：合并前先解除相交旧合并；单格跳过；unmergeRange 解除相交合并", () => {
  const ws = sheet();
  mergeRange(ws, { top: 0, left: 0, bottom: 0, right: 0 }); // 1×1 不动
  expect((ws as never as { model: { merges: string[] } }).model.merges ?? []).toEqual([]);
  mergeRange(ws, { top: 0, left: 0, bottom: 1, right: 1 }); // A1:B2
  mergeRange(ws, { top: 1, left: 1, bottom: 2, right: 2 }); // B2:C3 与旧合并相交
  const merges = (ws as never as { model: { merges: string[] } }).model.merges;
  expect(merges).toEqual(["B2:C3"]); // 旧合并被解除而不是抛错
  unmergeRange(ws, { top: 2, left: 2, bottom: 2, right: 2 }); // C3 在 B2:C3 内
  expect((ws as never as { model: { merges: string[] } }).model.merges ?? []).toEqual([]);
});

test("保真回路：值与样式编辑经 writeBuffer 序列化后重读仍在", async () => {
  const wb = new Workbook();
  const ws = wb.addWorksheet("S") as unknown as WorksheetEditSource;
  setCellValue(ws, 0, 0, "标题");
  setCellValue(ws, 1, 0, "3.5");
  toggleFontFlag(ws, { top: 0, left: 0, bottom: 0, right: 0 }, "bold", { row: 0, column: 0 });
  setFontColor(ws, { top: 0, left: 0, bottom: 0, right: 0 }, "#cc0000");
  setFillColor(ws, { top: 0, left: 0, bottom: 0, right: 0 }, "#00ff00");
  mergeRange(ws, { top: 2, left: 0, bottom: 3, right: 1 });

  const bytes = await (wb as unknown as { xlsx: { writeBuffer(): Promise<ArrayBuffer> } }).xlsx.writeBuffer();
  const reopened = new Workbook();
  await reopened.xlsx.load(bytes as never);
  const rs = reopened.getWorksheet("S")!;
  expect(rs.getCell("A1").text).toBe("标题");
  expect(rs.getCell("A2").value).toBe(3.5);
  expect(rs.getCell("A1").style.font?.bold).toBe(true);
  expect(rs.getCell("A1").style.font?.color?.argb).toBe("FFCC0000");
  expect(rs.getCell("A1").style.fill).toMatchObject({ pattern: "solid", fgColor: { argb: "FF00FF00" } });
  expect(rs.model.merges).toEqual(["A3:B4"]);
});
