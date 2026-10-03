/** Media source accepted by the chat wire contract; mirrors `host/llm.ts`. */
export type MediaSource =
  | { kind: "path"; path: string }
  | { kind: "inline"; data: string; mimeType: string }
  | { kind: "url"; url: string };

/** A media item staged in the composer before a chat request is sent. */
export interface PendingAttachment {
  /** Content part sent verbatim to `ctx.llm.chatStream`. */
  part: { type: "image" | "audio"; source: MediaSource };
  /** Short chip label shown to the user. */
  label: string;
}

/** 单附件解码字节上限：与 Rust llm.rs `MAX_ATTACHMENT_BYTES` 同值同语义（硬上限 + 明确报错，
 * 不做压缩/归一化——OpenAI 兼容图片 base64 上限 20 MB）。 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Outcome of converting one pasted/dropped file: an accepted attachment, or a
 * user-facing rejection (unsupported type / over the size hard cap). */
export type AttachmentResult =
  | { ok: true; attachment: PendingAttachment }
  | { ok: false; reason: "unsupported" | "oversized"; message: string };

/** Convert a pasted or dropped image/audio File to an inline attachment.
 * Text and unsupported MIME types are rejected; files over MAX_ATTACHMENT_BYTES
 * are rejected before their bytes are read (hard cap + clear error, no compression).
 * @param file Browser file supplied by clipboard or drag-and-drop.
 * @returns Accepted attachment with base64 data, or a rejection with a user-facing message. */
export async function fileToAttachment(file: File): Promise<AttachmentResult> {
  const isImage = file.type.startsWith("image/");
  const isAudio = ["audio/mpeg", "audio/wav", "audio/x-wav"].includes(file.type);
  const name = file.name || (isImage ? "粘贴的图片" : "粘贴的音频");
  if (!isImage && !isAudio) {
    return { ok: false, reason: "unsupported", message: `不支持的附件类型：${name}` };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      reason: "oversized",
      message: `附件超过大小上限 20 MB：${name}（请压缩或分段后再试）`,
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    ok: true,
    attachment: {
      part: {
        type: isImage ? "image" : "audio",
        source: { kind: "inline", data: btoa(binary), mimeType: file.type },
      },
      label: name,
    },
  };
}
