import type {
  AgentMessage,
  AgentToolCall,
  ApprovalMode,
  SessionHeader,
  SessionLine,
  TokenUsage,
} from "./types";

/** Agent 消息、批准与 JSONL 事件的共享类型契约。 */
export type {
  AgentMessage,
  AgentToolCall,
  ApprovalMode,
  SessionHeader,
  SessionLine,
  TokenUsage,
} from "./types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: UnknownRecord, key: string): boolean {
  return typeof value[key] === "string";
}

function optionalString(value: UnknownRecord, key: string): boolean {
  return value[key] === undefined || typeof value[key] === "string";
}

function optionalBoolean(value: UnknownRecord, key: string): boolean {
  return value[key] === undefined || typeof value[key] === "boolean";
}

function isToolCall(value: unknown): value is AgentToolCall {
  return (
    isRecord(value) &&
    requiredString(value, "id") &&
    requiredString(value, "name") &&
    requiredString(value, "argumentsText")
  );
}

function isUsage(value: unknown): value is TokenUsage {
  return (
    isRecord(value) &&
    typeof value.promptTokens === "number" &&
    typeof value.completionTokens === "number"
  );
}

function isMessage(value: unknown): value is AgentMessage {
  if (!isRecord(value)) return false;
  if (value.role === "user") {
    return typeof value.content === "string" || Array.isArray(value.content);
  }
  if (value.role === "assistant") {
    return (
      requiredString(value, "reasoning") &&
      requiredString(value, "text") &&
      Array.isArray(value.toolCalls) &&
      value.toolCalls.every(isToolCall) &&
      (value.usage === undefined || isUsage(value.usage)) &&
      optionalString(value, "finishReason")
    );
  }
  if (value.role === "tool") {
    return (
      requiredString(value, "callId") &&
      requiredString(value, "name") &&
      requiredString(value, "content") &&
      optionalBoolean(value, "isError")
    );
  }
  return false;
}

function isApprovalMode(value: unknown): value is ApprovalMode {
  return value === "ask" || value === "auto";
}

function isHeader(value: unknown): value is SessionHeader {
  return (
    isRecord(value) &&
    value.v === 1 &&
    requiredString(value, "id") &&
    requiredString(value, "rootPath") &&
    requiredString(value, "title") &&
    requiredString(value, "createdAt")
  );
}

function isSessionLine(value: unknown): value is SessionLine {
  if (!isRecord(value)) return false;
  if (value.type === "header") return isHeader(value.header);
  if (value.type === "message") return isMessage(value.message);
  if (value.type === "approval") {
    return (
      requiredString(value, "id") &&
      requiredString(value, "tool") &&
      requiredString(value, "path") &&
      (value.decider === "human" || value.decider === "guardian") &&
      (value.decision === "allow" || value.decision === "deny" || value.decision === "unavailable") &&
      optionalString(value, "reason")
    );
  }
  if (value.type === "mode") return isApprovalMode(value.mode);
  if (value.type === "compaction") {
    return (
      requiredString(value, "summary") &&
      typeof value.covered === "number" &&
      requiredString(value, "createdAt")
    );
  }
  return false;
}

/** Encode one SessionLine as a compact JSONL record.
 * @param line Complete log event to serialize.
 * @returns Single-line JSON text with no trailing newline. */
export function encodeLine(line: SessionLine): string {
  return JSON.stringify(line);
}

/**
 * Parse the append-only JSONL log. Blank lines are ignored, the first record
 * must be a complete v1 header, and every newline-terminated record must have
 * a complete shape. An unterminated final record is treated as a crash tail
 * and dropped without mutating the input.
 * @param text Full JSONL session text.
 * @returns Header, complete pre-header-following records including the header, and tail state.
 * @throws When the log is empty, its first record is missing or invalid, a header repeats later, or any newline-terminated record is invalid.
 */
export function parseSession(text: string): {
  header: SessionHeader;
  lines: SessionLine[];
  tailTruncated: boolean;
} {
  const chunks = text.split("\n");
  const tailTruncated = chunks[chunks.length - 1] !== "";
  const completeChunks = tailTruncated ? chunks.slice(0, -1) : chunks;
  const lines: SessionLine[] = [];
  let header: SessionHeader | undefined;

  for (const chunk of completeChunks) {
    if (chunk === "") continue;

    let value: unknown;
    try {
      value = JSON.parse(chunk);
    } catch {
      throw new Error("会话日志包含无效 JSON 行");
    }
    if (!isSessionLine(value)) {
      throw new Error("会话日志包含不完整或未知类型的行");
    }
    if (!header) {
      if (value.type !== "header") throw new Error("会话日志缺少 v1 header");
      header = value.header;
    } else if (value.type === "header") {
      throw new Error("header 必须是会话首行");
    }
    lines.push(value);
  }

  if (!header) throw new Error("会话日志缺少 v1 header");
  return { header, lines, tailTruncated };
}

/**
 * Build the model-facing message view without changing the log. Each
 * compaction replaces the covered prefix of the current view with one summary
 * user message; later compactions continue composing on that view.
 * @param lines Full ordered session lines.
 * @returns A new array containing the effective messages.
 */
export function effectiveMessages(lines: SessionLine[]): AgentMessage[] {
  let view: AgentMessage[] = [];
  for (const line of lines) {
    if (line.type === "message") {
      view.push(line.message);
      continue;
    }
    if (line.type === "compaction") {
      const covered = Math.max(0, line.covered);
      const summary: AgentMessage = {
        role: "user",
        content: `[早期对话摘要]\n${line.summary}`,
      };
      view = [summary, ...view.slice(covered)];
    }
  }
  return view;
}

/**
 * Derive a single-line display title from user input, limiting it to 50
 * Unicode characters without trimming.
 * @param firstUserText Raw first user text.
 * @returns The first line, at most 50 characters.
 */
export function sessionTitle(firstUserText: string): string {
  const firstLine = firstUserText.split("\n", 1)[0] ?? "";
  return Array.from(firstLine).slice(0, 50).join("");
}
