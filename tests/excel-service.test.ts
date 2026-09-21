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

test("excel: 解析失败映射为稳定的用户文案", async () => {
  const files = {
    readBinary: async () => new TextEncoder().encode("not a zip archive"),
    writeBinary: vi.fn(),
  };
  const excel = new ExcelService(files);
  const error = await excel.read("/lib/corrupt.xlsx").catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(
    "Excel 文件损坏或不是有效的 .xlsx 文件，请确认来源文件，或另存为 .xlsx 后重试。",
  );
  expect((error as Error).message).not.toMatch(/jszip|https?:\/\//i);
});

test("excel: write 产出可被 ExcelJS 解析回读的工作簿", async () => {
  const source = new Workbook();
  const ws = source.addWorksheet("Data");
  ws.getCell("A1").value = "保留值";
  ws.getCell("A1").style.font = { bold: true };
  ws.getCell("A1").style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFABCDEF" } };
  ws.mergeCells("A2:B3");
  ws.getCell("A4").value = { formula: "1+2", result: 3 };
  const files = {
    readBinary: vi.fn(),
    writeBinary: vi.fn(async (_path: string, written: Uint8Array) => { captured = written; }),
  };
  let captured = new Uint8Array();
  const excel = new ExcelService(files);
  await excel.write("/lib/data.xlsx", source);

  const copy = new ArrayBuffer(captured.byteLength);
  new Uint8Array(copy).set(captured);
  const parsed = await new Workbook().xlsx.load(copy as Parameters<Workbook["xlsx"]["load"]>[0]);
  expect(parsed.getWorksheet("Data")).toBeDefined();
  expect(parsed.getWorksheet("Data")?.getCell("A1").value).toBe("保留值");
  expect(parsed.getWorksheet("Data")?.getCell("A1").style.font?.bold).toBe(true);
  expect(parsed.getWorksheet("Data")?.getCell("A1").style.fill?.fgColor?.argb).toBe("FFABCDEF");
  expect(parsed.getWorksheet("Data")?.model.merges).toEqual(["A2:B3"]);
  expect(parsed.getWorksheet("Data")?.getCell("A4").formula).toBe("1+2");
  expect(parsed.getWorksheet("Data")?.getCell("A4").result).toBe(3);
});
