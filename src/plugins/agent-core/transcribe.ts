import type { AsrTarget, ToolDeclaration, TranscriptionResult } from "../../host/llm";

/** 转录执行挂点：由宿主装配（探测大小 + 调 LlmService.transcribe）。 */
export interface TranscribeHook {
  /** 探测文件字节数（审批卡展示用）。 */
  probeSize(path: string): Promise<number>;
  /** 解析要上传的 endpoint、模型与协议（本地路由，不发生上传）。 */
  pick(model?: string): Promise<AsrTarget>;
  /** 用审批卡展示过的 target 执行转录；路由与传输错误原样抛出。 */
  run(req: { path: string; language?: string; target: AsrTarget }): Promise<TranscriptionResult>;
}

/** transcribe 工具的上游声明。 */
export const TRANSCRIBE_DECLARATION: ToolDeclaration = {
  name: "transcribe",
  description: "把库根内音视频文件上传到用户配置的 ASR endpoint 转录，产出带时间戳的 transcript.md；需用户批准。",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "库根内音视频文件的绝对路径" },
      language: { type: "string", description: "语种 ISO 码（如 zh/en），缺省自动检测" },
      model: { type: "string", description: "ASR 模型 id；多个 ASR endpoint 时必传" },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

/** 允许转录的扩展名（宽松预检；chat 路的 wav/mp3 限制由 Rust 侧硬门禁）。 */
export const MEDIA_EXTENSIONS = new Set(["mp4", "mkv", "mov", "webm", "mp3", "wav", "m4a", "flac", "ogg"]);

/**
 * 秒 → HH:MM:SS（floor 到整数秒，与 wiki 时间戳区间格式同源）。
 * @param seconds 秒数；负数按 0 处理。
 * @returns 两位补零的 HH:MM:SS。
 */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * 解析 chat 路文本的 `[HH:MM:SS] 文本` 行；不含匹配行时返回空数组。
 * @param text 模型返回的纯文本。
 * @returns 按出现顺序的起始秒与正文；不匹配行被忽略。
 */
export function parseTimestampedLines(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\[(\d{1,3}):(\d{2}):(\d{2})\]\s+(.+)$/u);
    if (!match) continue;
    const [, h, m, s, body] = match;
    out.push({ start: Number(h) * 3600 + Number(m) * 60 + Number(s), text: body!.trim() });
  }
  return out;
}

/**
 * 产物落点：.study-wiki/raw/<源库相对路径去扩展名>/transcript.md。
 * @param root 已授权库根的绝对路径。
 * @param sourcePath 库根内源媒体绝对路径。
 * @returns transcript.md 的绝对路径。
 */
export function transcriptOutputPath(root: string, sourcePath: string): string {
  const rel = sourcePath.startsWith(`${root}/`) ? sourcePath.slice(root.length + 1) : sourcePath;
  const noExt = rel.replace(/\.[^./\\]+$/u, "");
  return `${root}/.study-wiki/raw/${noExt}/transcript.md`;
}

/** 格式化输入。 */
export interface TranscriptInput {
  /** 源文件库相对路径。 */
  sourceRel: string;
  /** 源文件名（标题用）。 */
  fileName: string;
  /** 执行模型 id。 */
  model: string;
  /** 语种参数或 auto。 */
  language: string;
  /** 生成时刻 ISO 字符串。 */
  generatedAt: string;
  /** 转录原始结果。 */
  result: TranscriptionResult;
}

/**
 * 确定性格式化 transcript.md：segments 优先；纯文本按 ≥3 行且覆盖 ≥80% 规则解析；否则降级单段。
 * @param input 源元数据与转录结果。
 * @returns 带 frontmatter 的 Markdown 全文。
 */
export function formatTranscript(input: TranscriptInput): string {
  let segments = input.result.segments;
  let timestampMode = "segment";
  if (segments.length === 0) {
    const parsed = parseTimestampedLines(input.result.text);
    const covered = parsed.reduce((sum, p) => sum + p.text.length, 0);
    if (parsed.length >= 3 && covered >= input.result.text.length * 0.8) {
      segments = parsed.map((p, i) => ({ start: p.start, end: parsed[i + 1]?.start ?? p.start, text: p.text }));
    } else {
      timestampMode = "none";
    }
  }
  const header = [
    "---",
    `source: ${input.sourceRel}`,
    `model: ${input.model}`,
    `language: ${input.language}`,
    `generated: ${input.generatedAt}`,
    `timestamps: ${timestampMode}`,
    "---",
    "",
    `# 转录：${input.fileName}`,
    "",
  ].join("\n");
  if (timestampMode === "none") return `${header}${input.result.text.trim()}\n`;
  const lines = segments.map((seg) => `[${formatTimestamp(seg.start)}] ${seg.text.trim()}`);
  return `${header}${lines.join("\n")}\n`;
}
