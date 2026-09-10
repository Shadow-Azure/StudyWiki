// @vitest-environment jsdom
import { expect, test } from "vitest";
import { filterTree, visibleRows } from "../src/plugins/view-filetree/tree";
import type { FileNode } from "../src/types";

const dir = (name: string, path: string, children: FileNode[]): FileNode => ({ name, path, kind: "dir", children });
const md = (name: string): FileNode => ({ name, path: `/x/${name}`, kind: "markdown" });

test("filterTree: 点文件按配置剔除（递归）", () => {
  const tree = [dir(".git", "/x/.git", [md("config")]), md("a.md"), dir("Sub", "/x/Sub", [md(".hidden")])];
  const out = filterTree(tree, { ignoreDotfiles: true });
  expect(out.map((n) => n.name)).toEqual(["a.md", "Sub"]);
  expect(out[1].children!.map((n) => n.name)).toEqual([]);
  expect(filterTree(tree, { ignoreDotfiles: false }).length).toBe(3);
});

test("visibleRows: 仅展开目录可见，携带深度", () => {
  const tree = [dir("S", "/x/S", [md("a.md"), md("b.md")]), md("c.md")];
  expect(visibleRows(tree, new Set()).map((r) => r.node.name)).toEqual(["S", "c.md"]);
  expect(visibleRows(tree, new Set(["/x/S"])).map((r) => `${"--".repeat(r.depth)}${r.node.name}`))
    .toEqual(["S", "--a.md", "--b.md", "c.md"]);
});

test("DOM: 点击文件触发 workspace.openFile；点目录切换展开", async () => {
  const { apply } = await import("../src/plugins/view-filetree");
  const opened: FileNode[] = [];
  const root = "/x";
  const files = {
    readTree: async () => [dir("S", "/x/S", [md("a.md")]), md("c.md")],
    onFsChanged: () => () => {},
  };
  const workspace = { root, events: { on: () => () => {} }, openFile: (f: FileNode) => opened.push(f) };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ files, workspace, slots } as never, { ignoreDotfiles: true });
  await new Promise((r) => setTimeout(r, 10));
  const dirBtn = document.querySelector<HTMLButtonElement>(".tree-dir")!;
  dirBtn.click(); // 展开
  await new Promise((r) => setTimeout(r, 0));
  const fileBtns = [...document.querySelectorAll<HTMLButtonElement>(".tree-file")];
  fileBtns.find((b) => b.textContent === "a.md")!.click();
  expect(opened.map((f) => f.name)).toEqual(["a.md"]);
});
