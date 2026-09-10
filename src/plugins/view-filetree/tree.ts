import type { FileNode } from "../../types";

/** Config for the file tree plugin. */
export interface TreeConfig {
  /** Hide dotfiles and dot-directories when true. */
  ignoreDotfiles: boolean;
}

/** Drop dotfiles/dot-directories recursively when configured.
 * @param nodes Tree to filter (never mutated).
 * @param config Only `ignoreDotfiles` is consulted here.
 * @returns Filtered copy; the input itself when the flag is off. */
export function filterTree(nodes: FileNode[], config: TreeConfig): FileNode[] {
  if (!config.ignoreDotfiles) return nodes;
  return nodes
    .filter((n) => !n.name.startsWith("."))
    .map((n) => (n.children ? { ...n, children: filterTree(n.children, config) } : n));
}

/** Flatten to visible rows (depth-first, only inside expanded directories).
 * @param nodes (Already filtered) tree to lay out.
 * @param expanded Paths of directories currently expanded.
 * @returns Rows in display order, each carrying its nesting depth. */
export function visibleRows(nodes: FileNode[], expanded: ReadonlySet<string>): Array<{ node: FileNode; depth: number }> {
  const out: Array<{ node: FileNode; depth: number }> = [];
  const walk = (list: FileNode[], depth: number): void => {
    for (const node of list) {
      out.push({ node, depth });
      if (node.children && expanded.has(node.path)) walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return out;
}
