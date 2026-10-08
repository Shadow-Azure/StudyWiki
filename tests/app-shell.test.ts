// @vitest-environment jsdom
import { expect, test } from "vitest";
import { icon } from "../src/ui/icons";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { apply } from "../src/plugins/app-shell";
import {
  SHELL_LAYOUT_KEY,
  saveShellLayout,
  type ShellLayoutState,
} from "../src/plugins/app-shell/layout";

const shellStyles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

test("shell: mounts activity rail and collapsible rails", () => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1180 });
  localStorage.removeItem(SHELL_LAYOUT_KEY);
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const mounted: string[] = [];
  const slots = { mount: (slot: string, host: HTMLElement) => { mounted.push(slot); host.replaceChildren(); } };
  const workspace = { root: null, activeFile: null, events: { on: () => () => {} } };
  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });

  expect(mounted).toEqual(expect.arrayContaining(["activity.left", "sidebar.tree", "main.viewer", "sidebar.right"]));
  expect(mounted).not.toContain("topbar.left");
  expect(root.querySelector(".activity .slot-host.activity-left")).toBeTruthy();
  expect(root.querySelector(".brand-seal")).toBeNull();
  expect(root.querySelector(".titlebar .titlebar-title")).toBeTruthy();
  const workbench = root.querySelector<HTMLElement>(".workbench")!;
  expect(workbench.dataset.filesOpen).toBe("true");
  expect(workbench.dataset.agentOpen).toBe("true");
  expect(workbench.style.getPropertyValue("--activity-width")).toBe("54px");
  expect(workbench.style.getPropertyValue("--files-width")).toBe("252px");
  expect(workbench.style.getPropertyValue("--agent-width")).toBe("320px");
  const filesToggle = root.querySelector<HTMLButtonElement>('[data-rail-toggle="files"]')!;
  const agentToggle = root.querySelector<HTMLButtonElement>('[data-rail-toggle="agent"]')!;
  expect(root.querySelector('.rail-resizer[data-side="files"]')).toBeTruthy();
  expect(root.querySelector('.rail-resizer[data-side="agent"]')).toBeTruthy();
  expect(root.querySelector('.rail-resizer[data-side="files"]')?.getAttribute("aria-valuenow")).toBe("252");
  expect(root.querySelector('.rail-resizer[data-side="files"]')?.getAttribute("aria-valuemax")).toBe("440");
  expect(root.querySelector('.rail-resizer[data-side="agent"]')?.getAttribute("aria-valuenow")).toBe("320");
  expect(root.querySelector('.rail-resizer[data-side="agent"]')?.getAttribute("aria-valuemax")).toBe("520");

  expect(filesToggle.getAttribute("aria-pressed")).toBe("true");
  expect(agentToggle.getAttribute("aria-pressed")).toBe("true");
  filesToggle.click();
  expect(workbench.dataset.filesOpen).toBe("false");
  expect(workbench.style.getPropertyValue("--files-width")).toBe("0px");
  expect(filesToggle.getAttribute("aria-pressed")).toBe("false");
  expect(root.querySelector(".activity")).toBeTruthy();
  agentToggle.click();
  expect(workbench.dataset.agentOpen).toBe("false");
  expect(agentToggle.getAttribute("aria-pressed")).toBe("false");
  teardown();
  localStorage.removeItem(SHELL_LAYOUT_KEY);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  root.remove();
});

