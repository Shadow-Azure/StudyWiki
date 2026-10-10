// @vitest-environment jsdom
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mountUiPreview } from "../src/preview";

const shellStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

test("ui preview: mounts the real shell, tree, and markdown viewer", async () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const teardown = await mountUiPreview(root);

  expect(root.className).toBe("shell");
  expect(root.querySelector(".tree-title")?.textContent).toBe("StudyWiki Preview");
  expect(root.querySelector(".markdown-body h1")?.textContent).toBe("Tauri 架构");
  expect(root.querySelector(".topbar-file")?.textContent).toBe("Tauri 架构.md");
  const railButtons = [...root.querySelectorAll<HTMLButtonElement>(".activity-left button")];
  expect(railButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
    "打开文件夹…",
    "新建窗口",
    "插件",
    "模型",
  ]);
  expect(railButtons.every((button) => {
    const style = getComputedStyle(button);
    return !button.hidden && style.display !== "none" && style.visibility === "visible"
      && button.getAttribute("aria-label");
  })).toBe(true);

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

  [...root.querySelectorAll<HTMLButtonElement>(".activity-left button")]
    .find((button) => button.getAttribute("aria-label") === "插件")!.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector(".plugin-panel-title")?.textContent).toBe("插件");
  expect([...document.querySelectorAll(".plugin-name")].map((el) => el.textContent)).toContain("app-shell");
  document.querySelector<HTMLButtonElement>(".plugin-panel-head .btn-ghost")!.click();
  expect(document.querySelector(".plugin-panel")).toBeNull();

  teardown();
  root.remove();
});

function findStyleRule(selector: string): CSSStyleRule | undefined {
  const style = document.createElement("style");
  style.textContent = shellStyles;
  document.head.append(style);
  try {
    return [...style.sheet?.cssRules ?? []].find((rule): rule is CSSStyleRule =>
      "selectorText" in rule && rule.selectorText === selector,
    );
  } finally {
    style.remove();
  }
}

test("ui preview: mounts the app-agent panel in the right rail", async () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  let teardown: () => void = () => {};

  try {
    teardown = await mountUiPreview(root);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Preserve the right rail's full flex-height chain. Without it,
    // .agent-panel's flex:1 has no parent height and the composer floats upward.
    const rail = root.querySelector<HTMLElement>(".rail.agent")!;
    const slotHost = rail.querySelector<HTMLElement>(":scope > .slot-host.sidebar-right")!;
    const slot = slotHost.querySelector<HTMLElement>(":scope > .slot.slot-sidebar-right")!;
    const panel = slot.querySelector<HTMLElement>(":scope > .agent-panel")!;
    const transcript = panel.querySelector<HTMLElement>(":scope > .agent-transcript")!;
    const composer = panel.querySelector<HTMLElement>(":scope > .chat-composer")!;
    expect([slotHost, slot, panel, transcript, composer].every(Boolean)).toBe(true);

    const hostRule = findStyleRule(".rail.agent > .slot-host");
    const slotRule = findStyleRule(".rail.agent > .slot-host > .slot");
    const slotTypeRule = findStyleRule(".slot-sidebar-right");
    const panelRule = findStyleRule(".agent-panel");
    const transcriptRule = findStyleRule(".agent-transcript");
    expect(hostRule?.style.display).toBe("contents");
    expect(slotRule?.style.flex).toBe("1 1 0%");
    expect(slotRule?.style.minHeight).toBe("0px");
    expect(slotTypeRule?.style.display).toBe("flex");
    expect(slotTypeRule?.style.flexDirection).toBe("column");
    expect(panelRule?.style.flex).toBe("1 1 0%");
    expect(panelRule?.style.minHeight).toBe("0px");
    expect(transcriptRule?.style.flex).toBe("1 1 0%");
    expect(transcriptRule?.style.minHeight).toBe("0px");

    expect(root.querySelector(".chat-model-pill")).not.toBeNull();
    root.querySelector<HTMLButtonElement>("[data-model-toggle]")!.click();
    expect([...root.querySelectorAll<HTMLElement>("[data-model-option]")]
      .map((option) => option.dataset.modelOption)).toContain("demo-model");
  } finally {
    teardown();
    root.remove();
  }
});

test("ui preview: PreviewLlm streams a fake chat answer end-to-end", async () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const teardown = await mountUiPreview(root);
  await new Promise((resolve) => setTimeout(resolve, 50));

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
