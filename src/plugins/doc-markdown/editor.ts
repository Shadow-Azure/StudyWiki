import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { minimalSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/** Handle over a live editor instance. */
export interface EditorHandle {
  /** Mounted editor element (inside the parent given to the factory). */
  dom: HTMLElement;
  /** Full document text right now. */
  getText(): string;
  /** Tear down the editor and release its DOM. */
  destroy(): void;
}

/** Editor factory seam: the real one wraps CodeMirror; tests inject a stub. */
export type EditorFactory = (
  parent: HTMLElement,
  initial: string,
  onChange: (text: string) => void,
  onSave: () => void,
) => EditorHandle;

const documentEditorTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--ink)" },
  ".cm-scroller": {
    overflowX: "hidden",
    fontFamily: "var(--font-read)",
    fontSize: "17px",
    lineHeight: "1.9",
  },
  ".cm-content": { padding: "0 0 120px", caretColor: "var(--azurite)" },
  ".cm-line": { padding: "0" },
  ".cm-activeLine": { backgroundColor: "transparent" },
}, { dark: false });

const documentHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "var(--ink)", fontWeight: "650" },
  { tag: tags.heading1, fontSize: "1.28em", lineHeight: "1.55em" },
  { tag: tags.heading2, fontSize: "1.16em", lineHeight: "1.62em" },
  { tag: tags.heading3, fontSize: "1.06em" },
  { tag: tags.heading4, fontSize: "1.06em" },
  { tag: tags.heading5, fontSize: "1.06em" },
  { tag: tags.heading6, fontSize: "1.06em" },
  { tag: tags.strong, fontWeight: "650" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "var(--azurite)" },
  { tag: tags.url, color: "var(--ink-3)" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)", fontSize: "0.82em" },
  { tag: tags.processingInstruction, color: "var(--ink-3)" },
  { tag: tags.meta, color: "var(--ink-3)" },
]);

/** Create the CodeMirror 6 editor (the only CodeMirror import site in this plugin).
 * @param parent Element the editor mounts into.
 * @param initial Document text at mount time.
 * @param onChange Called with the full text on every document change.
 * @param onSave Called for Mod-s (Ctrl/Cmd+S); the keymap swallows the event.
 * @returns Handle over the live view: mounted dom, current text, teardown. */
export function createCodeMirror(
  parent: HTMLElement,
  initial: string,
  onChange: (text: string) => void,
  onSave: () => void,
): EditorHandle {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initial,
      extensions: [
        minimalSetup,
        markdown(),
        EditorView.lineWrapping,
        documentEditorTheme,
        syntaxHighlighting(documentHighlightStyle),
        Prec.highest(keymap.of([{ key: "Mod-s", run: () => { onSave(); return true; } }])),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
      ],
    }),
  });
  return {
    dom: view.dom,
    getText: () => view.state.doc.toString(),
    destroy: () => view.destroy(),
  };
}
