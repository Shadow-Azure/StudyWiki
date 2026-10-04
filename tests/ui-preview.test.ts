// @vitest-environment jsdom
import { expect, test } from "vitest";
import { mountUiPreview } from "../src/preview";

test("ui preview: mounts the real shell, tree, and markdown viewer", async () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const teardown = await mountUiPreview(root);

  expect(root.className).toBe("shell");
  expect(root.querySelector(".brand-name")?.textContent).toBe("StudyWiki");
  expect(root.querySelector(".brand h1")).toBeNull();
  expect(root.querySelector(".brand-seal svg")).not.toBeNull();
  expect(root.querySelector(".brand-seal")?.textContent).toBe("");
  expect(root.querySelector(".tree-title")?.textContent).toBe("StudyWiki Preview");
  expect(root.querySelector(".markdown-body h1")?.textContent).toBe("Tauri 架构");
  expect(root.querySelector(".topbar-file")?.textContent).toBe("Tauri 架构.md");
  expect([...root.querySelector(".topbar")?.children ?? []].map((el) => el.className))
    .toEqual(["brand", "topbar-file", "slot-host topbar-left"]);

  teardown();
  expect(root.children.length).toBe(0);
  root.remove();
});

test("ui preview: mounts the real video viewer and plugin panel", async () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const teardown = await mountUiPreview(root);

  await new Promise((resolve) => setTimeout(resolve, 10));
  root.querySelector<HTMLButtonElement>(".tree-dir")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  [...root.querySelectorAll<HTMLButtonElement>(".tree-file.kind-video")]
    .find((row) => row.textContent === "播放示例.mp4")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(root.querySelector(".video-stage video")?.getAttribute("src")).toBe("/StudyWiki Preview/教程/播放示例.mp4");
  expect([...root.querySelectorAll(".slot-main-viewer")].map((slot) => slot.hidden)).toEqual([true, false]);

  [...root.querySelectorAll<HTMLButtonElement>(".topbar-left button")]
    .find((button) => button.getAttribute("aria-label") === "插件")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector(".plugin-panel-title")?.textContent).toBe("插件");
  expect([...document.querySelectorAll(".plugin-name")].map((el) => el.textContent)).toContain("app-shell");
  document.querySelector<HTMLButtonElement>(".plugin-panel-head .btn-ghost")!.click();
  expect(document.querySelector(".plugin-panel")).toBeNull();

  teardown();
  root.remove();
});

test("ui preview: mounts the app-agent panel in the right rail", async () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const teardown = await mountUiPreview(root);
  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(root.querySelector(".agent-model-select")).not.toBeNull();
  expect([...root.querySelectorAll<HTMLSelectElement>(".agent-model-select option")]
    .map((option) => option.value)).toContain("demo-model");

  teardown();
  root.remove();
});

test("ui preview: PreviewLlm streams a fake chat answer end-to-end", async () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const teardown = await mountUiPreview(root);
  await new Promise((resolve) => setTimeout(resolve, 10));

  const input = root.querySelector("textarea")!;
  input.value = "预览提问";
  root.querySelector<HTMLButtonElement>(".chat-send")!.click();
  const start = Date.now();
  while (!root.querySelector(".chat-usage")?.textContent?.includes("finish stop")
    && Date.now() - start < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  expect(root.querySelector(".chat-usage")?.textContent).toContain("finish stop");
  expect(root.querySelector(".chat-md")?.textContent).toContain("预览桩回答");

  teardown();
  root.remove();
});
