import type { Context } from "cordis";

/** Plugin id in the manifest and the static module table. */
export const name = "app-windows";
/** Service keys awaited before apply runs. */
export const inject = ["files", "windows", "workspace", "slots"];

/** Topbar entries: new window (carrying the current root) and open-folder.
 * "新建窗口" forwards the workspace root (null → welcome state in the new
 * window); "打开文件夹…" re-picks and switches only this window's root.
 * @param ctx Host context (files/windows/workspace/slots injected).
 * @returns Teardown removing both topbar buttons. */
export function apply(ctx: Context): () => void {
  return ctx.slots.register("topbar.left", (el) => {
    const newBtn = document.createElement("button");
    newBtn.type = "button";
    newBtn.textContent = "新建窗口";
    newBtn.addEventListener("click", () => void ctx.windows.create(ctx.workspace.root ?? undefined));
    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = "打开文件夹…";
    openBtn.addEventListener("click", async () => {
      const root = await ctx.files.pickFolder();
      if (root) {
        // 先 Rust 侧登记注册表 + 授权 asset（刷新后 root 不丢），再切前端工作区。
        await ctx.windows.setRoot(ctx.windows.currentLabel(), root);
        ctx.workspace.setRoot(root);
      }
    });
    el.append(newBtn, openBtn);
  });
}
