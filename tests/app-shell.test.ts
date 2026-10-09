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
  expect(filesRail.classList.contains("rail")).toBe(true);
  expect(filesRail.classList.contains("files")).toBe(true);
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
  expect(shellStyles).toContain('.workbench[data-files-open="false"] .rail.files > *');
  expect(shellStyles).not.toContain('.workbench[data-files-open="false"] .sidebar > *');
  const filesVisibilityRule = [...stylesheet.sheet?.cssRules ?? []].find((rule): rule is CSSStyleRule =>
    "selectorText" in rule && rule.selectorText.includes('.workbench[data-files-open="false"] .rail.files > *'),
  );
  expect(filesVisibilityRule?.style.visibility).toBe("hidden");
  expect(getComputedStyle(treeHost).visibility).toBe("hidden");

  agentToggle.click();
  expect(workbench.dataset.agentOpen).toBe("false");
  expect(workbench.style.getPropertyValue("--agent-width")).toBe("0px");
  expect(agentToggle.getAttribute("aria-pressed")).toBe("false");
  expect(root.contains(agentRail)).toBe(true);
  expect(root.contains(agentHost)).toBe(true);
  const agentVisibilityRule = [...stylesheet.sheet?.cssRules ?? []].find((rule): rule is CSSStyleRule =>
    "selectorText" in rule && rule.selectorText.includes('.workbench[data-agent-open="false"] .rail.agent > *'),
  );
  expect(agentVisibilityRule?.style.visibility).toBe("hidden");
  expect(getComputedStyle(agentHost).visibility).toBe("hidden");
  expect(shellStyles).not.toContain(".chat-rail");
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

test("shell: rail separators are keyboard focusable and expose limits", () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const slots = { mount: (_slot: string, host: HTMLElement) => host.replaceChildren() };
  const workspace = { root: null, activeFile: null, events: { on: () => () => {} } };
  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });
  try {
    expect(root.querySelector<HTMLElement>('.rail-resizer[data-side="files"]')?.tabIndex).toBe(0);
    expect(root.querySelector<HTMLElement>('.rail-resizer[data-side="files"]')?.getAttribute("aria-valuemin")).toBe("220");
    expect(root.querySelector<HTMLElement>('.rail-resizer[data-side="agent"]')?.tabIndex).toBe(0);
    expect(root.querySelector<HTMLElement>('.rail-resizer[data-side="agent"]')?.getAttribute("aria-valuemin")).toBe("300");
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

test("shell: rail drags use directional movement with viewport concession", () => {
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
    files.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 2 }));
    expect(body.style.getPropertyValue("--files-width")).toBe("346px");
    expect(body.dataset.dragging).toBe("true");
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

test("shell: exact rail shortcuts accept Cmd/Ctrl and Option/Alt only", () => {
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
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true }));
    expect(body.dataset.filesOpen).toBe("false");
    expect(body.dataset.agentOpen).toBe("true");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, shiftKey: true }));
    expect(body.dataset.filesOpen).toBe("false");
    expect(body.dataset.agentOpen).toBe("true");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, altKey: true }));
    expect(body.dataset.filesOpen).toBe("false");
    expect(body.dataset.agentOpen).toBe("false");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, altKey: true, shiftKey: true }));
    expect(body.dataset.filesOpen).toBe("false");
    expect(body.dataset.agentOpen).toBe("false");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "∫", code: "KeyB", metaKey: true, altKey: true }));
    expect(body.dataset.filesOpen).toBe("false");
    expect(body.dataset.agentOpen).toBe("true");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, shiftKey: true }));
    expect(body.dataset.filesOpen).toBe("false");
    expect(body.dataset.agentOpen).toBe("true");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, ctrlKey: true }));
    expect(body.dataset.filesOpen).toBe("false");
    expect(body.dataset.agentOpen).toBe("true");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true }));
    expect(body.dataset.filesOpen).toBe("true");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "∫", code: "KeyB", metaKey: true, altKey: true }));
    expect(body.dataset.agentOpen).toBe("false");
  } finally {
    teardown();
    localStorage.removeItem(SHELL_LAYOUT_KEY);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    root.remove();
  }
});