test("shell: closed rails stay mounted and toggles remain independent", () => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1180 });
  localStorage.removeItem(SHELL_LAYOUT_KEY);
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const slots = { mount: (_slot: string, host: HTMLElement) => host.replaceChildren() };
  const workspace = { root: null, activeFile: null, events: { on: () => () => {} } };
  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
  const workbench = root.querySelector<HTMLElement>(".workbench")!;
  const filesToggle = root.querySelector<HTMLButtonElement>('[data-rail-toggle="files"]')!;
  const agentToggle = root.querySelector<HTMLButtonElement>('[data-rail-toggle="agent"]')!;
  const filesRail = root.querySelector<HTMLElement>(".rail.files")!;
  const treeHost = root.querySelector<HTMLElement>(".slot-host.sidebar-tree")!;
  const agentRail = root.querySelector<HTMLElement>(".rail.agent")!;
  const agentHost = root.querySelector<HTMLElement>(".slot-host.sidebar-right")!;
  const stylesheet = document.createElement("style");
  stylesheet.textContent = shellStyles;
  document.head.append(stylesheet);

  filesToggle.click();
  expect(workbench.dataset.filesOpen).toBe("false");
  expect(workbench.style.getPropertyValue("--files-width")).toBe("0px");
  expect(filesToggle.getAttribute("aria-pressed")).toBe("false");
  expect(workbench.dataset.agentOpen).toBe("true");
  expect(workbench.style.getPropertyValue("--agent-width")).toBe("320px");
  expect(agentToggle.getAttribute("aria-pressed")).toBe("true");
  expect(root.contains(filesRail)).toBe(true);
  expect(root.contains(treeHost)).toBe(true);
  expect(workbench.matches('[data-files-open="false"]')).toBe(true);
  const filesVisibilityRule = [...stylesheet.sheet?.cssRules ?? []].find((rule): rule is CSSStyleRule =>
    "selectorText" in rule && rule.selectorText.includes('.workbench[data-files-open="false"] .sidebar > *'),
  );
  expect(filesVisibilityRule?.style.visibility).toBe("hidden");

  agentToggle.click();
  expect(workbench.dataset.agentOpen).toBe("false");
  expect(workbench.style.getPropertyValue("--agent-width")).toBe("0px");
  expect(agentToggle.getAttribute("aria-pressed")).toBe("false");
  expect(root.contains(agentRail)).toBe(true);
  expect(root.contains(agentHost)).toBe(true);
  const agentVisibilityRule = [...stylesheet.sheet?.cssRules ?? []].find((rule): rule is CSSStyleRule =>
    "selectorText" in rule && rule.selectorText.includes('.workbench[data-agent-open="false"] .chat-rail > *'),
  );
  expect(agentVisibilityRule?.style.visibility).toBe("hidden");
  expect(workbench.dataset.filesOpen).toBe("false");
  expect(workbench.style.getPropertyValue("--files-width")).toBe("0px");
  expect(filesToggle.getAttribute("aria-pressed")).toBe("false");
  expect(workbench.matches('[data-agent-open="false"]')).toBe(true);

  filesToggle.click();
  expect(workbench.dataset.filesOpen).toBe("true");
  expect(workbench.style.getPropertyValue("--files-width")).toBe("252px");
  expect(filesToggle.getAttribute("aria-pressed")).toBe("true");
  expect(workbench.dataset.agentOpen).toBe("false");
  expect(workbench.style.getPropertyValue("--agent-width")).toBe("0px");
  expect(agentToggle.getAttribute("aria-pressed")).toBe("false");

  teardown();
  stylesheet.remove();
  localStorage.removeItem(SHELL_LAYOUT_KEY);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  root.remove();
});

test("shell: placeholder separators stay out of keyboard order", () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const slots = { mount: (_slot: string, host: HTMLElement) => host.replaceChildren() };
  const workspace = { root: null, activeFile: null, events: { on: () => () => {} } };
  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
  try {
    expect(root.querySelector<HTMLElement>('.rail-resizer[data-side="files"]')?.tabIndex).toBe(0);
    expect(root.querySelector<HTMLElement>('.rail-resizer[data-side="agent"]')?.tabIndex).toBe(0);
  } finally {
    teardown();
    root.remove();
  }
});

