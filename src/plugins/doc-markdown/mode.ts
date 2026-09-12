/** Document display mode. */
export type DocMode = "preview" | "edit";

/** Document state; the editor's own text is mirrored into `text` via onChange. */
export interface DocState {
  /** What the viewer is showing right now. */
  mode: DocMode;
  /** Content as of the last successful save — the clean baseline. */
  savedText: string;
  /** Live content; the editor mirrors its own text here via onChange. */
  text: string;
}

/** Open a document: preview mode, clean.
 * @param text Content loaded from disk; doubles as the clean baseline.
 * @returns Fresh state in preview mode, not dirty. */
export function openDoc(text: string): DocState {
  return { mode: "preview", savedText: text, text };
}

/** Record an edit (editor onChange).
 * @param s Previous document state.
 * @param text New editor text.
 * @returns State with `text` updated; dirtiness is recomputed against `savedText`. */
export function editText(s: DocState, text: string): DocState {
  return { ...s, text };
}

/** Record a successful save.
 * @param s Previous document state.
 * @returns State whose clean baseline is the current text. */
export function markSaved(s: DocState): DocState {
  return { ...s, savedText: s.text };
}

/** Toggle the display mode.
 * @param mode Current display mode.
 * @returns The other mode (preview ↔ edit). */
export function toggleMode(mode: DocMode): DocMode {
  return mode === "preview" ? "edit" : "preview";
}

/** Dirty when text differs from the last saved text.
 * @param s Current document state.
 * @returns True while `text` differs from `savedText`. */
export function isDirty(s: DocState): boolean {
  return s.text !== s.savedText;
}
