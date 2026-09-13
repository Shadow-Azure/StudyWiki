import type { Context } from "cordis";
import type { FileNode } from "../../types";
import { icon } from "../../ui/icons";
import { labelButton } from "../../ui/dom";
import { filterTree, visibleRows, type TreeConfig } from "./tree";

/** Plugin id in the manifest and the static module table. */
export const name = "view-filetree";
/** Service keys awaited before apply runs. */
export const inject = ["files", "workspace", "slots"];

/** Root display name for the tree head (last path segment on either separator; falls back to the raw path). */
const rootLabel = (root: string): string => root.split(/[\\/]/).filter(Boolean).pop() ?? root;

/** Sidebar file tree: head row with the root name and manual refresh, expand/collapse
 * directories, click to open documents; the active file row is highlighted
 * (aria-current) and re-rendered on file-opened.
 * @param ctx Host context (files/workspace/slots injected).
 * @param config Tree config (dotfile filtering).
 * @returns Teardown removing the root-changed / fs-changed / file-opened subscriptions and the slot renderer. */
export function apply(ctx: Context, config: TreeConfig): () => void {
  let nodes: FileNode[] = [];
  const expanded = new Set<string>();
  let host: HTMLElement | null = null;

  const render = (): void => {
    if (!host) return;
    host.replaceChildren();
    const root = ctx.workspace.root;
    if (!root) {
      const empty = document.createElement("p");
      empty.className = "tree-empty";
      empty.textContent = "未打开文件夹";
      host.append(empty);
      return;
    }
    const head = document.createElement("div");
    head.className = "tree-head";
    const title = document.createElement("span");
    title.className = "tree-title";
    title.textContent = rootLabel(root);
    const refresh = labelButton("refresh", "", { className: "tree-refresh btn btn-ghost icon-btn", ariaLabel: "刷新" });
    refresh.title = "刷新";
    refresh.addEventListener("click", () => void reload());
    head.append(title, refresh);
    host.append(head);
    const list = document.createElement("nav");
    list.className = "tree";
    list.setAttribute("aria-label", "文件树");
    const activePath = ctx.workspace.activeFile?.path;
    for (const { node, depth } of visibleRows(filterTree(nodes, config), expanded)) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `tree-row tree-${node.kind === "dir" ? "dir" : "file"} kind-${node.kind}`;
      row.style.paddingLeft = `${6 + depth * 14}px`;
      if (node.kind === "dir") {
        row.setAttribute("aria-expanded", String(expanded.has(node.path)));
        const chevron = document.createElement("span");
        chevron.className = "tree-chevron";
        chevron.append(icon("chevron-right", 15));
        row.append(chevron);
      } else {
        const kind = document.createElement("span");
        kind.className = "tree-kind";
        kind.append(icon(node.kind === "video" ? "play" : "doc", 15));
        row.append(kind);
      }
      const name = document.createElement("span");
      name.className = "row-name";
      name.textContent = node.name;
      row.append(name);
      if (node.kind !== "dir" && node.path === activePath) {
        row.classList.add("tree-row-active");
        row.setAttribute("aria-current", "true");
      }
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
  const offFile = ctx.workspace.events.on("file-opened", () => render());
  const offSlot = ctx.slots.register("sidebar.tree", (el) => {
    host = el;
    render();
    void reload();
  });
  return () => { offRoot(); offFs(); offFile(); offSlot(); };
}
