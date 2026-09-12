import type { Context } from "cordis";

/** Plugin id in the manifest and the static module table. */
export const name = "doc-video";
/** Service keys awaited before apply runs. */
export const inject = ["files", "workspace", "slots"];

/** Video viewer for the active file: `<video controls>` fed by the asset
 * protocol when the active file's kind is video; clears its slot otherwise.
 * @param ctx Host context (files/workspace/slots injected).
 * @returns Teardown removing the file-opened subscription and the slot renderer. */
export function apply(ctx: Context): () => void {
  let host: HTMLElement | null = null;

  const render = (): void => {
    if (!host) return;
    host.replaceChildren();
    const file = ctx.workspace.activeFile;
    if (file?.kind !== "video") return;
    const video = document.createElement("video");
    video.controls = true;
    video.style.maxWidth = "100%";
    video.src = ctx.files.assetUrl(file.path);
    host.append(video);
  };

  const offFile = ctx.workspace.events.on("file-opened", () => render());
  const offSlot = ctx.slots.register("main.viewer", (el) => {
    host = el;
    render();
  });
  return () => { offFile(); offSlot(); };
}
