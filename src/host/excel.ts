import { Workbook } from "exceljs";

/** Files seams needed by the Excel service; tests inject memory fakes. */
export interface ExcelFiles {
  readBinary(path: string): Promise<Uint8Array>;
  writeBinary(path: string, bytes: Uint8Array): Promise<void>;
}

/** Injectable parser seam; production uses ExcelJS, tests inject a prepared workbook. */
export interface ExcelDeps {
  parseWorkbook?: (bytes: Uint8Array) => Promise<Workbook>;
}

/** Upper bound on rowCount × columnCount across all worksheets. */
export const MAX_EXCEL_CELLS = 1_000_000;

/** Parse raw xlsx bytes into an ExcelJS workbook. */
export async function parseWorkbook(bytes: Uint8Array): Promise<Workbook> {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const workbook = new Workbook();
  await workbook.xlsx.load(copy as Parameters<Workbook["xlsx"]["load"]>[0]);
  return workbook;
}

/** Spreadsheet host service: the human/AI-shared xlsx data-model boundary. */
export class ExcelService {
  readonly #files: ExcelFiles;
  readonly #parse: (bytes: Uint8Array) => Promise<Workbook>;

  constructor(files: ExcelFiles, deps: ExcelDeps = {}) {
    this.#files = files;
    this.#parse = deps.parseWorkbook ?? parseWorkbook;
  }

  /** Read and parse an xlsx workbook; rejects corrupt or over-cap files. */
  async read(path: string): Promise<Workbook> {
    let workbook: Workbook;
    try {
      workbook = await this.#parse(await this.#files.readBinary(path));
    } catch (error) {
      if (error instanceof Error && error.message.includes("过大")) throw error;
      throw new Error(`读取 Excel 失败：${(error as Error).message}`);
    }
    const cells = workbook.worksheets.reduce(
      (sum, ws) => sum + Math.max(1, ws.rowCount) * Math.max(1, ws.columnCount),
      0,
    );
    if (cells > MAX_EXCEL_CELLS)
      throw new Error(`Excel 过大：${cells} 个单元格超过上限 ${MAX_EXCEL_CELLS}`);
    return workbook;
  }

  /** Serialize a workbook and atomically write it through the files service. */
  async write(path: string, workbook: Workbook): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    } catch (error) {
      throw new Error(`序列化 Excel 失败：${(error as Error).message}`);
    }
    await this.#files.writeBinary(path, bytes);
  }
}