test("shell: drag frames do not persist and pointercancel restores the captured width", async () => {
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
  const persistedWidth = () => JSON.parse(localStorage.getItem(SHELL_LAYOUT_KEY)!).files.width;
  try {
    files.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 306, button: 0 }));
    files.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 400 }));
    await new Promise(requestAnimationFrame);
    expect(body.style.getPropertyValue("--files-width")).toBe("346px");
    expect(persistedWidth()).toBe(252);

    files.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }));
    expect(body.style.getPropertyValue("--files-width")).toBe("252px");
    expect(persistedWidth()).toBe(252);
    expect(body.dataset.dragging).toBeUndefined();

    files.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 2, clientX: 306, button: 0 }));
    files.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 2, clientX: 400 }));
    files.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 2 }));
    expect(body.style.getPropertyValue("--files-width")).toBe("252px");
    expect(persistedWidth()).toBe(252);
    expect(body.dataset.dragging).toBeUndefined();
  } finally {
    teardown();
    localStorage.removeItem(SHELL_LAYOUT_KEY);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    root.remove();
  }
});

test("shell: pointer-up flushes a pending frame and persists exactly once", async () => {
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
  let saves = 0;
  const nativeSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function setItem(key: string, value: string): void {
    saves += 1;
    nativeSetItem.call(this, key, value);
  };
  try {
    files.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 306, button: 0 }));
    files.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 400 }));
    await new Promise(requestAnimationFrame);
    expect(JSON.parse(localStorage.getItem(SHELL_LAYOUT_KEY)!).files.width).toBe(252);

    files.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 400 }));
    expect(body.style.getPropertyValue("--files-width")).toBe("346px");
    expect(JSON.parse(localStorage.getItem(SHELL_LAYOUT_KEY)!).files.width).toBe(346);
    expect(saves).toBe(1);
    expect(body.dataset.dragging).toBeUndefined();
  } finally {
    Storage.prototype.setItem = nativeSetItem;
    teardown();
    localStorage.removeItem(SHELL_LAYOUT_KEY);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    root.remove();
  }
});

test("shell: incoming storage is ignored until an active drag settles", async () => {
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
    files.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 306, button: 0 }));
    files.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 400 }));
    await new Promise(requestAnimationFrame);
    localStorage.setItem(SHELL_LAYOUT_KEY, JSON.stringify({
      version: 1, files: { width: 280, open: false }, agent: { width: 320, open: true },
    }));
    window.dispatchEvent(new StorageEvent("storage", { key: SHELL_LAYOUT_KEY }));
    expect(body.style.getPropertyValue("--files-width")).toBe("346px");
    expect(body.dataset.filesOpen).toBe("true");

    files.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }));
    expect(body.style.getPropertyValue("--files-width")).toBe("252px");
    expect(body.dataset.filesOpen).toBe("true");
    expect(JSON.parse(localStorage.getItem(SHELL_LAYOUT_KEY)!).files).toEqual({ width: 280, open: false });
  } finally {
    teardown();
    localStorage.removeItem(SHELL_LAYOUT_KEY);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    root.remove();
  }
});

test("shell: teardown releases active capture and restores unsaved drag geometry", async () => {
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
  let released = 0;
  files.setPointerCapture = () => {};
  files.hasPointerCapture = () => true;
  files.releasePointerCapture = () => { released += 1; };
  const persistedWidth = () => JSON.parse(localStorage.getItem(SHELL_LAYOUT_KEY)!).files.width;
  try {
    files.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 306, button: 0 }));
    files.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 400 }));
    await new Promise(requestAnimationFrame);
    expect(body.style.getPropertyValue("--files-width")).toBe("346px");

    teardown();
    expect(body.style.getPropertyValue("--files-width")).toBe("252px");
    expect(persistedWidth()).toBe(252);
    expect(body.dataset.dragging).toBeUndefined();
    expect(released).toBe(1);

    files.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 440 }));
    expect(body.style.getPropertyValue("--files-width")).toBe("252px");
  } finally {
    teardown();
    localStorage.removeItem(SHELL_LAYOUT_KEY);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    root.remove();
  }
});
