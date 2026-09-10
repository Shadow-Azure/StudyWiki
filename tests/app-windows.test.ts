// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { apply } from "../src/plugins/app-windows";

test("DOM: 新建窗口传当前 root；打开文件夹走 pickFolder+setRoot", async () => {
  const created: Array<string | undefined> = [];
  const setRoot = vi.fn();
  const windows = { create: vi.fn(async (root?: string) => { created.push(root); return "win-2"; }) };
  const files = { pickFolder: vi.fn(async () => "/picked") };
  const workspace = { root: "/x", setRoot };
  const slots = { register: (_s: string, render: (el: HTMLElement) => void) => { render(document.body); return () => {}; } };
  apply({ windows, files, workspace, slots } as never, {});
  const [newBtn, openBtn] = [...document.querySelectorAll<HTMLButtonElement>("button")];
  newBtn.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(created).toEqual(["/x"]);
  openBtn.click();
  await new Promise((r) => setTimeout(r, 0));
  expect(files.pickFolder).toHaveBeenCalled();
  expect(setRoot).toHaveBeenCalledWith("/picked");
});
