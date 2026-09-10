import type { Context } from "cordis";
import type { FileNode } from "../../types";
import { renderMarkdown } from "./preview";
import { editText, isDirty, markSaved, openDoc, toggleMode, type DocState } from "./mode";
import { createCodeMirror, type EditorFactory, type EditorHandle } from "./editor";

/** Plugin id in the manifest and the static module table. */
export const name = "doc-markdown";
/** Service keys awaited before apply runs (windows added with the close guard). */
export const inject = ["files", "windows", "workspace", "slots"];

/** Markdown document: preview and edit of the active file, manual Ctrl+S save.
 * @param ctx Host context (files/windows/workspace/slots injected).
 * @param _config Unused; the plugin takes no options.
 * @param editorFactory Editor seam, defaulting to the real CodeMirror factory; tests inject a stub.
 * @returns Teardown removing the file-opened subscription, the slot renderer, the close guard and any live editor. */
export function apply(
  ctx: Context,
  _config: Record<string, never>,
  editorFactory: EditorFactory = createCodeMirror,
): () => void {
  let host: HTMLElement | null = null;
  let current: FileNode | null = null;
  let state: DocState = openDoc("");
  let editor: EditorHandle | null = null;
  let offGuard: (() => void) | null = null;

  const save = async (): Promise<void> => {
    if (!current || !isDirty(state)) return;
    await ctx.files.writeText(current.path, state.text);
    state = markSaved(state);
    paintChrome();
  };

  const paintChrome = (): void => {
    const dirty = current?.kind === "markdown" && isDirty(state);
    host?.querySelector(".save-btn")?.classList.toggle("dirty", dirty);
    document.title = dirty && current ? `● ${current.name}` : current?.name ?? "StudyWiki";
  };

  const render = (): void => {
    if (!host) return;
    host.replaceChildren();
    editor?.destroy();
    editor = null;
    if (!current || current.kind !== "markdown") {
      paintChrome();
      return;
    }
    const bar = document.createElement("div");
    bar.className = "viewer-toolbar";
    const modeBtn = document.createElement("button");
    modeBtn.type = "button";
    modeBtn.textContent = state.mode === "preview" ? "编辑" : "预览";
    modeBtn.addEventListener("click", () => {
      state = { ...state, mode: toggleMode(state.mode) };
      render();
    });
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "save-btn";
    saveBtn.textContent = "保存 (Ctrl+S)";
    saveBtn.addEventListener("click", () => void save());
    bar.append(modeBtn, saveBtn);
    const body = document.createElement("div");
    body.className = "doc-body";
    if (state.mode === "preview") {
      const pv = document.createElement("div");
      pv.className = "markdown-body";
      pv.innerHTML = renderMarkdown(state.text);
      body.append(pv);
    } else {
      editor = editorFactory(body, state.text, (text) => {
        state = editText(state, text);
        paintChrome();
      }, () => void save());
    }
    host.append(bar, body);
    paintChrome();
  };

  const open = async (file: FileNode | null): Promise<void> => {
    current = file;
    if (file?.kind === "markdown") state = openDoc(await ctx.files.readText(file.path));
    render();
  };

  void ctx.windows.guardClose(
    () => current?.kind === "markdown" && isDirty(state),
    () => ctx.windows.confirmDialog(`放弃对 ${current?.name} 的未保存修改并关闭？`),
  ).then((off) => { offGuard = off; });

  const offFile = ctx.workspace.events.on("file-opened", (f) => void open(f));
  const offSlot = ctx.slots.register("main.viewer", (el) => {
    host = el;
    render();
    void open(ctx.workspace.activeFile);
  });
  return () => { offFile(); offSlot(); offGuard?.(); editor?.destroy(); };
}
