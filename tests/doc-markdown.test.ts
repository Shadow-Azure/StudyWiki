// @vitest-environment jsdom
import { expect, test } from "vitest";
import { renderMarkdown } from "../src/plugins/doc-markdown/preview";
import { apply } from "../src/plugins/doc-markdown";
import type { FileNode } from "../src/types";

test("renderMarkdown: 标题成 h1；内嵌 HTML 被转义不执行", () => {
  expect(renderMarkdown("# hi")).toContain("<h1>hi</h1>");
  expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script>");
});

test("DOM: file-opened(kind=markdown) 渲染预览；kind 不符清空", async () => {
  const md = (name: string): FileNode => ({ name, path: `/x/${name}`, kind: "markdown" });
  let opened: (fn: (f: FileNode | null) => void) => () => {};
  const files = { readText: async (p: string) => `# ${p}` };
  const windows = { confirmDialog: async () => true, guardClose: async () => () => {} }; // 重写后 apply 即挂关窗守卫，ctx 须供 windows（T8 桩补行同款连锁，断言零改动）
  const workspace = {
    activeFile: null as FileNode | null,
    events: { on: (_k: string, fn: (f: FileNode | null) => void) => { opened = fn; return () => {}; } },
  };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ files, windows, workspace, slots } as never, {});
  await new Promise((r) => setTimeout(r, 0));
  await opened(md("a.md"));
  expect(document.querySelector(".markdown-body h1")?.textContent).toBe("/x/a.md");
  await opened(null);
  expect(document.querySelector(".markdown-body")).toBeNull();
});
