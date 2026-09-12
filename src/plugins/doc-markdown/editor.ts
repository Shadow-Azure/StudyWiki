import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";

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
        basicSetup,
        markdown(),
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