test("shell: resize re-clamps open rails and preserves closed widths", () => {
  const originalWidth = window.innerWidth;
  let viewportWidth = 1200;
  Object.defineProperty(window, "innerWidth", { configurable: true, get: () => viewportWidth });
  localStorage.removeItem(SHELL_LAYOUT_KEY);
  saveShellLayout({
    version: 1,
    files: { width: 440, open: true },
    agent: { width: 520, open: true },
  });
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const slots = { mount: (_slot: string, host: HTMLElement) => host.replaceChildren() };
  const workspace = { root: null, activeFile: null, events: { on: () => () => {} } };
  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
  const workbench = root.querySelector<HTMLElement>(".workbench")!;
  const filesHandle = root.querySelector<HTMLElement>('.rail-resizer[data-side="files"]')!;
  const agentHandle = root.querySelector<HTMLElement>('.rail-resizer[data-side="agent"]')!;

  expect(workbench.style.getPropertyValue("--files-width")).toBe("286px");
  expect(workbench.style.getPropertyValue("--agent-width")).toBe("520px");
  viewportWidth = 700;
  window.dispatchEvent(new Event("resize"));
  expect(workbench.style.getPropertyValue("--files-width")).toBe("220px");
  expect(workbench.style.getPropertyValue("--agent-width")).toBe("300px");
  expect(filesHandle.getAttribute("aria-valuenow")).toBe("220");
  expect(filesHandle.getAttribute("aria-valuemax")).toBe("220");
  expect(agentHandle.getAttribute("aria-valuenow")).toBe("300");
  expect(agentHandle.getAttribute("aria-valuemax")).toBe("300");

  root.querySelector<HTMLButtonElement>('[data-rail-toggle="files"]')!.click();
  expect(workbench.style.getPropertyValue("--files-width")).toBe("0px");
  expect(workbench.style.getPropertyValue("--agent-width")).toBe("300px");
  viewportWidth = 1000;
  window.dispatchEvent(new Event("resize"));
  expect(workbench.style.getPropertyValue("--agent-width")).toBe("300px");
  expect(workbench.style.getPropertyValue("--files-width")).toBe("0px");
  expect(agentHandle.getAttribute("aria-valuemax")).toBe("520");
  expect(JSON.parse(localStorage.getItem(SHELL_LAYOUT_KEY)!)).toEqual({
    version: 1,
    files: { width: 220, open: false },
    agent: { width: 300, open: true },
  });

  teardown();
  localStorage.removeItem(SHELL_LAYOUT_KEY);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  root.remove();
});

test("shell: reopening a rail re-clamps stale hidden geometry", () => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 700 });
  localStorage.removeItem(SHELL_LAYOUT_KEY);
  saveShellLayout({
    version: 1,
    files: { width: 440, open: true },
    agent: { width: 520, open: false },
  } satisfies ShellLayoutState);
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const slots = { mount: (_slot: string, host: HTMLElement) => host.replaceChildren() };
  const workspace = { root: null, activeFile: null, events: { on: () => () => {} } };
  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
  const workbench = root.querySelector<HTMLElement>(".workbench")!;
  expect(workbench.style.getPropertyValue("--files-width")).toBe("306px");
  expect(workbench.style.getPropertyValue("--agent-width")).toBe("0px");

  root.querySelector<HTMLButtonElement>('[data-rail-toggle="agent"]')!.click();
  expect(workbench.style.getPropertyValue("--files-width")).toBe("220px");
  expect(workbench.style.getPropertyValue("--agent-width")).toBe("300px");

  teardown();
  localStorage.removeItem(SHELL_LAYOUT_KEY);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  root.remove();
});

test("shell: file-opened 统一维护窗口标题基线", () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const events = new Map<string, (payload?: unknown) => void>();
  const slots = { mount: (_slot: string, host: HTMLElement) => host.replaceChildren() };
  const workspace = {
    root: "/lib",
    activeFile: null as unknown,
    events: { on: (name: string, handler: (payload?: unknown) => void) => {
      events.set(name, handler);
      return () => events.delete(name);
    } },
  };

  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
  const fileOpened = events.get("file-opened")!;
  fileOpened({ name: "v.mp4", kind: "video" });
  expect(document.title).toBe("v.mp4");
  fileOpened({ name: "data.csv", kind: "other" });
  expect(document.title).toBe("data.csv");
  fileOpened(null);
  expect(document.title).toBe("StudyWiki");
  teardown();
  root.remove();
});

test("shell: other 文件显示不支持预览，支持类型恢复查看器", () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const events = new Map<string, (payload?: unknown) => void>();
  const slots = { mount: (_slot: string, host: HTMLElement) => host.replaceChildren() };
  const workspace = {
    root: "/lib",
    activeFile: null as unknown,
    events: { on: (name: string, handler: (payload?: unknown) => void) => {
      events.set(name, handler);
      return () => events.delete(name);
    } },
  };

  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
  const fileOpened = events.get("file-opened")!;
  const unsupported = () => document.querySelector(".unsupported-format");

  const open = (file: unknown): void => {
    workspace.activeFile = file;
    fileOpened(file);
  };
  open({ name: "data.csv", kind: "other" });
  expect(unsupported()?.textContent ?? "").toContain("暂不支持预览该格式");
  expect(unsupported()?.textContent ?? "").toContain("另存为 .xlsx");
  expect(document.querySelector(".main-empty:not(.unsupported-format)")).toBeNull();

  open({ name: "a.md", kind: "markdown" });
  expect(unsupported()).toBeNull();

  workspace.activeFile = null;
  open(null);
  expect(document.querySelector(".main-empty:not(.unsupported-format)")?.textContent).toContain("从左侧选择");
  expect(unsupported()).toBeNull();

  teardown();
  root.remove();
});

