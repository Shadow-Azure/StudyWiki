// @vitest-environment jsdom
import { expect, test } from "vitest";
import { WorkspaceService } from "../src/host/workspace";
import { SlotsService } from "../src/host/slots";
import type { FileNode } from "../src/types";

const md = (name: string): FileNode => ({ name, path: `/x/${name}`, kind: "markdown" });

test("workspace: setRoot 清空 activeFile 并广播两个事件", async () => {
  const ws = new WorkspaceService();
  const events: string[] = [];
  ws.events.on("root-changed", (r) => events.push(`root:${r}`));
  ws.events.on("file-opened", (f) => events.push(`file:${f?.name ?? "-"}`));
  await ws.openFile(md("a.md"));
  await ws.setRoot("/y");
  expect(ws.root).toBe("/y");
  expect(ws.activeFile).toBeNull();
  expect(events).toEqual(["file:a.md", "root:/y", "file:-"]);
});

test("workspace: guardSwitch 拒绝时保留当前文件", async () => {
  const ws = new WorkspaceService();
  const a = md("a.md");
  const b = md("b.md");
  await ws.openFile(a);
  const off = ws.guardSwitch(
    () => true,
    () => Promise.resolve(false),
  );
  await expect(ws.openFile(b)).resolves.toBe(false);
  expect(ws.activeFile).toBe(a);
  off();
});

test("workspace: guardSwitch 确认后切换文件", async () => {
  const ws = new WorkspaceService();
  const a = md("a.md");
  const b = md("b.md");
  await ws.openFile(a);
  const off = ws.guardSwitch(
    () => true,
    () => Promise.resolve(true),
  );
  await expect(ws.openFile(b)).resolves.toBe(true);
  expect(ws.activeFile).toBe(b);
  off();
});

test("workspace: 打开同路径不触发切换守卫", async () => {
  const ws = new WorkspaceService();
  const a = md("a.md");
  await ws.openFile(a);
  let asked = false;
  const off = ws.guardSwitch(
    () => true,
    () => { asked = true; return Promise.resolve(false); },
  );
  await expect(ws.openFile(a)).resolves.toBe(true);
  expect(asked).toBe(false);
  off();
});

test("workspace: setRoot 拒绝时保留当前文件与根", async () => {
  const ws = new WorkspaceService();
  await ws.setRoot("/x");
  const a = md("a.md");
  await ws.openFile(a);
  const off = ws.guardSwitch(
    () => true,
    () => Promise.resolve(false),
  );
  await expect(ws.setRoot("/y")).resolves.toBe(false);
  expect(ws.root).toBe("/x");
  expect(ws.activeFile).toBe(a);
  off();
});

test("slots: 按注册顺序渲染、反订阅移除、mount 重绑清容器", () => {
  const slots = new SlotsService();
  const order: string[] = [];
  const off = slots.register("main.viewer", (el) => { order.push(`a:${el.tagName}`); });
  slots.register("main.viewer", () => order.push("b"));
  const container = document.createElement("div");
  const probe = document.createElement("span");
  container.appendChild(probe);
  slots.mount("main.viewer", container);
  expect(order).toEqual(["a:DIV", "b"]);
  expect(container.contains(probe)).toBe(false); // mount 重置容器
  off();
  expect(container.querySelectorAll(".slot").length).toBe(1);
});

test("workspace: 同路径脏文档重开为无提示 no-op", async () => {
  const ws = new WorkspaceService();
  const a = md("a.md");
  await ws.openFile(a);
  let opened = 0;
  const offEvent = ws.events.on("file-opened", () => { opened += 1; });
  const offGuard = ws.guardSwitch(() => true, () => Promise.resolve(false));
  await expect(ws.openFile(a)).resolves.toBe(true);
  expect(ws.activeFile).toBe(a);
  expect(opened).toBe(0);
  offGuard();
  offEvent();
});
