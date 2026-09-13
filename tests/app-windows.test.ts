// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { apply } from "../src/plugins/app-windows";

test("DOM: 新建窗口传当前 root；打开文件夹走 pickFolder → windows.changeRoot 单路", async () => {
  const created: Array<string | undefined> = [];
  const winChangeRoot = vi.fn(async () => {});
  const windows = {
    create: vi.fn(async (root?: string) => { created.push(root); return "win-2"; }),
    changeRoot: winChangeRoot,
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
  // 换根收编 changeRoot 单路：授权+登记 → 切工作区的顺序不变式住宿主服务（host-services 钉死）。
  expect(winChangeRoot).toHaveBeenCalledWith(workspace, "/picked");
});
