import type { GrepRequest, GrepResult } from "../../host/files";
import type { ToolDeclaration } from "../../host/llm";
import type { AgentToolCall } from "./types";

/** Host-side file operations and dynamic read authorization used by agent tools. */
export interface AgentHost {
  /** Read one already-authorized text file as a whole string. */
  readText(path: string): Promise<string>;
  /** Run the native agent grep over an already-authorized path. */
  grep(req: GrepRequest): Promise<GrepResult>;
  /** Write one root-confined text file atomically through the host. */
  writeText(path: string, content: string): Promise<void>;
  /** Add a path or directory to the window/session read grant set. */
  authorizeRead(path: string): Promise<void>;
}

/** Approval-card payload; write/edit decisions occur before any disk mutation. */
export interface ApprovalRequest {
  /** Stable request id, normally the model tool-call id. */
  id: string;
  /** Approval family used to route and render the card. */
  kind: "write" | "edit" | "read-outside";
  /** Originating tool name. */
  tool: string;
  /** Absolute target path. */
  path: string;
  /** Short human-readable action summary. */
  summary: string;
  /** Edit comparison source, attached only by the edit tool. */
  oldText?: string;
  /** Edit replacement text, attached only by the edit tool. */
  newText?: string;
}

/** Human approval result; `grant` applies only to read-outside requests. */
export interface ApprovalOutcome {
  /** Allow approves the requested read grant or pending write/edit. */
  decision: "allow" | "deny";
  /** Human explanation returned to the model on denial. */
  reason?: string;
  /** Whether an allowed outside read grants its file or parent directory. */
  grant?: "file" | "dir";
}

/** Pure execution inputs for one model tool call. */
export interface ToolRunContext {
  /** Workspace root; it is the default grep root and the only write boundary. */
  root: string;
  /** Injectable host file facade. */
  host: AgentHost;
  /** Approval gate; tool execution awaits one decision before acting. */
  ask: (req: ApprovalRequest) => Promise<ApprovalOutcome>;
}

/** One completed tool result serialized back to the model. */
export interface ToolResult {
  /** Plain-text tool result or failure explanation. */
  content: string;
  /** Present only when the tool call failed and the model should adapt. */
  isError?: boolean;
}

/** Upstream declarations for the four built-in agent file tools. */
export const TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: "read",
    description: "读取已授权的 UTF-8 文本文件；返回带行号前缀的分页内容，适合源码和 Markdown。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "要读取的绝对文件路径" },
        offset: { type: "integer", minimum: 1, description: "起始行号，从 1 开始" },
        limit: { type: "integer", minimum: 0, description: "返回行数，默认 2000" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "grep",
    description: "在库根或指定已授权路径中搜索文本；适合笔记级规模，可按 glob 过滤并附带上下文。",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "正则表达式；literal=true 时按原文查找" },
        path: { type: "string", description: "搜索目标，缺省为当前库根" },
        glob: { type: "string", description: "文件名 glob 过滤，例如 *.md" },
        ignoreCase: { type: "boolean", description: "忽略大小写" },
        literal: { type: "boolean", description: "按固定字符串而非正则查找" },
        context: { type: "integer", minimum: 0, description: "每个命中前后附带的行数" },
        limit: { type: "integer", minimum: 1, description: "命中上限，缺省由原生侧限制" },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "write",
    description: "新建或整体覆盖库根内的 UTF-8 文本文件；必须先获得用户批准。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "要写入的库根内绝对文件路径" },
        content: { type: "string", description: "完整文件内容；将按原样写入" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "edit",
    description: "用字符串替换语义修改库根内文本文件；默认要求 old_string 唯一，可显式替换全部。",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "要编辑的库根内绝对文件路径" },
        old_string: { type: "string", minLength: 1, description: "要查找的原文" },
        new_string: { type: "string", description: "替换后的文本，可为空串" },
        replace_all: { type: "boolean", description: "替换所有匹配；缺省时只允许唯一匹配" },
      },
      required: ["path", "old_string", "new_string"],
      additionalProperties: false,
    },
  },
];

