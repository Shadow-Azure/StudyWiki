// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { apply } from "../src/plugins/app-windows";

test("DOM: 新建窗口传当前 root；打开文件夹走 pickFolder → windows.setRoot → workspace.setRoot", async () => {
  const created: Array<string | undefined> = [];
  const winSetRoot = vi.fn(async () => {});
  const windows = {
    create: vi.fn(async (root?: string) => { created.push(root); return "win-2"; }),
    currentLabel: () => "main",
    setRoot: winSetRoot,
  };
  const files = { pickFolder: vi.fn(async () => "/picked") };
  const workspace = { root: "/x", setRoot: vi.fn() };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ windows, files, workspace, slots } as never, {});
  const [newBtn, openBtn] = [...document.querySelectorAll<HTMLButtonElement>("button")];
  newBtn.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(created).toEqual(["/x"]);
  openBtn.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(files.pickFolder).toHaveBeenCalled();
  // Rust 侧先登记注册表并授权 asset，前端再切工作区（顺序：持久化优先）
  expect(winSetRoot).toHaveBeenCalledWith("main", "/picked");
  expect(workspace.setRoot).toHaveBeenCalledWith("/picked");
  expect(winSetRoot.mock.invocationCallOrder[0]).toBeLessThan(workspace.setRoot.mock.invocationCallOrder[0]);
});
