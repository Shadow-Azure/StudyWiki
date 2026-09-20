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
