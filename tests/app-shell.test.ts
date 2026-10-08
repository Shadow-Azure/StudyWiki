// @vitest-environment jsdom
import { expect, test } from "vitest";
import { icon } from "../src/ui/icons";
import { apply } from "../src/plugins/app-shell";

test("shell: mounts activity rail and collapsible rails", () => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1180 });
  localStorage.removeItem("studywiki.shell-layout.v1");
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
  localStorage.removeItem("studywiki.shell-layout.v1");
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
