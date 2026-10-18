import type { Context } from "cordis";
import { createWikiService } from "./service";

/** Plugin id in the manifest and the static module table. */
export const name = "app-wiki";
/** Service keys awaited before apply runs. */
export const inject = ["agent", "files", "workspace"];

/** Publish the wiki knowledge layer as `ctx.wiki`; register the prompt section.
 * @param ctx Host context with the three injected services.
 * @returns Disposer used by cordis lifecycle teardown.
 */
export function apply(ctx: Context): () => void {
  const wiki = createWikiService({ files: ctx.files, workspace: ctx.workspace });
  ctx.reflect.provide("wiki", wiki);
  const unregister = ctx.agent.registerPromptSection(
    "wiki",
    (input) => wiki.contextSection(input),
  );
  const offRoot = ctx.workspace.events.on("root-changed", () => wiki.invalidate());
  const offFile = ctx.workspace.events.on("file-opened", () => wiki.invalidate());
  return () => {
    offRoot();
    offFile();
    unregister();
  };
}