const UNAUTHORIZED_PREFIX = "UNAUTHORIZED_PATH|";
const MAX_READ_LINES = 2000;
const MAX_READ_BYTES = 200 * 1024;
const READ_TRUNCATION_NOTICE = "\n\n...（输出超过 200 KB，已截断）";
const BINARY_EXTENSIONS = new Set([
  "xlsx", "xls", "pdf", "zip", "gz", "tar", "7z", "rar",
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svgz",
  "mp4", "m4v", "mov", "avi", "mkv", "webm",
  "mp3", "wav", "ogg", "flac", "aac",
  "woff", "woff2", "ttf", "otf", "eot",
  "bin", "exe", "dll", "so", "dylib",
]);

/** Recognize the stable Rust authorization rejection marker across Error and coded rejects. */
/** @param e Rejected value to inspect. @returns True when the rejection carries the stable prefix. */
export function isUnauthorized(e: unknown): boolean {
  return errorMessage(e).startsWith(UNAUTHORIZED_PREFIX);
}

/** Execute one registered file tool; argument and runtime failures become tool results. */
/** @param call Model-supplied tool invocation. @param ctx Execution context and approval gate. @returns Model-readable result, with `isError` marking a failure. */
export async function executeTool(call: AgentToolCall, ctx: ToolRunContext): Promise<ToolResult> {
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(call.argumentsText);
    if (!isRecord(parsed)) throw new TypeError("参数必须是 JSON 对象");
    args = parsed;
  } catch (e) {
    return { content: `参数不是合法 JSON：${errorMessage(e)}`, isError: true };
  }

  try {
    switch (call.name) {
      case "read":
        return await executeRead(call.id, args, ctx);
      case "grep":
        return await executeGrep(call, args, ctx);
      case "write":
        return await executeWrite(call, args, ctx);
      case "edit":
        return await executeEdit(call, args, ctx);
      default:
        return { content: `未知工具：${call.name}`, isError: true };
    }
  } catch (e) {
    return { content: `工具执行失败：${errorMessage(e)}`, isError: true };
  }
}

async function executeRead(id: string, args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
  const path = requiredString(args, "path");
  if (typeof path !== "string") return path;
  const offset = optionalPositiveInteger(args, "offset");
  if (offset.invalid) return { content: "offset 必须是从 1 起的整数。", isError: true };
  const limit = optionalNonNegativeInteger(args, "limit");
  if (limit.invalid) return { content: "limit 必须是非负整数。", isError: true };
  if (isBinaryPath(path)) return { content: "read 不支持二进制、Excel 或视频文件；请改用专用查看器或提供文本格式。", isError: true };

  const read = await readWithUpgrade(ctx, path, id, "read", () => ctx.host.readText(path));
  if (!read.ok) return read.result;
  return formatReadContent(read.value, offset.value ?? 1, limit.value ?? MAX_READ_LINES);
}

async function executeGrep(call: AgentToolCall, args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
  const pattern = requiredString(args, "pattern");
  if (typeof pattern !== "string") return pattern;
  const path = optionalString(args, "path") ?? ctx.root;
  const context = optionalNonNegativeInteger(args, "context");
  if (context.invalid) return { content: "context 必须是非负整数。", isError: true };
  const limit = optionalPositiveInteger(args, "limit", true);
  if (limit.invalid) return { content: "limit 必须是正整数。", isError: true };

  const request: GrepRequest = { pattern, path };
  const glob = optionalString(args, "glob");
  if (glob !== undefined) request.glob = glob;
  const ignoreCase = optionalBoolean(args, "ignoreCase");
  if (ignoreCase !== undefined) request.ignoreCase = ignoreCase;
  const literal = optionalBoolean(args, "literal");
  if (literal !== undefined) request.literal = literal;
  if (context.value !== undefined) request.context = context.value;
  if (limit.value !== undefined) request.limit = limit.value;

  const search = await readWithUpgrade(ctx, path, call.id, "grep", () => ctx.host.grep(request));
  if (!search.ok) return search.result;
  return formatGrepResult(search.value);
}

