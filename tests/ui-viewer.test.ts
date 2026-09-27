// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { bindSaveShortcut, errorBanner, loadingHint, paintTitle } from "../src/ui/viewer";
import type { FileNode } from "../src/types";

const file = (name: string, kind: FileNode["kind"]): FileNode => ({ name, path: `/x/${name}`, kind });

test("viewer: errorBanner 替换旧条并可关闭", () => {
  const host = document.createElement("div");
  const stale = document.createElement("div");
  stale.className = "doc-error";
  host.append(stale);
  const onDismiss = vi.fn();
  const bar = errorBanner(host, "读取失败：EIO", onDismiss);
  expect(host.querySelectorAll(".doc-error")).toHaveLength(1);
  expect(bar.textContent).toContain("读取失败：EIO");
  expect(bar.querySelector("button")?.getAttribute("aria-label")).toBe("关闭错误提示");
  (bar.querySelector("button") as HTMLButtonElement).click();
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

test("viewer: loadingHint 渲染共享加载态", () => {
  const el = loadingHint();
  expect(el.className).toBe("viewer-loading");
  expect(el.textContent).toBe("加载中…");
});

test("viewer: paintTitle 统一文件名与脏标规则", () => {
  paintTitle(file("a.md", "markdown"), true);
  expect(document.title).toBe("● a.md");
  paintTitle(file("b.mp4", "video"));
  expect(document.title).toBe("b.mp4");
  paintTitle(null);
  expect(document.title).toBe("StudyWiki");
});

test("viewer: bindSaveShortcut 仅激活时响应 Mod-S", () => {
  const onSave = vi.fn();
  const off = bindSaveShortcut(() => true, onSave);
  const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(event.defaultPrevented).toBe(true);
  off();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
  expect(onSave).toHaveBeenCalledTimes(1);
});

test("viewer: bindSaveShortcut 不抢 CodeMirror 自己处理的 Mod-S", () => {
  const onSave = vi.fn();
  const off = bindSaveShortcut(() => true, onSave);
  const cmContent = document.createElement("div");
  cmContent.className = "cm-content";
  document.body.append(cmContent);
  cmContent.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
  expect(onSave).not.toHaveBeenCalled();
  off();
  cmContent.remove();
});
