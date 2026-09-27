import type { Context } from "cordis";
import type { FileNode } from "../../types";
import { labelButton } from "../../ui/dom";
import { bindSaveShortcut, errorBanner, loadingHint, paintTitle } from "../../ui/viewer";
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
  let offSwitchGuard: (() => void) | null = null;
  let offSave: (() => void) | null = null;
  let error: string | null = null;
  let loading = false;

  const save = async (): Promise<void> => {
    if (!current || !isDirty(state)) return;
    try {
      await ctx.files.writeText(current.path, state.text);
    } catch (e) {
      error = `保存失败：${(e as Error).message}`;
      if (host) errorBanner(host, error, () => { error = null; });
      return;
    }
    host?.querySelector(".doc-error")?.remove();
    error = null;
    state = markSaved(state);
    paintChrome();
  };

  const paintChrome = (): void => {
    const dirty = current?.kind === "markdown" && isDirty(state);
    host?.querySelector(".save-btn")?.classList.toggle("dirty", dirty);
    if (current?.kind === "markdown") paintTitle(current, dirty);
  };

  const render = (): void => {
    if (!host) return;
    host.replaceChildren();
    editor?.destroy();
    editor = null;
    if (error) errorBanner(host, error, () => { error = null; });
    if (!current || current.kind !== "markdown") {
      host.hidden = true;
      paintChrome();
      return;
    }
    host.hidden = false;
    if (loading) {
      host.append(loadingHint());
      paintChrome();
      return;
    }
    const bar = document.createElement("div");
    bar.className = "viewer-toolbar";
    const modeGroup = document.createElement("div");
    modeGroup.className = "mode-group";
    modeGroup.setAttribute("role", "group");
    modeGroup.setAttribute("aria-label", "文档模式");
    const previewBtn = labelButton("eye", "预览", { className: "btn btn-ghost mode-btn" });
    previewBtn.setAttribute("aria-pressed", String(state.mode === "preview"));
    previewBtn.addEventListener("click", () => {
      if (state.mode === "preview") return;
      state = { ...state, mode: "preview" };
      render();
    });
    const editBtn = labelButton("pencil", "编辑", { className: "btn btn-ghost mode-btn" });
    editBtn.setAttribute("aria-pressed", String(state.mode === "edit"));
    editBtn.addEventListener("click", () => {
      if (state.mode === "edit") return;
      state = { ...state, mode: toggleMode(state.mode) };
      render();
    });
    modeGroup.append(previewBtn, editBtn);
    const saveBtn = labelButton("save", "保存", { className: "btn btn-ghost save-btn" });
    saveBtn.setAttribute("aria-keyshortcuts", "Control+S Meta+S");
    saveBtn.addEventListener("click", () => void save());
    bar.append(modeGroup, saveBtn);
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
    if (file?.kind === "markdown") {
      current = file;
      state = openDoc("");
      error = null;
      loading = true;
      render();
      let text: string;
      try {
        text = await ctx.files.readText(file.path);
      } catch (e) {
        loading = false;
        state = openDoc(""); // 清空正文：读失败不得停留在上一个文档的内容上
        error = `读取失败：${(e as Error).message}`;
        render();
        return;
      }
      loading = false;
      state = openDoc(text);
      error = null;
      render();
      return;
    }
    current = file;
    error = null;
    loading = false;
    render();
  };

  const ownsActiveMarkdown = (): boolean =>
    ctx.workspace.activeFile?.kind === "markdown" && current?.kind === "markdown";

  void ctx.windows.guardClose(
    () => ownsActiveMarkdown() && isDirty(state),
    () => ctx.windows.confirmDialog(`放弃对 ${current?.name} 的未保存修改并关闭？`),
  ).then((off) => { offGuard = off; });
  offSwitchGuard = ctx.workspace.guardSwitch(
    () => ownsActiveMarkdown() && isDirty(state),
    () => ctx.windows.confirmDialog(`放弃对 ${current?.name} 的未保存修改并切换？`),
  );
  offSave = bindSaveShortcut(() => ctx.workspace.activeFile?.kind === "markdown", () => void save());

  const offFile = ctx.workspace.events.on("file-opened", (f) => void open(f));
  const offSlot = ctx.slots.register("main.viewer", (el) => {
    host = el;
    render();
    void open(ctx.workspace.activeFile);
  });
  return () => { offFile(); offSlot(); offGuard?.(); offSwitchGuard?.(); offSave?.(); editor?.destroy(); };
}
