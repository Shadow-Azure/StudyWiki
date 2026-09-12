// @vitest-environment jsdom
import { expect, test } from "vitest";
import { WorkspaceService } from "../src/host/workspace";
import { SlotsService } from "../src/host/slots";
import type { FileNode } from "../src/types";

const md = (name: string): FileNode => ({ name, path: `/x/${name}`, kind: "markdown" });

test("workspace: setRoot 清空 activeFile 并广播两个事件", () => {
  const ws = new WorkspaceService();
  const events: string[] = [];
  ws.events.on("root-changed", (r) => events.push(`root:${r}`));
  ws.events.on("file-opened", (f) => events.push(`file:${f?.name ?? "-"}`));
  ws.openFile(md("a.md"));
  ws.setRoot("/y");
  expect(ws.root).toBe("/y");
  expect(ws.activeFile).toBeNull();
  expect(events).toEqual(["file:a.md", "root:/y", "file:-"]);
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