async function executeWrite(call: AgentToolCall, args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
  const path = requiredString(args, "path");
  if (typeof path !== "string") return path;
  const content = requiredString(args, "content");
  if (typeof content !== "string") return content;
  if (!isWithinRoot(path, ctx.root)) return { content: "write 拒绝：目标路径不在库根内；写入永远不会越界。", isError: true };
  const approval = await askApproval(ctx, {
    id: call.id,
    kind: "write",
    tool: "write",
    path,
    summary: `写入 ${content.length} 字符`,
  });
  if (!approval.ok) return approval.result;
  if (approval.value.decision === "deny") return denialResult(approval.value, "用户拒绝写入");

  await ctx.host.writeText(path, content);
  return { content: `已写入 ${path}` };
}

async function executeEdit(call: AgentToolCall, args: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult> {
  const path = requiredString(args, "path");
  if (typeof path !== "string") return path;
  const oldString = requiredString(args, "old_string");
  if (typeof oldString !== "string") return oldString;
  const newString = requiredString(args, "new_string");
  if (typeof newString !== "string") return newString;
  const replaceAll = optionalBoolean(args, "replace_all");
  if (oldString === "") return { content: "old_string 不能是空字符串。", isError: true };
  if (!isWithinRoot(path, ctx.root)) return { content: "edit 拒绝：目标路径不在库根内；写入永远不会越界。", isError: true };

  const approval = await askApproval(ctx, {
    id: call.id,
    kind: "edit",
    tool: "edit",
    path,
    summary: "文本替换",
    oldText: oldString,
    newText: newString,
  });
  if (!approval.ok) return approval.result;
  if (approval.value.decision === "deny") return denialResult(approval.value, "用户拒绝编辑");

  const current = await ctx.host.readText(path);
  const count = countOccurrences(current, oldString);
  if (count === 0) return { content: `未找到 old_string：${oldString}`, isError: true };
  if (count > 1 && replaceAll !== true) {
    return { content: `old_string 匹配 ${count} 处；未设置 replace_all 时必须唯一。`, isError: true };
  }
  const next = replaceAll === true
    ? current.split(oldString).join(newString)
    : current.slice(0, current.indexOf(oldString)) + newString +
      current.slice(current.indexOf(oldString) + oldString.length);

  await ctx.host.writeText(path, next);
  return { content: `已编辑 ${path}（替换 ${count} 处）` };
}

async function readWithUpgrade<T>(
  ctx: ToolRunContext,
  path: string,
  id: string,
  tool: "read" | "grep",
  operation: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; result: ToolResult }> {
  try {
    return { ok: true, value: await operation() };
  } catch (e) {
    if (!isUnauthorized(e)) return { ok: false, result: readFailureResult(e, tool) };

    const approval = await askApproval(ctx, {
      id,
      kind: "read-outside",
      tool,
      path,
      summary: "读取库根外的路径",
    });
    if (!approval.ok) return approval;
    if (approval.value.decision === "deny") {
      return { ok: false, result: denialResult(approval.value, "用户拒绝读取库根外路径") };
    }

    try {
      await ctx.host.authorizeRead(approval.value.grant === "dir" ? dirname(path) : path);
    } catch (authorizeError) {
      return { ok: false, result: { content: `读取授权失败：${errorMessage(authorizeError)}`, isError: true } };
    }

    try {
      return { ok: true, value: await operation() };
    } catch (retryError) {
      return { ok: false, result: readFailureResult(retryError, tool) };
    }
  }
}

async function askApproval(
  ctx: ToolRunContext,
  request: ApprovalRequest,
): Promise<{ ok: true; value: ApprovalOutcome } | { ok: false; result: ToolResult }> {
  try {
    return { ok: true, value: await ctx.ask(request) };
  } catch (e) {
    return { ok: false, result: { content: `审批请求失败：${errorMessage(e)}`, isError: true } };
  }
}

function readFailureResult(e: unknown, tool: "read" | "grep"): ToolResult {
  const code = tool === "grep" ? searchErrorCode(e) : null;
  return code
    ? { content: `grep 失败（${code}）：${errorMessage(e)}`, isError: true }
    : { content: `读取失败：${errorMessage(e)}`, isError: true };
}

function formatReadContent(text: string, offset: number, limit: number): ToolResult {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const selected = lines.slice(offset - 1, offset - 1 + limit);
  const encoder = new TextEncoder();
  const noticeBytes = encoder.encode(READ_TRUNCATION_NOTICE).length;
  let content = "";
  let contentBytes = 0;
  let truncated = false;

  for (const [index, line] of selected.entries()) {
    const prefixed = `${offset + index}: ${line}`;
    const prefixedBytes = encoder.encode(prefixed).length;
    if (contentBytes + prefixedBytes > MAX_READ_BYTES - noticeBytes) {
      truncated = true;
      break;
    }
    content += content ? `\n${prefixed}` : prefixed;
    contentBytes += prefixedBytes + (content === prefixed ? 0 : 1);
  }
  if (truncated) content += READ_TRUNCATION_NOTICE;
  return { content };
}

function formatGrepResult(result: GrepResult): ToolResult {
  const sections = result.matches.map((match) => {
    const before = match.before.map((line) => `- ${line}`);
    const after = match.after.map((line) => `- ${line}`);
    return [`- ${match.path}:${match.line}: ${match.text}`, ...before, ...after].join("\n");
  });
  if (result.truncated) sections.push("已截断");
  return { content: sections.length === 0 ? "未找到匹配" : sections.join("\n") };
}

function requiredString(args: Record<string, unknown>, key: string): string | ToolResult {
  const value = args[key];
  if (typeof value !== "string") return { content: `${key} 必须是字符串。`, isError: true };
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function optionalInteger(
  args: Record<string, unknown>,
  key: string,
  minimum: number,
  allowZero = false,
): { value?: number; invalid: boolean } {
  const value = args[key];
  if (value === undefined) return { invalid: false };
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum ||
      (value === 0 && !allowZero)) {
    return { invalid: true };
  }
  return { value, invalid: false };
}

function optionalPositiveInteger(
  args: Record<string, unknown>,
  key: string,
  allowZero = false,
): { value?: number; invalid: boolean } {
  return optionalInteger(args, key, allowZero ? 0 : 1, allowZero);
}

function optionalNonNegativeInteger(args: Record<string, unknown>, key: string): { value?: number; invalid: boolean } {
  return optionalInteger(args, key, 0, true);
}

function denialResult(outcome: ApprovalOutcome, fallback: string): ToolResult {
  return { content: outcome.reason || fallback, isError: true };
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let cursor = 0;
  while (cursor <= text.length) {
    const index = text.indexOf(needle, cursor);
    if (index < 0) break;
    count += 1;
    cursor = index + needle.length;
  }
  return count;
}

function isWithinRoot(path: string, root: string): boolean {
  const normalizedRoot = root.replace(/[\\/]+$/, "");
  if (normalizedRoot === "") return false;
  return path.startsWith(`${normalizedRoot}/`) || path.startsWith(`${normalizedRoot}\\`);
}

function isBinaryPath(path: string): boolean {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return path.includes(".") && BINARY_EXTENSIONS.has(extension);
}

function dirname(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (index < 0) return ".";
  if (index === 0) return path.slice(0, 1);
  return path.slice(0, index);
}

function searchErrorCode(e: unknown): string | null {
  if (!isRecord(e)) return null;
  const code = e.code;
  return typeof code === "string" && code.startsWith("SEARCH_") ? code : null;
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (isRecord(e) && typeof e.message === "string") return e.message;
  return typeof e === "string" ? e : JSON.stringify(e);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