test("shell: mounts the sidebar.right slot container", () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const mounted: string[] = [];
  const slots = { mount: (slot: string, host: HTMLElement) => { mounted.push(slot); host.replaceChildren(); } };
  const workspace = { root: null, activeFile: null, events: { on: () => () => {} } };
  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
  expect(mounted).toContain("sidebar.right");
  expect(root.querySelector(".slot-host.sidebar-right")).toBeTruthy();
  teardown();
  root.remove();
});

test("icons: rail toggles expose accessible inline SVGs", () => {
  expect(icon("panel-left").getAttribute("aria-hidden")).toBe("true");
  expect(icon("panel-right").getAttribute("aria-hidden")).toBe("true");
});

function connectPointer(handle: HTMLElement): void {
  handle.setPointerCapture = () => {};
  handle.hasPointerCapture = () => true;
  handle.releasePointerCapture = () => {};
}

test("shell: both rails drag with concession and hide independently", () => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1180 });
  localStorage.removeItem(SHELL_LAYOUT_KEY);
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const slots = { mount: (_slot: string, host: HTMLElement) => host.replaceChildren() };
  const workspace = { root: null, activeFile: null, events: { on: () => () => {} } };
  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
  const body = root.querySelector<HTMLElement>(".workbench")!;
  const files = body.querySelector<HTMLElement>('[data-side="files"]')!;
  const agent = body.querySelector<HTMLElement>('[data-side="agent"]')!;
  connectPointer(files);
  connectPointer(agent);
  try {
    files.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 306, button: 0 }));
    files.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 400 }));
    files.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 400 }));
    expect(body.style.getPropertyValue("--files-width")).toBe("346px");
    expect(body.dataset.filesOpen).toBe("true");

    agent.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 860, button: 0 }));
    agent.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 780 }));
    agent.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 780 }));
    expect(body.style.getPropertyValue("--agent-width")).toBe("400px");
    expect(body.dataset.agentOpen).toBe("true");

    files.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(body.style.getPropertyValue("--files-width")).toBe("252px");
    expect(body.dataset.filesOpen).toBe("true");
  } finally {
    teardown();
    localStorage.removeItem(SHELL_LAYOUT_KEY);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    root.remove();
  }
});

test("shell: drags ignore non-primary pointers and preserve the active pointer", async () => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1180 });
  localStorage.removeItem(SHELL_LAYOUT_KEY);
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const slots = { mount: (_slot: string, host: HTMLElement) => host.replaceChildren() };
  const workspace = { root: null, activeFile: null, events: { on: () => () => {} } };
  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
  const body = root.querySelector<HTMLElement>(".workbench")!;
  const files = body.querySelector<HTMLElement>('[data-side="files"]')!;
  connectPointer(files);
  try {
    files.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 2, clientX: 306, button: 2 }));
    files.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 2, clientX: 400 }));
    files.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 2, clientX: 400 }));
    expect(body.style.getPropertyValue("--files-width")).toBe("252px");
    expect(body.dataset.dragging).toBeUndefined();

    files.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 306, button: 0 }));
    files.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 2, clientX: 600, button: 0 }));
    files.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 400 }));
    await new Promise(requestAnimationFrame);
    expect(body.style.getPropertyValue("--files-width")).toBe("346px");
    files.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 400 }));
    expect(body.style.getPropertyValue("--files-width")).toBe("346px");
    expect(body.dataset.dragging).toBeUndefined();
  } finally {
    teardown();
    localStorage.removeItem(SHELL_LAYOUT_KEY);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    root.remove();
  }
});

