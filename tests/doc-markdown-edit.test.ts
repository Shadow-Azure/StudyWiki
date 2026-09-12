// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { editText, isDirty, markSaved, openDoc, toggleMode } from "../src/plugins/doc-markdown/mode";
import type { FileNode } from "../src/types";

test("mode 纯逻辑: open/edit/saved/dirty/toggle", () => {
  let s = openDoc("a");
  expect(s.mode).toBe("preview");
  expect(isDirty(s)).toBe(false);
  s = editText(s, "ab");
  expect(isDirty(s)).toBe(true);
  s = markSaved(s);
  expect(isDirty(s)).toBe(false);
  expect(toggleMode("preview")).toBe("edit");
  expect(toggleMode("edit")).toBe("preview");
});

/** 两个 DOM 用例共享的 fake 宿主 ctx：slots.register 即挂 document.body，
 * `opened()` 触发插件登记的 file-opened 订阅，writes 收集写盘调用。
 * （蓝本两用例的组装逐字相同，按 brief 指示提为 helper；opened 的函数
 * 类型补外层形参名——蓝本无名参数表是语法错误，运行时语义不变。） */
function makeCtx() {
  const md: FileNode = { name: "a.md", path: "/x/a.md", kind: "markdown" };
  const writes: Array<[string, string]> = [];
  let opened: (fn: (f: FileNode | null) => void) => () => void = () => () => {};
  const files = { readText: async () => "body", writeText: async (p: string, c: string) => { writes.push([p, c]); } };
  const workspace = {
    activeFile: null as FileNode | null,
    events: { on: (_k: string, fn: (f: FileNode | null) => void) => { opened = fn; return () => {}; } },
  };
  const guardClose = vi.fn(async () => () => {});
  const windows = { confirmDialog: vi.fn(async () => true), guardClose };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  return { md, writes, guardClose, opened: () => opened, ctx: { files, windows, workspace, slots } as never };
}

test("DOM: 编辑模式挂载编辑器工厂、onChange 记脏、保存写回", async () => {
  const { apply } = await import("../src/plugins/doc-markdown");
  const factory = vi.fn((parent: HTMLElement, initial: string, onChange: (t: string) => void, onSave: () => void) => {
    const dom = document.createElement("div");
    dom.className = "fake-editor";
    dom.textContent = initial;
    (dom as HTMLElement & { __fire: (t: string) => void }).__fire = (t) => onChange(t);
    (dom as HTMLElement & { __save: () => void }).__save = onSave;
    parent.append(dom);
    return { dom, getText: () => dom.textContent ?? "", destroy: () => dom.remove() };
  });
  const c = makeCtx();
  apply(c.ctx, {}, factory as never);
  await new Promise((r) => setTimeout(r, 0));
  await c.opened()(c.md);
  (document.querySelector(".viewer-toolbar button") as HTMLButtonElement).click(); // 切到编辑（打开落在预览模式，蓝本用例缺这一步，null.__fire 拒析）
  (document.querySelector(".fake-editor") as HTMLElement & { __fire: (t: string) => void }).__fire("body2");
  expect(document.querySelector(".viewer-toolbar button:nth-child(2)")?.classList.contains("dirty")).toBe(true);
  (document.querySelector(".fake-editor") as HTMLElement & { __save: () => void }).__save();
  await new Promise((r) => setTimeout(r, 0));
  expect(c.writes).toEqual([["/x/a.md", "body2"]]);
  expect(document.querySelector(".viewer-toolbar button:nth-child(2)")?.classList.contains("dirty")).toBe(false);
  expect(c.guardClose).toHaveBeenCalled();
});

test("DOM: 切到编辑模式渲染编辑器，切回预览销毁", async () => {
  const { apply } = await import("../src/plugins/doc-markdown");
  const factory = (parent: HTMLElement) => {
    const dom = document.createElement("div");
    dom.className = "fake-editor";
    parent.append(dom);
    return { dom, getText: () => "", destroy: () => dom.remove() };
  };
  const c = makeCtx();
  apply(c.ctx, {}, factory as never);
  await new Promise((r) => setTimeout(r, 0));
  await c.opened()(c.md);
  (document.querySelector(".viewer-toolbar button") as HTMLButtonElement).click(); // 切到编辑
  expect(document.querySelector(".fake-editor")).not.toBeNull();
  (document.querySelector(".viewer-toolbar button") as HTMLButtonElement).click(); // 切回预览
  expect(document.querySelector(".fake-editor")).toBeNull();
  expect(document.querySelector(".markdown-body")).not.toBeNull();
});
