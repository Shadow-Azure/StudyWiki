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

/** Convert a pasted or dropped image/audio File to an inline attachment.
 * Text and unsupported MIME types are rejected by returning null.
 * @param file Browser file supplied by clipboard or drag-and-drop.
 * @returns Attachment with base64 data, or null when the file is not supported media. */
export async function fileToAttachment(file: File): Promise<PendingAttachment | null> {
  const isImage = file.type.startsWith("image/");
  const isAudio = ["audio/mpeg", "audio/wav", "audio/x-wav"].includes(file.type);
  if (!isImage && !isAudio) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    part: {
      type: isImage ? "image" : "audio",
      source: { kind: "inline", data: btoa(binary), mimeType: file.type },
    },
    label: file.name || (isImage ? "粘贴的图片" : "粘贴的音频"),
  };
}
