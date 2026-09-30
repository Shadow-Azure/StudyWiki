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
  bar.setAttribute("role", "alert");
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
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
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

/** Show an in-app discard confirmation and resolve the user's choice.
 * Used for close guarding: Tauri's native confirm is not presented while a
 * CloseRequested handler is pending on macOS, so this stays inside the webview.
 * @param file Name of the dirty document shown in the prompt.
 * @param action Verb used on the confirm button ("关闭" / "切换").
 * @returns True to discard and proceed, false to cancel. */
export function confirmDiscardDialog(file: string, action = "关闭"): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "viewer-confirm";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", `放弃未保存的修改并${action}`);
    const card = document.createElement("div");
    card.className = "viewer-confirm-card";
    const title = document.createElement("h2");
    title.textContent = `放弃对 ${file} 的未保存修改并${action}？`;
    const hint = document.createElement("p");
    hint.textContent = "确认后未保存的修改将丢失。";
    const actions = document.createElement("div");
    actions.className = "viewer-confirm-actions";
    const done = (value: boolean): void => {
      overlay.remove();
      resolve(value);
    };
    const cancelBtn = labelButton("close", "取消", { className: "btn btn-ghost" });
    cancelBtn.addEventListener("click", () => done(false));
    const discardBtn = labelButton("trash", `放弃并${action}`, { className: "btn btn-danger" });
    discardBtn.addEventListener("click", () => done(true));
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        done(false);
      }
    };
    overlay.addEventListener("keydown", onKeyDown);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) done(false);
    });
    actions.append(cancelBtn, discardBtn);
    card.append(title, hint, actions);
    overlay.append(card);
    document.body.append(overlay);
    discardBtn.focus();
  });
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
