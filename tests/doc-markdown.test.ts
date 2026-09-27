// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { renderMarkdown } from "../src/plugins/doc-markdown/preview";
import { apply } from "../src/plugins/doc-markdown";
import { WorkspaceService } from "../src/host/workspace";
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
    guardSwitch: () => () => {},
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
    guardSwitch: () => () => {},
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
    guardSwitch: () => () => {},
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
  ([...document.querySelectorAll<HTMLButtonElement>(".mode-group button")].find((b) => b.textContent === "编辑"))!.click();
  (document.querySelector(".fake-editor") as HTMLElement & { __fire: (t: string) => void }).__fire("body2");
  (document.querySelector(".fake-editor") as HTMLElement & { __save: () => void }).__save();
  await new Promise((r) => setTimeout(r, 0));
  expect(document.querySelector(".doc-error")?.textContent).toContain("保存失败：EDISK");
  expect(document.querySelector(".fake-editor")).not.toBeNull(); // 编辑器不被错误条顶掉
  expect(document.querySelector(".save-btn")?.classList.contains("dirty")).toBe(true);

  failWrite = false;
  (document.querySelector(".fake-editor") as HTMLElement & { __save: () => void }).__save();
  await new Promise((r) => setTimeout(r, 0));
  expect(document.querySelector(".doc-error")).toBeNull();
  expect(document.querySelector(".save-btn")?.classList.contains("dirty")).toBe(false);

  failWrite = true;
  (document.querySelector(".fake-editor") as HTMLElement & { __fire: (t: string) => void }).__fire("body3");
  (document.querySelector(".fake-editor") as HTMLElement & { __save: () => void }).__save();
  await new Promise((r) => setTimeout(r, 0));
  (document.querySelector(".doc-error button") as HTMLButtonElement).click(); // × 可清除
  expect(document.querySelector(".doc-error")).toBeNull();
});

test("DOM: markdown 读取期间显示共享加载态", async () => {
  const md: FileNode = { name: "slow.md", path: "/x/slow.md", kind: "markdown" };
  let resolveRead!: (text: string) => void;
  const files = { readText: () => new Promise<string>((resolve) => { resolveRead = resolve; }), writeText: vi.fn() };
  let opened: (f: FileNode | null) => Promise<void> = async () => {};
  const windows = { confirmDialog: async () => true, guardClose: async () => () => {} };
  const workspace = {
    activeFile: null as FileNode | null,
    events: { on: (_k: string, fn: (f: FileNode | null) => void) => { opened = fn; return () => {}; } },
    guardSwitch: vi.fn(() => () => {}),
  };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  const teardown = apply({ files, windows, workspace, slots } as never, {});
  const pending = opened(md);
  expect(document.querySelector(".viewer-loading")?.textContent).toBe("加载中…");
  resolveRead("# slow");
  await pending;
  expect(document.querySelector(".viewer-loading")).toBeNull();
  expect(document.querySelector(".markdown-body h1")?.textContent).toBe("slow");
  teardown();
  document.body.replaceChildren();
});

test("DOM: markdown 预览模式响应全局 Mod-S 并标注快捷键", async () => {
  const md: FileNode = { name: "a.md", path: "/x/a.md", kind: "markdown" };
  const files = { readText: async () => "body", writeText: vi.fn() };
  let opened: (f: FileNode | null) => Promise<void> = async () => {};
  const windows = { confirmDialog: async () => true, guardClose: async () => () => {} };
  const workspace = {
    activeFile: md,
    events: { on: (_k: string, fn: (f: FileNode | null) => void) => { opened = fn; return () => {}; } },
    guardSwitch: vi.fn(() => () => {}),
  };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  const factory = (parent: HTMLElement, _initial: string, onChange: (t: string) => void) => {
    const dom = document.createElement("div");
    dom.className = "fake-editor";
    (dom as HTMLElement & { __fire: (t: string) => void }).__fire = (t) => onChange(t);
    parent.append(dom);
    return { dom, getText: () => dom.textContent ?? "", destroy: () => dom.remove() };
  };
  const teardown = apply({ files, windows, workspace, slots } as never, {}, factory as never);
  await opened(md);
  ([...document.querySelectorAll<HTMLButtonElement>(".mode-group button")].find((b) => b.textContent === "编辑"))!.click();
  (document.querySelector(".fake-editor") as HTMLElement & { __fire: (t: string) => void }).__fire("body2");
  ([...document.querySelectorAll<HTMLButtonElement>(".mode-group button")].find((b) => b.textContent === "预览"))!.click();
  expect(document.querySelector(".save-btn")?.getAttribute("aria-keyshortcuts")).toBe("Control+S Meta+S");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 0));
  expect(files.writeText).toHaveBeenCalledWith("/x/a.md", "body2");
  teardown();
  document.body.replaceChildren();
});

