import type { FileNode } from "../types";
import { icon } from "./icons";
import { labelButton } from "./dom";

/** Shared user-visible error banner for document viewers.
 * @param parent Viewer host whose old `.doc-error` (if any) should be replaced.
 * @param message User-facing error message.
 * @param onDismiss Called after the user activates the dismiss button.
 * @returns The mounted banner. */
export function errorBanner(parent: HTMLElement, message: string, onDismiss: () => void): HTMLElement {
  parent.querySelector(".doc-error")?.remove();
  const bar = document.createElement("div");
  bar.className = "doc-error";
  const msg = document.createElement("span");
  msg.textContent = message;
  const dismiss = labelButton("close", "", { className: "", ariaLabel: "关闭错误提示" });
  dismiss.addEventListener("click", () => {
    onDismiss();
    bar.remove();
  });
  bar.append(icon("alert", 15), msg, dismiss);
  parent.prepend(bar);
  return bar;
}

/** Shared viewer loading state.
 * @returns Element showing the standard “加载中…” hint. */
export function loadingHint(): HTMLElement {
  const el = document.createElement("div");
  el.className = "viewer-loading";
  el.textContent = "加载中…";
  return el;
}

/** Paint the window title from the active viewer state.
 * @param file Active file (null clears back to the application title).
 * @param dirty True when the active document has unsaved changes.
 * @param appTitle Application title used when no file is active. */
export function paintTitle(file: FileNode | null, dirty = false, appTitle = "StudyWiki"): void {
  document.title = file ? `${dirty ? "● " : ""}${file.name}` : appTitle;
}

/** Bind a window-level Mod-S shortcut for one viewer.
 * @param isActive Returns true only while the owning viewer is active.
 * @param save Runs the viewer save action.
 * @returns Disposer removing the shortcut listener. */
export function bindSaveShortcut(isActive: () => boolean, save: () => void): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target;
    // CodeMirror owns Mod-S inside `.cm-content`; its keymap already swallows that event.
    if (target instanceof HTMLElement && target.closest(".cm-content")) return;
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s" || !isActive()) return;
    event.preventDefault();
    save();
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
