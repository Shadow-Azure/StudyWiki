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

test("DOM: 读失败渲染错误占位，不停留旧文档内容", async () => {
  const md = (name: string): FileNode => ({ name, path: `/x/${name}`, kind: "markdown" });
  let opened: (f: FileNode | null) => void = () => {};
  const files = { readText: async (p: string) => { if (p === "/x/bad.md") throw new Error("EIO"); return `# good`; } };
  const windows = { confirmDialog: async () => true, guardClose: async () => () => {} };
  const workspace = {
    activeFile: null as FileNode | null,
    events: { on: (_k: string, fn: (f: FileNode | null) => void) => { opened = fn; return () => {}; } },
  };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ files, windows, workspace, slots } as never, {});
  await new Promise((r) => setTimeout(r, 0));
  await opened(md("good.md"));
  await new Promise((r) => setTimeout(r, 0));
  expect(document.querySelector(".markdown-body h1")?.textContent).toBe("good");
  await opened(md("bad.md"));
  await new Promise((r) => setTimeout(r, 0));
  expect(document.querySelector(".doc-error")?.textContent).toContain("读取失败：EIO");
  expect(document.querySelector(".markdown-body h1")).toBeNull(); // 旧文档内容已清空
});

test("DOM: 写失败置可清除错误条（编辑器不卸载），成功后清除", async () => {
  const md: FileNode = { name: "a.md", path: "/x/a.md", kind: "markdown" };
  let failWrite = true;
  const files = { readText: async () => "body", writeText: async () => { if (failWrite) throw new Error("EDISK"); } };
  const windows = { confirmDialog: async () => true, guardClose: async () => () => {} };
  let opened: (f: FileNode | null) => void = () => {};
  const workspace = {
    activeFile: null as FileNode | null,
    events: { on: (_k: string, fn: (f: FileNode | null) => void) => { opened = fn; return () => {}; } },
  };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  const factory = (parent: HTMLElement, _initial: string, onChange: (t: string) => void, onSave: () => void) => {
    const dom = document.createElement("div");
    dom.className = "fake-editor";
    (dom as HTMLElement & { __fire: (t: string) => void }).__fire = (t) => onChange(t);
    (dom as HTMLElement & { __save: () => void }).__save = onSave;
    parent.append(dom);
    return { dom, getText: () => dom.textContent ?? "", destroy: () => dom.remove() };
  };
  apply({ files, windows, workspace, slots } as never, {}, factory as never);
  await new Promise((r) => setTimeout(r, 0));
  await opened(md);
  await new Promise((r) => setTimeout(r, 0));
  (document.querySelector(".viewer-toolbar button") as HTMLButtonElement).click(); // 切到编辑
  (document.querySelector(".fake-editor") as HTMLElement & { __fire: (t: string) => void }).__fire("body2");
  (document.querySelector(".fake-editor") as HTMLElement & { __save: () => void }).__save();
  await new Promise((r) => setTimeout(r, 0));
  expect(document.querySelector(".doc-error")?.textContent).toContain("保存失败：EDISK");
  expect(document.querySelector(".fake-editor")).not.toBeNull(); // 编辑器不被错误条顶掉
  expect(document.querySelector(".viewer-toolbar button:nth-child(2)")?.classList.contains("dirty")).toBe(true);
  (document.querySelector(".doc-error button") as HTMLButtonElement).click(); // × 可清除
  expect(document.querySelector(".doc-error")).toBeNull();
  failWrite = false;
  (document.querySelector(".fake-editor") as HTMLElement & { __save: () => void }).__save();
  await new Promise((r) => setTimeout(r, 0));
  expect(document.querySelector(".doc-error")).toBeNull();
  expect(document.querySelector(".viewer-toolbar button:nth-child(2)")?.classList.contains("dirty")).toBe(false);
});
