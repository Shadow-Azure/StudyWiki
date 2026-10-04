import type { Context } from "cordis";
import { createAgentService } from "./service";

/** Plugin id in the manifest and the static module table. */
export const name = "agent-core";
/** Service keys awaited before apply runs. */
export const inject = ["llm", "files", "workspace"];

/** Publish persistent agent sessions as `ctx.agent`; cleanup aborts every session.
 * @param ctx Host context with the three injected facades.
 * @returns Disposer used by cordis lifecycle teardown.
 */
export function apply(ctx: Context): () => void {
  const agent = createAgentService({
    llm: ctx.llm,
    files: ctx.files,
    workspace: ctx.workspace,
  });
  ctx.reflect.provide("agent", agent);
  return () => agent.dispose();
}
