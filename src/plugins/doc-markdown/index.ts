import type { Context } from "cordis";
import type { FileNode } from "../../types";
import { renderMarkdown } from "./preview";

/** Plugin id in the manifest and the static module table. */
export const name = "doc-markdown";
/** Service keys awaited before apply runs. */
export const inject = ["files", "workspace", "slots"];

/** Markdown document viewer: preview of the active file.
 * @param ctx Host context (files/workspace/slots injected).
 * @returns Teardown removing the file-opened subscription and the slot renderer. */
export function apply(ctx: Context): () => void {
  let host: HTMLElement | null = null;
  let current: FileNode | null = null;

  const render = (): void => {
    if (!host) return;
    host.replaceChildren();
    if (!current || current.kind !== "markdown") return;
    const body = document.createElement("div");
    body.className = "markdown-body";
    void ctx.files.readText(current.path).then((text) => {
      body.innerHTML = renderMarkdown(text);
    });
    host.append(body);
  };

  const offFile = ctx.workspace.events.on("file-opened", (f) => {
    current = f;
    render();
  });
  const offSlot = ctx.slots.register("main.viewer", (el) => {
    host = el;
    current = ctx.workspace.activeFile;
    render();
  });
  return () => { offFile(); offSlot(); };
}
