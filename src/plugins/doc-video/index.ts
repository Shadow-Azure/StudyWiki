import type { Context } from "cordis";
import { errorBanner, loadingHint, paintTitle } from "../../ui/viewer";

/** Plugin id in the manifest and the static module table. */
export const name = "doc-video";
/** Service keys awaited before apply runs. */
export const inject = ["files", "workspace", "slots"];

/** Ignore shortcut events originating from controls that own those keys. */
function ownsKeyTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && target.closest("input, textarea, select, button, [contenteditable=true], .cm-content, [role=\"separator\"]") !== null;
}

/** Video viewer for the active file: `<video controls>` fed by the asset
 * protocol when the active file's kind is video; clears its slot otherwise.
 * @param ctx Host context (files/workspace/slots injected).
 * @returns Teardown removing the file-opened subscription, slot renderer and video shortcuts. */
export function apply(ctx: Context): () => void {
  let host: HTMLElement | null = null;
  let offShortcuts: (() => void) | null = null;
  let renderGeneration = 0;

  const render = (): void => {
    renderGeneration += 1;
    const generation = renderGeneration;
    offShortcuts?.();
    offShortcuts = null;
    if (!host) return;
    host.replaceChildren();
    const file = ctx.workspace.activeFile;
    host.hidden = file?.kind !== "video";
    if (file?.kind !== "video") return;
    paintTitle(file);
    const stage = document.createElement("div");
    stage.className = "video-stage";
    const loading = loadingHint();
    const video = document.createElement("video");
    video.controls = true;
    video.tabIndex = 0;
    video.setAttribute("aria-keyshortcuts", "Space ArrowLeft ArrowRight");
    video.src = ctx.files.assetUrl(file.path);
    video.addEventListener("canplay", () => {
      if (generation === renderGeneration) loading.remove();
    });
    video.addEventListener("error", () => {
      if (generation !== renderGeneration || !video.isConnected) return;
      loading.remove();
      errorBanner(host!, "视频加载失败", () => {});
    });
    stage.append(video, loading);
    host.append(stage);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || ctx.workspace.activeFile?.kind !== "video" || ownsKeyTarget(event.target)) return;
      if (event.key === " ") {
        event.preventDefault();
        void (video.paused ? video.play() : video.pause());
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        video.currentTime += event.key === "ArrowRight" ? 5 : -5;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    offShortcuts = () => window.removeEventListener("keydown", onKeyDown);
  };

  const offFile = ctx.workspace.events.on("file-opened", () => render());
  const offSlot = ctx.slots.register("main.viewer", (el) => {
    host = el;
    render();
  });
  return () => {
    offShortcuts?.();
    offFile();
    offSlot();
  };
}