test("DOM: markdown 注册切换守卫", async () => {
  const md: FileNode = { name: "a.md", path: "/x/a.md", kind: "markdown" };
  const files = { readText: async () => "body", writeText: vi.fn() };
  const windows = { confirmDialog: async () => true, guardClose: async () => () => {} };
  const guardSwitch = vi.fn(() => () => {});
  const workspace = {
    activeFile: null as FileNode | null,
    events: { on: () => () => {} },
    guardSwitch,
  };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  const teardown = apply({ files, windows, workspace, slots } as never, {});
  expect(guardSwitch).toHaveBeenCalledTimes(1);
  teardown();
  document.body.replaceChildren();
});

test("DOM: markdown 切出时不覆盖 shell 标题基线", async () => {
  document.title = "Custom Wiki";
  let opened: (f: FileNode | null) => Promise<void> = async () => {};
  const files = { readText: async () => "body", writeText: vi.fn() };
  const windows = { confirmDialog: async () => true, guardClose: async () => () => {} };
  const workspace = {
    activeFile: null as FileNode | null,
    events: { on: (_k: string, fn: (f: FileNode | null) => void) => { opened = fn; return () => {}; } },
    guardSwitch: () => () => {},
  };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  const teardown = apply({ files, windows, workspace, slots } as never, {});
  await opened(null);
  expect(document.title).toBe("Custom Wiki");
  teardown();
  document.body.replaceChildren();
});

test("DOM: 干净 markdown 不触发关窗守卫", async () => {
  const md: FileNode = { name: "a.md", path: "/x/a.md", kind: "markdown" };
  let guardShould: () => boolean = () => false;
  const files = { readText: async () => "body", writeText: vi.fn() };
  const windows = {
    confirmDialog: async () => true,
    guardClose: async (should: () => boolean) => { guardShould = should; return () => {}; },
  };
  let opened: (f: FileNode | null) => Promise<void> = async () => {};
  const workspace = {
    activeFile: md,
    events: { on: (_k: string, fn: (f: FileNode | null) => void) => { opened = fn; return () => {}; } },
    guardSwitch: () => () => {},
  };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  const teardown = apply({ files, windows, workspace, slots } as never, {});
  await opened(md);
  expect(guardShould()).toBe(false);
  teardown();
  document.body.replaceChildren();
});

test("DOM: 迟到的 markdown 读取不能覆盖后打开的文档", async () => {
  document.body.replaceChildren();
  const md = (name: string): FileNode => ({ name, path: `/x/${name}`, kind: "markdown" });
  const deferred = new Map<string, (text: string) => void>();
  const files = {
    readText: (path: string) => new Promise<string>((resolve) => { deferred.set(path, resolve); }),
    writeText: vi.fn(),
  };
  let opened: (f: FileNode | null) => Promise<void> = async () => {};
  const windows = { confirmDialog: async () => true, guardClose: async () => () => {} };
  const workspace = {
    activeFile: null as FileNode | null,
    events: { on: (_k: string, fn: (f: FileNode | null) => void) => { opened = fn; return () => {}; } },
    guardSwitch: () => () => {},
  };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  const teardown = apply({ files, windows, workspace, slots } as never, {});
  const slow = opened(md("slow.md"));
  workspace.activeFile = md("fast.md");
  const fast = opened(workspace.activeFile);
  deferred.get("/x/fast.md")!("# fast");
  await fast;
  deferred.get("/x/slow.md")!("# slow");
  await slow;
  expect(document.querySelector(".markdown-body h1")?.textContent).toBe("fast");
  teardown();
  document.body.replaceChildren();
});

