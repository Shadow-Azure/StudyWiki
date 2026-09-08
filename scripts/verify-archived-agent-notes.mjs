#!/usr/bin/env node
// Gate: 归档件冻结（蓝本 verify-archived-agent-notes 的移植）。
// .agents/notes/archived/ 是封存区：三件套整体冻结，每文件 sha256 记入
// archived/manifest.json（append-only：只增不改不删）。以下都红：文件字节与封存时
// 不符、清单条目被改/被删（与 git HEAD 对拍）、清单外文件混入、三件套不齐、
// 路径/格式非法。归档动作走 scripts/archive-agent-note.mjs（移动 + Status 改写 + 记 hash）。

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { CLASSES } from "./verify-agent-notes.mjs";

const ROOT = path.resolve("");
const ARCHIVED = path.join(ROOT, ".agents", "notes", "archived");
const MANIFEST_REL = ".agents/notes/archived/manifest.json";

/**
 * 解析 append-only 清单（只允许 entries 与 "//" 注释键）。
 * @param {string} content manifest.json 全文。
 * @returns {{entries: Record<string, string>}} path → sha256（64 位十六进制）。
 */
export function parseArchivedManifest(content) {
  const value = JSON.parse(content);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("顶层必须是对象");
  const unsupported = Object.keys(value).filter((key) => key !== "entries" && key !== "//");
  if (unsupported.length > 0)
    throw new Error(`不支持的字段 ${unsupported.join(", ")}`);
  const raw = value.entries;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw new Error("entries 必须是 path → sha256 对象");
  const entries = {};
  for (const [file, hash] of Object.entries(raw)) {
    if (!/^[0-9a-f]{64}$/.test(String(hash)))
      throw new Error(`${file} 的 hash 须为 64 位小写十六进制`);
    entries[file] = String(hash);
  }
  return { entries };
}

/**
 * 把归档文件清单按词干分组为三件套，同时做路径形状校验。
 * @param {string[]} files 仓库相对路径（已剔除 manifest.json）。
 * @returns {{triplets: {base:string,en:string,meta:string}[], errors:string[]}}
 */
export function groupTriplets(files) {
  const errors = [];
  const stems = new Map();
  const ARCHIVED_PREFIX = ".agents/notes/archived/";
  for (const relIn of files) {
    // 接受仓库相对路径或 archived/ 内相对路径，分段统一剥前缀；记账保留原样。
    const rel = relIn.startsWith(ARCHIVED_PREFIX) ? relIn.slice(ARCHIVED_PREFIX.length) : relIn;
    const segments = rel.split("/");
    if (segments.length !== 2) {
      errors.push(`${rel}: 路径须为 archived/{class}/yyyy-mm-dd-主题.*`);
      continue;
    }
    const [cls, name] = segments;
    if (!CLASSES.has(cls)) {
      errors.push(`${rel}: 非法 class "${cls}"`);
      continue;
    }
    let stem, kind;
    if (name.endsWith(".i18n.yaml")) {
      stem = name.slice(0, -".i18n.yaml".length);
      kind = "meta";
    } else if (name.endsWith(".en.md")) {
      stem = name.slice(0, -".en.md".length);
      kind = "en";
    } else if (name.endsWith(".md")) {
      stem = name.slice(0, -".md".length);
      kind = "base";
    } else {
      errors.push(`${rel}: 归档区只收三件套工件`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}-.+/.test(stem)) {
      errors.push(`${rel}: 文件名须为 yyyy-mm-dd-主题.*`);
      continue;
    }
    const key = `${cls}/${stem}`;
    const trio = stems.get(key) ?? {};
    trio[kind] = relIn;
    stems.set(key, trio);
  }
  const triplets = [];
  for (const [key, trio] of stems) {
    const missing = [!trio.base && "base", !trio.en && "en", !trio.meta && "meta"].filter(Boolean);
    if (missing.length) errors.push(`${key}: 三件套不齐（缺 ${missing.join("/")}）`);
    else triplets.push(trio);
  }
  return { triplets, errors };
}

async function collectFiles(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectFiles(full, out);
    else out.push(full);
  }
  return out;
}

/** HEAD 版清单（无 git 或尚未入库时返回 null，跳过对拍）。 */
function manifestFromHead() {
  try {
    const out = execFileSync("git", ["show", `HEAD:${MANIFEST_REL}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseArchivedManifest(out);
  } catch {
    return null;
  }
}

export default async function verifyArchivedAgentNotes() {
  if (!existsSync(ARCHIVED))
    return { ok: true, errors: [], summary: "verify-archived-agent-notes: 无归档件" };
  const files = (await collectFiles(ARCHIVED))
    .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
    .filter((rel) => rel !== MANIFEST_REL);
  if (files.length === 0)
    return { ok: true, errors: [], summary: "verify-archived-agent-notes: 无归档件" };

  const errors = [];
  if (!existsSync(path.join(ROOT, MANIFEST_REL)))
    return { ok: false, errors: ["archived/ 有文件但缺 manifest.json（用 pnpm archive:note 归档，勿手移）"] };

  let recorded;
  try {
    recorded = new Map(Object.entries(parseArchivedManifest(await readFile(path.join(ROOT, MANIFEST_REL), "utf8")).entries));
  } catch (error) {
    return { ok: false, errors: [`${MANIFEST_REL}: ${error.message}`] };
  }

  const { triplets, errors: shapeErrors } = groupTriplets(files);
  errors.push(...shapeErrors);

  // 前三行格式（base 侧；en 侧随 base 冻结，格式由封存时的活语料门禁背书）。
  for (const trio of triplets) {
    const lines = (await readFile(path.join(ROOT, trio.base), "utf8")).split("\n");
    if (!lines[0]?.startsWith("# Agent Note: "))
      errors.push(`${trio.base}: 第一行必须为 "# Agent Note: <标题>"`);
    if ((lines[2] ?? "") !== "Status: archived")
      errors.push(`${trio.base}: 第三行必须为 "Status: archived"`);
  }

  // sha256 冻结 + 双向对账。
  for (const rel of files) {
    const hash = createHash("sha256").update(await readFile(path.join(ROOT, rel))).digest("hex");
    if (!recorded.has(rel)) errors.push(`${rel}: 冻结清单缺条目（用 pnpm archive:note 归档）`);
    else if (recorded.get(rel) !== hash)
      errors.push(`${rel}: 冻结件被修改——字节与封存时不符（解封须 PR 显式说明）`);
  }
  for (const rel of recorded.keys())
    if (!files.includes(rel)) errors.push(`${rel}: 清单条目无对应文件（删除归档件须 PR 显式说明）`);

  // append-only：HEAD 里有的条目，当前必须原样存在。
  const head = manifestFromHead();
  if (head)
    for (const [rel, hash] of Object.entries(head.entries))
      if (recorded.get(rel) !== hash)
        errors.push(`${rel}: append-only 违例——条目被改或被删（清单只增不改不删）`);

  return {
    ok: errors.length === 0,
    errors,
    summary: `verify-archived-agent-notes: ${triplets.length} 件冻结（sha256 + append-only）`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await verifyArchivedAgentNotes();
  if (!result.ok) {
    console.error(`verify-archived-agent-notes: FAIL\n  ${result.errors.join("\n  ")}`);
    process.exit(1);
  }
  console.log(result.summary ?? "verify-archived-agent-notes: ok");
}
