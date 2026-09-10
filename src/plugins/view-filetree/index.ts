import type { Context } from "cordis";
import type { FileNode } from "../../types";
import { filterTree, visibleRows, type TreeConfig } from "./tree";

/** Plugin id in the manifest and the static module table. */
export const name = "view-filetree";
/** Service keys awaited before apply runs. */
export const inject = ["files", "workspace", "slots"];

/** Sidebar file tree: expand/collapse directories, click to open documents.
 * @param ctx Host context (files/workspace/slots injected).
 * @param config Tree config (dotfile filtering).
 * @returns Teardown removing the root-changed / fs-changed subscriptions and the slot renderer. */
export function apply(ctx: Context, config: TreeConfig): () => void {
  let nodes: FileNode[] = [];
  const expanded = new Set<string>();
  let host: HTMLElement | null = null;

  const render = (): void => {
    if (!host) return;
    host.replaceChildren();
    if (!ctx.workspace.root) {
      const empty = document.createElement("p");
      empty.className = "tree-empty";
      empty.textContent = "未打开文件夹";
      host.append(empty);
      return;
    }
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "tree-refresh";
    refresh.textContent = "刷新";
    refresh.addEventListener("click", () => void reload());
    host.append(refresh);
    const list = document.createElement("nav");
    list.className = "tree";
    list.setAttribute("aria-label", "文件树");
    for (const { node, depth } of visibleRows(filterTree(nodes, config), expanded)) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `tree-row tree-${node.kind === "dir" ? "dir" : "file"} kind-${node.kind}`;
      row.style.paddingLeft = `${4 + depth * 14}px`;
      row.textContent = (node.kind === "dir" ? (expanded.has(node.path) ? "▾ " : "▸ ") : "") + node.name;
      row.addEventListener("click", () => {
        if (node.kind === "dir") {
          if (expanded.has(node.path)) expanded.delete(node.path);
          else expanded.add(node.path);
          render();
        } else if (node.kind === "markdown" || node.kind === "video") {
          ctx.workspace.openFile(node);
        }
      });
      list.append(row);
    }
    host.append(list);
  };

  const reload = async (): Promise<void> => {
    const root = ctx.workspace.root;
    if (!root) return;
    nodes = await ctx.files.readTree(root);
    render();
  };

  const offRoot = ctx.workspace.events.on("root-changed", () => {
    expanded.clear();
    nodes = [];
    void reload();
  });
  const offFs = ctx.files.onFsChanged((path) => {
    if (ctx.workspace.root && (path === ctx.workspace.root || path.startsWith(ctx.workspace.root))) void reload();
  });
  const offSlot = ctx.slots.register("sidebar.tree", (el) => {
    host = el;
    render();
    void reload();
  });
  return () => { offRoot(); offFs(); offSlot(); };
}