test("shell: keyboard separators resize and reset rails", () => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1180 });
  localStorage.removeItem(SHELL_LAYOUT_KEY);
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const slots = { mount: (_slot: string, host: HTMLElement) => host.replaceChildren() };
  const workspace = { root: null, activeFile: null, events: { on: () => () => {} } };
  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
  const body = root.querySelector<HTMLElement>(".workbench")!;
  const files = body.querySelector<HTMLElement>('[data-side="files"]')!;
  const agent = body.querySelector<HTMLElement>('[data-side="agent"]')!;
  try {
    expect(files.tabIndex).toBe(0);
    expect(agent.tabIndex).toBe(0);
    files.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(body.style.getPropertyValue("--files-width")).toBe("268px");
    files.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
    expect(body.style.getPropertyValue("--files-width")).toBe("220px");
    agent.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(body.style.getPropertyValue("--agent-width")).toBe("304px");
    agent.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
    expect(body.style.getPropertyValue("--agent-width")).toBe("520px");
    files.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    expect(body.style.getPropertyValue("--files-width")).toBe("220px");
    files.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
    expect(body.style.getPropertyValue("--files-width")).toBe("266px");
    agent.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
    expect(body.style.getPropertyValue("--agent-width")).toBe("300px");
    agent.dispatchEvent(new KeyboardEvent("dblclick", { bubbles: true }));
    expect(body.style.getPropertyValue("--agent-width")).toBe("320px");
  } finally {
    teardown();
    localStorage.removeItem(SHELL_LAYOUT_KEY);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    root.remove();
  }
});

test("shell: persisted state survives reload, storage updates, and corrupt state falls back", () => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1180 });
  localStorage.setItem(SHELL_LAYOUT_KEY, JSON.stringify({
    version: 1, files: { width: 360, open: false }, agent: { width: 400, open: true },
  }));
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const slots = { mount: (_slot: string, host: HTMLElement) => host.replaceChildren() };
  const workspace = { root: null, activeFile: null, events: { on: () => () => {} } };
  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
  let body = root.querySelector<HTMLElement>(".workbench")!;
  try {
    expect(body.dataset.filesOpen).toBe("false");
    expect(body.style.getPropertyValue("--files-width")).toBe("0px");
    expect(body.dataset.agentOpen).toBe("true");
    expect(body.style.getPropertyValue("--agent-width")).toBe("400px");

    localStorage.setItem(SHELL_LAYOUT_KEY, JSON.stringify({
      version: 1, files: { width: 280, open: true }, agent: { width: 360, open: false },
    }));
    window.dispatchEvent(new StorageEvent("storage", { key: SHELL_LAYOUT_KEY }));
    expect(body.dataset.filesOpen).toBe("true");
    expect(body.style.getPropertyValue("--files-width")).toBe("280px");
    expect(body.dataset.agentOpen).toBe("false");
    expect(body.style.getPropertyValue("--agent-width")).toBe("0px");

    teardown();
    root.remove();
    localStorage.setItem(SHELL_LAYOUT_KEY, "{bad");
    const corruptRoot = document.createElement("div");
    corruptRoot.id = "app";
    document.body.append(corruptRoot);
    const corruptTeardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
    body = corruptRoot.querySelector<HTMLElement>(".workbench")!;
    expect(body.dataset.filesOpen).toBe("true");
    expect(body.style.getPropertyValue("--files-width")).toBe("252px");
    expect(body.dataset.agentOpen).toBe("true");
    expect(body.style.getPropertyValue("--agent-width")).toBe("320px");
    corruptTeardown();
    corruptRoot.remove();
  } finally {
    teardown();
    localStorage.removeItem(SHELL_LAYOUT_KEY);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    if (root.isConnected) root.remove();
  }
});

test("shell: keyboard shortcuts toggle the correct rails", () => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1180 });
  localStorage.removeItem(SHELL_LAYOUT_KEY);
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const slots = { mount: (_slot: string, host: HTMLElement) => host.replaceChildren() };
  const workspace = { root: null, activeFile: null, events: { on: () => () => {} } };
  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
  const body = root.querySelector<HTMLElement>(".workbench")!;
  try {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true }));
    expect(body.dataset.filesOpen).toBe("false");
    expect(body.dataset.agentOpen).toBe("true");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "∫", code: "KeyB", metaKey: true, altKey: true }));
    expect(body.dataset.filesOpen).toBe("false");
    expect(body.dataset.agentOpen).toBe("false");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true }));
    expect(body.dataset.filesOpen).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, altKey: true }));
    expect(body.dataset.agentOpen).toBe("true");
  } finally {
    teardown();
    localStorage.removeItem(SHELL_LAYOUT_KEY);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    root.remove();
  }
});
