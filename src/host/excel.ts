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

/** User-facing message for any workbook that reaches ExcelJS but cannot be parsed. */
const INVALID_EXCEL_MESSAGE =
  "Excel 文件损坏或不是有效的 .xlsx 文件，请确认来源文件，或另存为 .xlsx 后重试。";

/** Parse raw xlsx bytes into an ExcelJS workbook.
 * @param bytes Raw `.xlsx` bytes from the binary files service.
 * @returns The parsed ExcelJS workbook. */
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

  /** Read and parse an xlsx workbook; rejects corrupt files and workbooks whose
   * declared dimensions (rowCount × columnCount per sheet) exceed the cell cap. */
  async read(path: string): Promise<Workbook> {
    let bytes: Uint8Array;
    try {
      bytes = await this.#files.readBinary(path);
    } catch (error) {
      throw new Error(`读取 Excel 失败：${(error as Error).message}`);
    }
    let workbook: Workbook;
    try {
      workbook = await this.#parse(bytes);
    } catch (error) {
      // Reserved passthrough: a future streaming parser may reject oversize workbooks before a
      // full parse; its "过大" error must surface as-is instead of being swallowed by the
      // corrupt-file message below. Production parseWorkbook never throws that prefix today —
      // the cap check below runs after parsing (contract noted at the throw site).
      if (error instanceof Error && error.message.includes("过大")) throw error;
      throw new Error(INVALID_EXCEL_MESSAGE);
    }
    const cells = workbook.worksheets.reduce(
      (sum, ws) => sum + Math.max(1, ws.rowCount) * Math.max(1, ws.columnCount),
      0,
    );
    // The "过大" prefix is a contract: the parse-seam catch above passes it through untouched.
    // If this message ever changes wording, update that branch in the same commit.
    if (cells > MAX_EXCEL_CELLS)
      throw new Error(`Excel 过大：按声明维度累计 ${cells} 个单元格，超过上限 ${MAX_EXCEL_CELLS}`);
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
