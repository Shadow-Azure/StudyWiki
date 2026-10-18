/** 机器索引 `.study-wiki/index.yaml` 的受限 yaml 子集解析/序列化。
 * 格式是 LF-only：解析器不归一化 CRLF，遇到 CR 按损坏输入拒绝。
 */

/** 源类型：文本或视频。 */
export type SourceKind = "text" | "video";

/** 一条源记录：源 → 产物映射 + 内容哈希 + 分析时间。 */
export interface SourceRecord {
  /** 库相对路径。 */
  path: string;
  /** 源类型：文本或视频（决定 ingest 路径）。 */
  kind: SourceKind;
  /** 源内容 SHA-256（小写 hex）。 */
  sha256: string;
  /** 文件大小（字节）。 */
  size: number;
  /** 最近一次分析完成时间（ISO）。 */
  analyzedAt: string;
  /** 产物目录（库相对路径）；文本源为 null（产物即源本身）。 */
  artifact: string | null;
}

/** 机器索引顶层结构。 */
export interface MachineIndex {
  version: 1;
  sources: SourceRecord[];
}

const FIELDS = [
  "path",
  "kind",
  "sha256",
  "size",
  "analyzedAt",
  "artifact",
] as const;
type Field = (typeof FIELDS)[number];
const ITEM_RE = /^  - ([a-zA-Z0-9]+): (.*)$/;
const CONT_RE = /^    ([a-zA-Z0-9]+): (.*)$/;
const INVALID_VALUE = Symbol("invalid value");
type ParsedValue = string | number | null | typeof INVALID_VALUE;

function unquote(raw: string): string | null {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return null;
  const inner = raw.slice(1, -1);
  let result = "";
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char === '"') return null;
    if (char !== "\\") {
      result += char;
      continue;
    }
    const escaped = inner[index + 1];
    if (escaped !== "\\" && escaped !== '"') return null;
    result += escaped;
    index += 1;
  }
  return result;
}

function parseValue(
  field: Field,
  raw: string,
): ParsedValue {
  if (field === "artifact" && raw === "null") return null;
  if (field === "size") {
    if (!/^\d+$/.test(raw)) return INVALID_VALUE;
    const size = Number(raw);
    return Number.isSafeInteger(size) ? size : INVALID_VALUE;
  }
  if (field === "kind") {
    return raw === "text" || raw === "video" ? raw : INVALID_VALUE;
  }
  const value = unquote(raw);
  return value === null ? INVALID_VALUE : value;
}

/** 解析机器索引；任何偏离受限 yaml 子集的输入都返回 null。
 * @param text 机器索引文件文本。
 * @returns 解析结果；输入损坏时返回 null。
 */
export function parseMachineIndex(text: string): MachineIndex | null {
  if (text.includes("\r")) return null;
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length === 0) return null;
  if (lines[0] !== "version: 1") return null;
  const rest = lines.slice(1);
  if (rest.length === 0) return null;
  if (rest[0] === "sources: []") {
    return rest.length === 1 ? { version: 1, sources: [] } : null;
  }
  if (rest[0] !== "sources:") return null;

  const sources: SourceRecord[] = [];
  let current: Partial<Record<Field, string | number | null>> | null = null;
  const seen = new Set<Field>();
  const flush = (): boolean => {
    if (current === null) return true;
    if (seen.size !== FIELDS.length) return false;
    sources.push(current as SourceRecord);
    return true;
  };

  for (const line of rest.slice(1)) {
    let match: RegExpMatchArray | null;
    const item = line.match(ITEM_RE);
    if (item) {
      if (!flush()) return null;
      current = {};
      seen.clear();
      match = item;
    } else {
      match = line.match(CONT_RE);
      if (match === null || current === null) return null;
    }
    const key = match[1] as Field;
    if (!(FIELDS as readonly string[]).includes(key) || seen.has(key)) {
      return null;
    }
    const value = parseValue(key, match[2]);
    if (value === INVALID_VALUE) return null;
    seen.add(key);
    current[key] = value;
  }
  if (!flush()) return null;
  return { version: 1, sources };
}

/** 序列化机器索引；输出可被 `parseMachineIndex` 恒等还原。
 * @param index 机器索引。
 * @returns 受限 yaml 子集文本。
 */
export function serializeMachineIndex(index: MachineIndex): string {
  if (index === null || index.version !== 1 || !Array.isArray(index.sources)) {
    throw new Error("machine index must contain version 1 and a sources array");
  }
  for (const source of index.sources) {
    if (
      source === null ||
      (source.kind !== "text" && source.kind !== "video") ||
      !Number.isSafeInteger(source.size) ||
      source.size < 0 ||
      typeof source.path !== "string" ||
      typeof source.sha256 !== "string" ||
      typeof source.analyzedAt !== "string" ||
      (source.artifact !== null && typeof source.artifact !== "string")
    ) {
      throw new Error("machine index contains an unrepresentable source");
    }
    for (const value of [
      source.path,
      source.sha256,
      source.analyzedAt,
      source.artifact,
    ]) {
      if (value !== null && /[\n\r\u2028\u2029]/u.test(value)) {
        throw new Error("machine index strings must not contain line breaks");
      }
    }
  }
  const quote = (value: string) =>
    `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const lines = [`version: ${index.version}`, "sources:"];
  for (const source of index.sources) {
    lines.push(`  - path: ${quote(source.path)}`);
    lines.push(`    kind: ${source.kind}`);
    lines.push(`    sha256: ${quote(source.sha256)}`);
    lines.push(`    size: ${source.size}`);
    lines.push(`    analyzedAt: ${quote(source.analyzedAt)}`);
    lines.push(
      `    artifact: ${source.artifact === null ? "null" : quote(source.artifact)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