test("DOM: markdown 保存期间继续编辑保持脏状态并可重试", async () => {
  document.body.replaceChildren();
  const md: FileNode = { name: "a.md", path: "/x/a.md", kind: "markdown" };
  let releaseWrite!: () => void;
  const writes: string[] = [];
  const files = {
    readText: async () => "body",
    writeText: async (_p: string, text: string) => {
      writes.push(text);
      if (writes.length === 1) await new Promise<void>((resolve) => { releaseWrite = resolve; });
    },
  };
  let opened: (f: FileNode | null) => Promise<void> = async () => {};
  const windows = { confirmDialog: async () => true, guardClose: async () => () => {} };
  const workspace = {
    activeFile: md,
    events: { on: (_k: string, fn: (f: FileNode | null) => void) => { opened = fn; return () => {}; } },
    guardSwitch: () => () => {},
  };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  const factory = (parent: HTMLElement, _initial: string, onChange: (t: string) => void) => {
    const dom = document.createElement("div");
    dom.className = "fake-editor";
    (dom as HTMLElement & { __fire: (t: string) => void }).__fire = (t) => onChange(t);
    parent.append(dom);
    return { dom, getText: () => dom.textContent ?? "", destroy: () => dom.remove() };
  };
  const teardown = apply({ files, windows, workspace, slots } as never, {}, factory as never);
  await opened(md);
  ([...document.querySelectorAll<HTMLButtonElement>(".mode-group button")].find((b) => b.textContent === "编辑"))!.click();
  const editor = document.querySelector(".fake-editor") as HTMLElement & { __fire: (t: string) => void };
  editor.__fire("body2");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true }));
  await vi.waitFor(() => expect(writes).toEqual(["body2"]));
  editor.__fire("body3");
  releaseWrite();
  await new Promise((r) => setTimeout(r, 0));
  expect(document.querySelector(".save-btn")?.classList.contains("dirty")).toBe(true);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true }));
  await vi.waitFor(() => expect(writes).toEqual(["body2", "body3"]));
  await new Promise((r) => setTimeout(r, 0));
  expect(document.querySelector(".save-btn")?.classList.contains("dirty")).toBe(false);
  teardown();
  document.body.replaceChildren();
});

test("DOM: teardown 后迟到的关窗守卫注册也被释放", async () => {
  let resolveRegistration!: (off: () => void) => void;
  let registeredOff: (() => void) | null = null;
  const files = { readText: async () => "body", writeText: vi.fn() };
  const windows = {
    confirmDialog: async () => true,
    guardClose: () => new Promise((resolve) => {
      resolveRegistration = (off) => { registeredOff = off; resolve(off); };
    }) as Promise<() => void>,
  };
  const workspace = {
    activeFile: null as FileNode | null,
    events: { on: () => () => {} },
    guardSwitch: () => () => {},
  };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  const teardown = apply({ files, windows, workspace, slots } as never, {});
  teardown();
  resolveRegistration(() => { registeredOff = null; });
  await new Promise((r) => setTimeout(r, 0));
  expect(registeredOff).toBeNull(); // resolved disposer itself was drained and invoked
});

test("DOM: markdown 脏状态接入真实切换守卫", async () => {
  document.body.replaceChildren();
  const md: FileNode = { name: "a.md", path: "/x/a.md", kind: "markdown" };
  const other: FileNode = { name: "v.mp4", path: "/x/v.mp4", kind: "video" };
  const files = { readText: async () => "body", writeText: vi.fn() };
  const confirmDialog = vi.fn(async () => false);
  const windows = { confirmDialog, guardClose: async () => () => {} };
  const workspace = new WorkspaceService();
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  const factory = (parent: HTMLElement, _initial: string, onChange: (t: string) => void) => {
    const dom = document.createElement("div");
    dom.className = "fake-editor";
    (dom as HTMLElement & { __fire: (t: string) => void }).__fire = (t) => onChange(t);
    parent.append(dom);
    return { dom, getText: () => dom.textContent ?? "", destroy: () => dom.remove() };
  };
  const teardown = apply({ files, windows, workspace: workspace.facade, slots } as never, {}, factory as never);
  await workspace.openFile(md);
  ([...document.querySelectorAll<HTMLButtonElement>(".mode-group button")].find((b) => b.textContent === "编辑"))!.click();
  (document.querySelector(".fake-editor") as HTMLElement & { __fire: (t: string) => void }).__fire("body2");
  await expect(workspace.openFile(other)).resolves.toBe(false);
  expect(workspace.activeFile).toBe(md);
  expect(document.querySelector(".fake-editor")).not.toBeNull();
  confirmDialog.mockResolvedValue(true);
  await expect(workspace.openFile(other)).resolves.toBe(true);
  expect(workspace.activeFile).toBe(other);
  expect(document.querySelector(".fake-editor")).toBeNull();
  teardown();
  document.body.replaceChildren();
});
