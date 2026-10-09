import type { Context } from "cordis";
import { labelButton } from "../../ui/dom";

/** Plugin id in the manifest and the static module table. */
export const name = "app-windows";
/** Service keys awaited before apply runs. */
export const inject = ["files", "windows", "workspace", "slots"];

/** Activity Rail entries: new window (carrying the current root) and open-folder.
 * "新建窗口" forwards the workspace root (null → welcome state in the new
 * window); "打开文件夹…" re-picks and switches only this window's root.
 * @param ctx Host context (files/windows/workspace/slots injected).
 * @returns Teardown removing both Activity Rail buttons. */
export function apply(ctx: Context): () => void {
  return ctx.slots.register("activity.left", (el) => {
    const openBtn = labelButton("folder-open", "", { className: "btn btn-ghost icon-btn activity-item", ariaLabel: "打开文件夹…" });
    openBtn.title = "打开文件夹…";
    openBtn.addEventListener("click", async () => {
      const root = await ctx.files.pickFolder();
      // 换根单路：授权+登记成功才切前端工作区（顺序不变式住宿主服务）。
      if (root) await ctx.windows.changeRoot(root);
    });
    const newBtn = labelButton("window", "", { className: "btn btn-ghost icon-btn activity-item", ariaLabel: "新建窗口" });
    newBtn.title = "新建窗口";
    newBtn.addEventListener("click", () => void ctx.windows.create(ctx.workspace.root ?? undefined));
    el.append(openBtn, newBtn);
  });
}
