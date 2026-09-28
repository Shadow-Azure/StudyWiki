// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { apply } from "../src/plugins/app-windows";
import { WindowsService } from "../src/host/windows";
import { WorkspaceService } from "../src/host/workspace";
import type { FileNode } from "../src/types";

test("DOM: 新建窗口传当前 root；打开文件夹走 pickFolder → windows.changeRoot 单路", async () => {
  const created: Array<string | undefined> = [];
  const winChangeRoot = vi.fn(async () => true);
  const windows = {
    create: vi.fn(async (root?: string) => { created.push(root); return "win-2"; }),
    changeRoot: winChangeRoot,
  };
  const files = { pickFolder: vi.fn(async () => "/picked") };
  const workspace = { root: "/x", setRoot: vi.fn() };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ windows, files, workspace, slots } as never, {});
  const [newBtn, openBtn] = [...document.querySelectorAll<HTMLButtonElement>("button")];
  expect([newBtn, openBtn].map((b) => [b.textContent, b.getAttribute("aria-label"), b.title]))
    .toEqual([["", "新建窗口", "新建窗口"], ["", "打开文件夹…", "打开文件夹…"]]);
  expect([newBtn, openBtn].every((b) => b.classList.contains("icon-btn"))).toBe(true);
  newBtn.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(created).toEqual(["/x"]);
  openBtn.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(files.pickFolder).toHaveBeenCalled();
  // 换根收编 changeRoot 单路：授权+登记 → 切工作区的顺序不变式住宿主服务（host-services 钉死）。
  expect(winChangeRoot).toHaveBeenCalledWith("/picked");
});

test("DOM: 打开文件夹过真实 changeRoot 链，守卫拒绝保持原 root 与 activeFile", async () => {
  document.body.replaceChildren();
  const invoke = vi.fn(async () => null);
  const confirmDialog = vi.fn(async () => false);
  const windows = new WindowsService({ invoke, currentLabel: () => "main", onCloseRequested: vi.fn(), confirmDialog });
  const workspace = new WorkspaceService();
  await workspace.setRoot("/old");
  const md: FileNode = { name: "a.md", path: "/old/a.md", kind: "markdown" };
  await workspace.openFile(md);
  workspace.guardSwitch(() => true, () => confirmDialog("放弃对 a.md 的未保存修改并切换？"));
  windows.bindWorkspace(workspace);
  const files = { pickFolder: vi.fn(async () => "/new") };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  const teardown = apply({ windows, files, slots } as never, {});
  const openBtn = [...document.querySelectorAll<HTMLButtonElement>("button")][1]!;

  openBtn.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(files.pickFolder).toHaveBeenCalledTimes(1);
  expect(confirmDialog).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalled();
  expect(workspace.root).toBe("/old");
  expect(workspace.activeFile).toBe(md);

  confirmDialog.mockResolvedValue(true);
  openBtn.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(invoke).toHaveBeenCalledWith("set_window_root", { label: "main", root: "/new" });
  expect(workspace.root).toBe("/new");
  expect(workspace.activeFile).toBeNull();
  teardown();
  document.body.replaceChildren();
});
