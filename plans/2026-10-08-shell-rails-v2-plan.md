# Shell Rails v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 按已确认原型实现固定 Activity Rail、可拖拽/可折叠的文件栏与 Agent 栏、macOS overlay titlebar 和本机布局持久化。

**Architecture:** `app-shell` 改为 `Activity Rail | Files | Reader | Agent` 四列；纯几何与状态归一化放在 `app-shell/layout.ts`，DOM、手势和事件留在 `app-shell/index.ts`。`topbar.left` 由 `SlotsService` 归一化为 `activity.left`，内置全局命令插件迁移到新槽位。macOS 用 Tauri Overlay Titlebar；非 macOS 保留原生标题栏，应用标题行作为第一行工具栏。

**Tech Stack:** TypeScript + 无框架 DOM、Vite/Vitest(jsdom)、Tauri 2 Rust shell、现有 CSS token 体系。

**Spec:** `.agents/notes/proposed/architecture/2026-10-08-shell-rails-v2.md`

## Global Constraints

- 不新增依赖，不引入 UI 框架；禁止 CDN / 运行时下载。
- `src/plugins/` 禁止 import `@tauri-apps/*`；系统调用仍只经宿主服务。
- Activity Rail 宽度固定 `54px`；Files `220–440px`；Agent `300–520px`；Reader 最小 `340px`。
- 隐藏只由开关或快捷键触发；拖到最小宽度不隐藏栏。
- Agent 栏隐藏后不显示红点。
- 隐藏栏的子树保持挂载，只将宽度设为 0 并隐藏内容。
- 布局存储 key 固定为 `studywiki.shell-layout.v1`；坏数据回退默认，不 fail-loud。
- `topbar.left` 必须继续作为 API v1 兼容别名工作。
- 提交标题中文并带 `(#53)`；改 `src/` 后重建 code map。

## Review Focus

1. **文件栏隐藏**：Activity Rail 必须保留，文件栏恢复时仍在 Activity Rail 右侧；Task 4/5 的 DOM 测试钉住。
2. **两个栏同时打开时的窄窗 clamp**：Activity Rail 和 Reader 最小宽度必须先被保留；Task 1 clamp 测试和 Task 6 resize 测试钉住。
3. **旧外置插件**：`topbar.left` 注册必须出现在 `activity.left` 容器，而不是消失；Task 2 集成测试钉住。
4. **损坏布局数据**：非对象、错误 version、非数字宽度都必须回退默认并保存合法值；Task 1/5 测试钉住。
5. **macOS traffic lights 遮挡**：overlay 下左开关必须从约 78px 内容起点开始；Task 4 结构测试和 Task 7 macOS 手工冒烟共同覆盖。

---

### Task 1: Shell layout 纯状态模块

**Files:**
- Create: `src/plugins/app-shell/layout.ts`
- Test: `tests/app-shell-layout.test.ts`

**Interfaces:**
- Produces:
  - `type RailSide = "files" | "agent"`
  - `interface RailLayout { width: number; open: boolean }`
  - `interface ShellLayoutState { version: 1; files: RailLayout; agent: RailLayout }`
  - `const SHELL_LAYOUT_KEY = "studywiki.shell-layout.v1"`
  - `const ACTIVITY_WIDTH = 54`, `MAIN_MIN = 340`, `RAIL_KEYBOARD_STEP = 16`
  - `maxRailWidth(side: RailSide, viewport: number, otherOpenWidth: number): number`
  - `clampRailWidth(side: RailSide, next: number, viewport: number, otherOpenWidth?: number): number`
  - `normalizeShellLayout(value: unknown, viewport?: number): ShellLayoutState`
  - `defaultShellLayout(): ShellLayoutState`
  - `loadShellLayout(viewport?: number, storage?: Pick<Storage, "getItem"> | null): ShellLayoutState`
  - `saveShellLayout(state: ShellLayoutState, storage?: Pick<Storage, "setItem"> | null): void`

- [x] **Step 1: Write failing tests**

Create `tests/app-shell-layout.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_WIDTH, MAIN_MIN, clampRailWidth, loadShellLayout,
  maxRailWidth, normalizeShellLayout, saveShellLayout, SHELL_LAYOUT_KEY,
  type ShellLayoutState,
} from "../src/plugins/app-shell/layout";

describe("shell layout geometry", () => {
  it("keeps activity rail and reader minimum while clamping either rail", () => {
    expect(ACTIVITY_WIDTH).toBe(54);
    expect(MAIN_MIN).toBe(340);
    expect(maxRailWidth("files", 1180, 320)).toBe(440);
    expect(maxRailWidth("agent", 1180, 252)).toBe(520);
    expect(clampRailWidth("files", 180, 1180, 320)).toBe(220);
    expect(clampRailWidth("files", 900, 1180, 320)).toBe(440);
    expect(clampRailWidth("agent", 900, 1180, 252)).toBe(520);
  });
});

describe("shell layout persistence", () => {
  const valid = (): ShellLayoutState => ({
    version: 1,
    files: { width: 318, open: false },
    agent: { width: 410, open: true },
  });

  it("normalizes valid state and falls back for malformed state", () => {
    expect(normalizeShellLayout({
      version: 1,
      files: { width: 318.4, open: false },
      agent: { width: 410, open: true },
    }, 1180)).toEqual(valid());
    expect(normalizeShellLayout(null, 1180)).toEqual(normalizeShellLayout({ version: 2 }, 1180));
    expect(normalizeShellLayout({ version: 1, files: { width: "x" } }, 1180).files.width).toBe(252);
  });

  it("reads corrupt storage as defaults and writes normalized JSON", () => {
    const store = new Map<string, string>([[SHELL_LAYOUT_KEY, "{bad"]]);
    expect(loadShellLayout(1180, store as unknown as Storage).files.width).toBe(252);
    saveShellLayout(valid(), store as unknown as Storage);
    expect(JSON.parse(store.get(SHELL_LAYOUT_KEY)!).files.width).toBe(318);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/app-shell-layout.test.ts`
Expected: FAIL — `app-shell/layout` 不存在。

- [x] **Step 3: Implement layout.ts**

Create `src/plugins/app-shell/layout.ts`:

```ts
/** Shell layout geometry and local UI-state persistence. DOM is owned by index.ts. */

export type RailSide = "files" | "agent";

/** One collapsible rail's persisted geometry. */
export interface RailLayout {
  /** Rendered width while open, in CSS px. */
  width: number;
  /** False means zero-width but still mounted. */
  open: boolean;
}

/** Versioned shell layout state. */
export interface ShellLayoutState {
  version: 1;
  files: RailLayout;
  agent: RailLayout;
}

/** Local-only UI preference; not a settings.json field. */
export const SHELL_LAYOUT_KEY = "studywiki.shell-layout.v1";
export const ACTIVITY_WIDTH = 54;
export const MAIN_MIN = 340;
export const RAIL_KEYBOARD_STEP = 16;

const RAIL_LIMITS = {
  files: { min: 220, max: 440, fallback: 252 },
  agent: { min: 300, max: 520, fallback: 320 },
} as const;

/** Return the widest rail that still preserves Activity Rail and Reader minimums. */
export function maxRailWidth(side: RailSide, viewport: number, otherOpenWidth: number): number {
  const limits = RAIL_LIMITS[side];
  const available = Math.floor(viewport - ACTIVITY_WIDTH - otherOpenWidth - MAIN_MIN);
  return Math.max(limits.min, Math.min(limits.max, available));
}

/** Clamp a requested width into side limits and the current viewport concession. */
export function clampRailWidth(
  side: RailSide,
  next: number,
  viewport: number,
  otherOpenWidth = 0,
): number {
  if (!Number.isFinite(next)) return RAIL_LIMITS[side].fallback;
  const limits = RAIL_LIMITS[side];
  return Math.round(Math.min(maxRailWidth(side, viewport, otherOpenWidth), Math.max(limits.min, next)));
}

/** Default state is both rails open at prototype widths. */
export function defaultShellLayout(): ShellLayoutState {
  return {
    version: 1,
    files: { width: RAIL_LIMITS.files.fallback, open: true },
    agent: { width: RAIL_LIMITS.agent.fallback, open: true },
  };
}

/** Absolute rail clamp used before the live shell applies viewport concession. */
const clampAbsolute = (side: RailSide, next: unknown): number => {
  const limits = RAIL_LIMITS[side];
  const value = typeof next === "number" && Number.isFinite(next) ? next : limits.fallback;
  return Math.round(Math.min(limits.max, Math.max(limits.min, value)));
};

/** Normalize persisted or cross-window input; invalid fields fall back individually. */
export function normalizeShellLayout(value: unknown, _viewport = window.innerWidth): ShellLayoutState {
  const fallback = defaultShellLayout();
  if (typeof value !== "object" || value === null) return fallback;
  const input = value as Record<string, Record<string, unknown>>;
  if (input.version !== 1) return fallback;
  const rail = (side: RailSide): RailLayout => ({
    width: clampAbsolute(side, input[side]?.width),
    open: typeof input[side]?.open === "boolean" ? input[side].open as boolean : true,
  });
  return { version: 1, files: rail("files"), agent: rail("agent") };
}

/** Read localStorage; absence, throw, or corruption all produce defaults. */
export function loadShellLayout(
  viewport = window.innerWidth,
  storage: Pick<Storage, "getItem"> | null = globalThis.localStorage,
): ShellLayoutState {
  try {
    return normalizeShellLayout(JSON.parse(storage?.getItem(SHELL_LAYOUT_KEY) ?? "null"), viewport);
  } catch {
    return normalizeShellLayout(null, viewport);
  }
}

/** Persist atomically enough for UI state; quota/private-mode failures are non-fatal. */
export function saveShellLayout(
  state: ShellLayoutState,
  storage: Pick<Storage, "setItem"> | null = globalThis.localStorage,
): void {
  try {
    storage?.setItem(SHELL_LAYOUT_KEY, JSON.stringify(state));
  } catch {
    /* UI layout is non-authoritative; continue with in-memory state. */
  }
}
```

If the normalization `otherOpenWidth` heuristic feels imprecise, make normalization clamp each rail independently against its absolute max (`440/520`) and let `index.ts` re-clamp both against the live viewport before paint. Do not lose the live-viewport concession.

- [x] **Step 4: Run tests**

Run: `pnpm exec vitest run tests/app-shell-layout.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/plugins/app-shell/layout.ts tests/app-shell-layout.test.ts
git commit -m "shell：新增布局几何与持久化模型 (#53)"
```

---

### Task 2: Slot v1 兼容别名

**Files:**
- Modify: `src/host/slots.ts`
- Test: `tests/host-workspace-slots.test.ts`

**Interfaces:**
- Produces:
  - `type SlotName = "activity.left" | "sidebar.tree" | "main.viewer" | "sidebar.right"`
  - `type SlotRegistration = SlotName | "topbar.left"`
  - `SlotsService.register(slot: SlotRegistration, render: SlotRenderer): () => void`
  - `topbar.left` internally resolves to `activity.left`.

- [x] **Step 1: Add failing integration test**

Append to `tests/host-workspace-slots.test.ts`:

```ts
test("slots: topbar.left is an activity.left compatibility alias", () => {
  const slots = new SlotsService();
  const host = document.createElement("div");
  slots.register("activity.left", (el) => { el.textContent = "new"; });
  slots.register("topbar.left", (el) => {
    const button = document.createElement("button");
    button.textContent = "legacy";
    el.append(button);
  });
  slots.mount("activity.left", host);
  expect(host.textContent).toContain("new");
  expect(host.querySelector("button")?.textContent).toBe("legacy");
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/host-workspace-slots.test.ts`
Expected: TypeScript FAIL — `topbar.left` 不在 `SlotName`。

- [x] **Step 3: Implement alias normalization**

Modify `src/host/slots.ts`:

```ts
/** All current slot names the shell mounts. */
export type SlotName = "activity.left" | "sidebar.tree" | "main.viewer" | "sidebar.right";
/** API v1 external plugins may still register the old topbar slot. */
export type SlotRegistration = SlotName | "topbar.left";

const SLOT_ALIASES: Record<string, SlotName> = { "topbar.left": "activity.left" };

const normalizeSlot = (slot: SlotRegistration): SlotName => SLOT_ALIASES[slot] ?? slot;
```

Change the `#entries` map, `register`, and slot class naming to use:

```ts
const key = normalizeSlot(slot);
```

Keep `mount(slot: SlotName, container: HTMLElement)` unchanged. The slot CSS class becomes `slot-activity-left` for both new and legacy registrations.

- [x] **Step 4: Run slot tests**

Run: `pnpm exec vitest run tests/host-workspace-slots.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/host/slots.ts tests/host-workspace-slots.test.ts
git commit -m "shell：兼容 topbar 槽位到 Activity Rail (#53)"
```

---

### Task 3: Panel toggle icons

**Files:**
- Modify: `src/ui/icons.ts`
- Test: `tests/ui-viewer.test.ts` or a new focused assertion inside `tests/app-shell.test.ts`

**Interfaces:**
- Produces new `IconName` values: `"panel-left"`, `"panel-right"`.

- [x] **Step 1: Add failing icon test**

Append to `tests/app-shell.test.ts` temporarily in Task 4 or add this focused test now:

```ts
import { icon } from "../src/ui/icons";

test("icons: rail toggles expose accessible inline SVGs", () => {
  expect(icon("panel-left").getAttribute("aria-hidden")).toBe("true");
  expect(icon("panel-right").getAttribute("aria-hidden")).toBe("true");
});
```

Run: `pnpm exec vitest run tests/app-shell.test.ts`
Expected: TypeScript FAIL — icon names absent.

- [x] **Step 2: Implement icons**

Add to `ICONS` in `src/ui/icons.ts`:

```ts
"panel-left": [
  ["rect", { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2 }],
  ["path", { d: "M6 2.5v11" }],
  ["path", { d: "M2.8 2.5H6v11H2.8z", fill: "currentColor", stroke: "none" }],
],
"panel-right": [
  ["rect", { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2 }],
  ["path", { d: "M10 2.5v11" }],
  ["path", { d: "M10 2.5h3.2a1.3 1.3 0 0 1 1.3 1.3v8.4a1.3 1.3 0 0 1-1.3 1.3H10z", fill: "currentColor", stroke: "none" }],
],
```

- [x] **Step 3: Run tests**

Run: `pnpm exec vitest run tests/app-shell.test.ts`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/ui/icons.ts tests/app-shell.test.ts
git commit -m "shell：新增侧栏开关图标 (#53)"
```

---

### Task 4: Four-column shell structure and titlebar

**Files:**
- Modify: `src/plugins/app-shell/index.ts`
- Modify: `src/styles.css`
- Modify: `tests/app-shell.test.ts`
- Modify: `tests/ui-preview.test.ts`

**Interfaces:**
- Consumes: `loadShellLayout`, `saveShellLayout`, `ACTIVITY_WIDTH`, `clampRailWidth`, `defaultShellLayout` from Task 1.
- Consumes: `activity.left` from Task 2 and `panel-left/panel-right` from Task 3.
- Produces DOM contracts:
  - `.titlebar`, `.titlebar-title`
  - `[data-rail-toggle="files"]`, `[data-rail-toggle="agent"]`
  - `.activity`, `.slot-host.activity-left`
  - `.workbench`, `.rail.files`, `.rail.agent`
  - `.rail-resizer[data-side="files|agent"]`
  - `body.workbench[data-files-open="true|false"]`, `[data-agent-open="true|false"]`

- [x] **Step 1: Write failing structure tests**

Replace old topbar brand expectations in `tests/app-shell.test.ts` and add:

```ts
test("shell: mounts activity rail and collapsible rails", () => {
  const root = document.createElement("div");
  root.id = "app";
  document.body.append(root);
  const mounted: string[] = [];
  const slots = { mount: (slot: string, host: HTMLElement) => { mounted.push(slot); host.replaceChildren(); } };
  const workspace = { root: null, activeFile: null, events: { on: () => () => {} } };
  const teardown = apply({ slots, workspace } as never, { title: "StudyWiki" });

  expect(mounted).toEqual(expect.arrayContaining(["activity.left", "sidebar.tree", "main.viewer", "sidebar.right"]));
  expect(root.querySelector(".activity .slot-host.activity-left")).toBeTruthy();
  expect(root.querySelector(".brand-seal")).toBeNull();
  expect(root.querySelector<HTMLElement>(".workbench")?.dataset.filesOpen).toBe("true");
  expect(root.querySelector<HTMLElement>(".workbench")?.dataset.agentOpen).toBe("true");
  const filesToggle = root.querySelector<HTMLButtonElement>('[data-rail-toggle="files"]')!;
  expect(filesToggle.getAttribute("aria-pressed")).toBe("true");
  filesToggle.click();
  expect(root.querySelector<HTMLElement>(".workbench")?.dataset.filesOpen).toBe("false");
  expect(root.querySelector(".activity")).toBeTruthy();
  expect(filesToggle.getAttribute("aria-pressed")).toBe("false");
  teardown();
  root.remove();
});
```

Update `tests/ui-preview.test.ts` so plugin manager is located from `.activity-left button`, not `.topbar-left button`; remove brand/topbar children assertions.

- [x] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/app-shell.test.ts tests/ui-preview.test.ts`
Expected: FAIL — activity rail/toggles absent.

- [x] **Step 3: Build DOM structure**

In `app-shell/index.ts`:

- Import layout functions.
- Remove `.brand`, `.brand-seal`, `.brand-name`, and `topbarLeft` from titlebar.
- Create titlebar:

```ts
const titlebar = document.createElement("header");
titlebar.className = "topbar";
const filesToggle = labelButton("panel-left", "", {
  className: "btn btn-ghost icon-btn titlebar-toggle",
  ariaLabel: "显示或隐藏文件栏",
});
filesToggle.dataset.railToggle = "files";
const fileTitle = document.createElement("div");
fileTitle.className = "topbar-file";
const agentToggle = labelButton("panel-right", "", {
  className: "btn btn-ghost icon-btn titlebar-toggle",
  ariaLabel: "显示或隐藏 Agent 栏",
});
agentToggle.dataset.railToggle = "agent";
titlebar.append(filesToggle, fileTitle, agentToggle);
if (/Macintosh/.test(navigator.userAgent)) app.classList.add("is-macos");
```

- Create body as `.workbench` with first column:

```ts
const activity = document.createElement("aside");
activity.className = "activity";
const activityHost = document.createElement("div");
activityHost.className = "slot-host activity-left";
activity.append(activityHost);
```

- Keep `.sidebar` as `class="rail files"` and `.chat-rail` as `class="rail agent"`.
- Add empty drag placeholders in this task:

```ts
const filesResizer = document.createElement("div");
filesResizer.className = "workspace-resizer rail-resizer";
filesResizer.dataset.side = "files";
const agentResizer = document.createElement("div");
agentResizer.className = "workspace-resizer rail-resizer";
agentResizer.dataset.side = "agent";
```

- Change grid paint:

```ts
const paint = (): void => {
  const filesWidth = state.files.open ? state.files.width : 0;
  const agentWidth = state.agent.open ? state.agent.width : 0;
  body.style.setProperty("--activity-width", `${ACTIVITY_WIDTH}px`);
  body.style.setProperty("--files-width", `${filesWidth}px`);
  body.style.setProperty("--agent-width", `${agentWidth}px`);
  body.dataset.filesOpen = String(state.files.open);
  body.dataset.agentOpen = String(state.agent.open);
  filesToggle.setAttribute("aria-pressed", String(state.files.open));
  agentToggle.setAttribute("aria-pressed", String(state.agent.open));
  filesResizer.setAttribute("aria-valuenow", String(state.files.width));
  agentResizer.setAttribute("aria-valuenow", String(state.agent.width));
  filesResizer.setAttribute("aria-valuemax", String(maxRailWidth("files", window.innerWidth, state.agent.open ? state.agent.width : 0)));
  agentResizer.setAttribute("aria-valuemax", String(maxRailWidth("agent", window.innerWidth, state.files.open ? state.files.width : 0)));
};
```

- Toggle click handlers:

```ts
const toggleRail = (side: RailSide): void => {
  state[side].open = !state[side].open;
  paint();
  saveShellLayout(state);
};
filesToggle.addEventListener("click", () => toggleRail("files"));
agentToggle.addEventListener("click", () => toggleRail("agent"));
```

- Mount `activity.left`; do **not** mount `topbar.left`.
- Keep welcome screen and main empty-state behavior unchanged.

- [x] **Step 4: Replace shell CSS**

In `src/styles.css`, replace `.topbar`, `.brand*`, `.workspace-resizer`, `.sidebar`, and `.chat-rail` blocks with the white four-column system:

```css
.shell { display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100vh; background: var(--paper); }
.topbar {
  position: relative; display: grid; align-items: center;
  grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px;
  height: 40px; padding: 0 8px; border-bottom: 1px solid var(--hairline);
  background: var(--paper); -webkit-app-region: drag;
}
.is-macos .topbar { padding-left: 78px; }
.topbar button, .topbar input, .topbar select { -webkit-app-region: no-drag; }
.titlebar-toggle { width: 30px; height: 28px; border: 0; border-radius: 7px; background: transparent; color: var(--ink-3); cursor: pointer; }
.titlebar-toggle:hover { background: var(--wash); color: var(--ink); }
.titlebar-toggle[aria-pressed="true"] { background: var(--azurite-wash); color: var(--azurite); }
.topbar-file { min-width: 0; padding: 0 8px; text-align: center; color: var(--ink-2); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.workbench {
  position: relative; min-height: 0; display: grid;
  grid-template-columns: var(--activity-width, 54px) var(--files-width, 252px) minmax(340px, 1fr) var(--agent-width, 320px);
  transition: grid-template-columns .24s cubic-bezier(.33, 1, .68, 1);
}
.workbench.is-resizing, .workbench[data-dragging] { transition: none; cursor: col-resize; user-select: none; }
.activity { min-width: 0; overflow: auto; padding: 7px 0 10px; background: var(--paper); border-right: 1px solid var(--hairline); }
.activity .slot { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.activity .icon-btn { width: 38px; height: 36px; border-radius: 9px; }
.sidebar, .chat-rail { min-width: 0; overflow: hidden; }
.sidebar { background: #fafbfc; border-right: 1px solid var(--hairline); }
.chat-rail { background: var(--paper); border-left: 1px solid var(--hairline); }
.workbench[data-files-open="false"] { --files-width: 0px; }
.workbench[data-agent-open="false"] { --agent-width: 0px; }
.workbench[data-files-open="false"] .sidebar,
.workbench[data-agent-open="false"] .chat-rail { border: 0; }
.workbench[data-files-open="false"] .sidebar > *,
.workbench[data-agent-open="false"] .chat-rail > * { visibility: hidden; }
```

Define `.workspace-resizer` with `width: 12px`, left/right positioning by side, transparent background, hover/drag blue line and a `34px` vertical pill. Use `left: var(--activity-width)` plus `calc(var(--files-width))` for files, and `right: var(--agent-width)` for agent; hide a handle when its rail is closed.

- [x] **Step 5: Run tests**

Run: `pnpm exec vitest run tests/app-shell.test.ts tests/ui-preview.test.ts tests/view-filetree.test.ts tests/app-agent.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/plugins/app-shell/index.ts src/styles.css tests/app-shell.test.ts tests/ui-preview.test.ts
git commit -m "shell：实现 Activity Rail 与双栏折叠结构 (#53)"
```

---

### Task 5: Drag, keyboard, shortcuts and persistence wiring

**Files:**
- Modify: `src/plugins/app-shell/index.ts`
- Modify: `tests/app-shell.test.ts`

**Interfaces:**
- Consumes: `RAIL_KEYBOARD_STEP`, `clampRailWidth`, `maxRailWidth`, `saveShellLayout`, `loadShellLayout`.
- Produces:
  - `toggleRail(side: RailSide): void`
  - `setWidth(side: RailSide, next: number, options?: { persist?: boolean }): void`
  - Handles support pointer drag, double-click reset, `ArrowLeft/ArrowRight`, `Home/End`.
  - Document shortcuts `Cmd/Ctrl+B` and `Cmd/Ctrl+Option/Alt+B`.

- [x] **Step 1: Add failing interaction tests**

Add to `tests/app-shell.test.ts`:

```ts
function connectPointer(handle: HTMLElement): void {
  handle.setPointerCapture = () => {};
  handle.hasPointerCapture = () => true;
  handle.releasePointerCapture = () => {};
}

test("shell: both rails drag with concession and hide independently", () => {
  // Mount shell with a fake slots/workspace as above.
  const body = root.querySelector<HTMLElement>(".workbench")!;
  const files = body.querySelector<HTMLElement>('[data-side="files"]')!;
  const agent = body.querySelector<HTMLElement>('[data-side="agent"]')!;
  connectPointer(files);
  connectPointer(agent);

  files.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 306, button: 0 }));
  files.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 400 }));
  files.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 400 }));
  expect(body.style.getPropertyValue("--files-width")).toBe("346px");

  agent.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 860, button: 0 }));
  agent.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 780 }));
  agent.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 780 }));
  expect(body.style.getPropertyValue("--agent-width")).toBe("400px");

  files.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  expect(body.style.getPropertyValue("--files-width")).toBe("252px");
});

test("shell: persisted state survives reload and corrupt state falls back", () => {
  localStorage.setItem("studywiki.shell-layout.v1", JSON.stringify({
    version: 1, files: { width: 360, open: false }, agent: { width: 400, open: true },
  }));
  // Mount a second shell and assert files 0/open=false, agent 400/open=true.
  localStorage.setItem("studywiki.shell-layout.v1", "{bad");
  // Mount again and assert defaults.
});

test("shell: keyboard shortcuts toggle the correct rails", () => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true }));
  expect(body.dataset.filesOpen).toBe("false");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, altKey: true }));
  expect(body.dataset.agentOpen).toBe("false");
});
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/app-shell.test.ts`
Expected: FAIL — drag/shortcuts do not act.

- [x] **Step 3: Implement gesture controller**

Add inside `apply`:

```ts
const otherOpenWidth = (side: RailSide): number => {
  const other = side === "files" ? state.agent : state.files;
  return other.open ? other.width : 0;
};

const setWidth = (side: RailSide, next: number, options: { persist?: boolean } = {}): void => {
  state[side].width = clampRailWidth(side, next, window.innerWidth, otherOpenWidth(side));
  paint();
  if (options.persist !== false) saveShellLayout(state);
};

const connectHandle = (handle: HTMLElement, side: RailSide): void => {
  let startX = 0;
  let startWidth = 0;
  let latestX = 0;
  let frame: number | null = null;

  const write = (): void => {
    frame = null;
    const delta = side === "files" ? latestX - startX : startX - latestX;
    setWidth(side, startWidth + delta, { persist: false });
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    startX = latestX = event.clientX;
    startWidth = state[side].width;
    body.dataset.dragging = "true";
  });
  handle.addEventListener("pointermove", (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    latestX = event.clientX;
    frame ??= requestAnimationFrame(write);
  });
  const stop = (event: PointerEvent): void => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    handle.releasePointerCapture(event.pointerId);
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    delete body.dataset.dragging;
    setWidth(side, state[side].width);
  };
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
  handle.addEventListener("dblclick", () => {
    state[side].width = side === "files" ? FILES_DEFAULT : AGENT_DEFAULT;
    state[side].open = true;
    paint();
    saveShellLayout(state);
  });
  handle.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -RAIL_KEYBOARD_STEP : RAIL_KEYBOARD_STEP;
      setWidth(side, state[side].width + direction);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setWidth(side, event.key === "Home" ? 0 : Number.MAX_SAFE_INTEGER);
    }
  });
};
```

For `Home`, clamp resolves to that rail’s minimum; for `End`, clamp resolves to its live maximum. Export or derive defaults in `layout.ts` if needed: `FILES_DEFAULT = 252`, `AGENT_DEFAULT = 320`.

- [x] **Step 4: Add persistence and shortcut lifecycle**

During mount:

```ts
state = loadShellLayout();
state.files.width = clampRailWidth("files", state.files.width, window.innerWidth, otherOpenWidth("files"));
state.agent.width = clampRailWidth("agent", state.agent.width, window.innerWidth, otherOpenWidth("files"));
paint();
saveShellLayout(state);
```

On window resize, re-clamp both and `paint({ persist: false })` without changing open flags. On `storage`, if `event.key === SHELL_LAYOUT_KEY`, reload state and repaint without saving. Add document keydown shortcuts and remove them in teardown. Ensure `stopDrag`/cancel logic handles every active handle and removes `resize`, `storage`, and document `keydown` listeners in teardown.

- [x] **Step 5: Run tests**

Run: `pnpm exec vitest run tests/app-shell.test.ts tests/app-shell-layout.test.ts`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/plugins/app-shell/index.ts tests/app-shell.test.ts
git commit -m "shell：实现双栏拖拽与布局记忆 (#53)"
```

---

### Task 6: macOS overlay titlebar and dynamic windows

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/windows.rs`

**Interfaces:**
- Produces: main and `win-*` windows use macOS overlay titlebar, hidden native title, traffic light position `(12, 12)`, and minimum inner size `920x480`.

- [x] **Step 1: Apply static window config**

In `src-tauri/tauri.conf.json`, change the first window object:

```json
{
  "title": "StudyWiki",
  "width": 1180,
  "height": 760,
  "minWidth": 920,
  "minHeight": 480,
  "titleBarStyle": "Overlay",
  "hiddenTitle": true,
  "trafficLightPosition": { "x": 12, "y": 12 }
}
```

- [x] **Step 2: Apply dynamic window settings**

Modify `create_window` in `src-tauri/src/windows.rs`:

```rust
let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::default())
    .title("StudyWiki")
    .inner_size(1180.0, 760.0)
    .min_inner_size(920.0, 480.0);

#[cfg(target_os = "macos")]
{
    builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(12.0, 12.0));
}

if let Err(e) = builder.build() {
    // existing rollback path remains unchanged
}
```

Keep the existing registry rollback exactly where it is; do not remove the window from the registry before `build()` fails.

- [x] **Step 3: Verify compile**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/src/windows.rs
git commit -m "shell：接入 macOS overlay 标题栏 (#53)"
```

---

### Task 7: Migrate global command plugins to Activity Rail

**Files:**
- Modify: `src/plugins/app-windows/index.ts`
- Modify: `src/plugins/plugin-manager/index.ts`
- Modify: `src/plugins/llm-settings/index.ts`
- Modify: `tests/app-windows.test.ts`
- Modify: `tests/plugin-manager.test.ts`
- Modify: `tests/llm-settings.test.ts`

**Interfaces:**
- Consumes: `activity.left`.
- Produces Activity Rail order: `打开文件夹 → 新建窗口 → 插件 → 模型`.
- Produces command button class: `btn btn-ghost icon-btn activity-item`.

- [x] **Step 1: Update failing registration tests**

For each global-command test, change the asserted slot string from `topbar.left` to `activity.left`. For `app-windows`, assert DOM order and classes:

```ts
const [openBtn, newBtn] = [...document.querySelectorAll<HTMLButtonElement>("button")];
expect(openBtn.getAttribute("aria-label")).toBe("打开文件夹…");
expect(newBtn.getAttribute("aria-label")).toBe("新建窗口");
expect([openBtn, newBtn].every((button) => button.classList.contains("activity-item"))).toBe(true);
```

For plugin manager and LLM settings, assert `slots.register` received `"activity.left"` and button class contains `activity-item`.

- [x] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run tests/app-windows.test.ts tests/plugin-manager.test.ts tests/llm-settings.test.ts`
Expected: FAIL — plugins still register `topbar.left` and use old classes.

- [x] **Step 3: Migrate registrations**

- `app-windows`: change `register("topbar.left"` to `register("activity.left"`; append `openBtn` first, then `newBtn`; use class `btn btn-ghost icon-btn activity-item`.
- `plugin-manager`: register `activity.left`; button class `btn btn-ghost icon-btn activity-item`.
- `llm-settings`: register `activity.left`; button class `btn btn-ghost icon-btn activity-item`.

Do not change command behavior, root forwarding, plugin panel focus handling, or LLM settings IPC.

- [x] **Step 4: Run tests**

Run: `pnpm exec vitest run tests/app-windows.test.ts tests/plugin-manager.test.ts tests/llm-settings.test.ts tests/host-workspace-slots.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/plugins/app-windows/index.ts src/plugins/plugin-manager/index.ts src/plugins/llm-settings/index.ts tests/app-windows.test.ts tests/plugin-manager.test.ts tests/llm-settings.test.ts
git commit -m "shell：迁移全局命令到 Activity Rail (#53)"
```

---

### Task 8: Contract, architecture map and generated docs

**Files:**
- Modify: `docs/plugins/contract.md`
- Modify: `docs/plugins/contract.en.md`
- Modify: `docs/architecture.md`
- Modify: `docs/architecture.en.md`
- Modify: `scripts/code-map.manifest.json`
- Modify: `.agents/flow/issues/m2-shell-rails-v2.md`
- Modify: `.agents/flow/issues/m2-shell-rails-v2.en.md`
- Move after implementation: `.agents/notes/proposed/architecture/2026-10-08-shell-rails-v2.*` → `.agents/notes/implemented/architecture/2026-10-08-shell-rails-v2.*`

**Interfaces:**
- Documentation-only task; no runtime interface change.

- [x] **Step 1: Update plugin contract**

In both contract pages, state:

- Current slot set is `activity.left`, `sidebar.tree`, `main.viewer`, `sidebar.right`.
- `topbar.left` remains accepted by API v1 and is normalized to `activity.left`.
- New external plugins should register `activity.left`.
- Keep both code fences exactly mirrored; update the example to `activity.left` on both sides.

- [x] **Step 2: Update architecture descriptions**

Update `scripts/code-map.manifest.json` text for:

- `src/host/slots.ts`: typed slot registry plus v1 `topbar.left → activity.left` normalization.
- `src/plugins/app-shell/index.ts`: four-column shell, rail toggles, drag handles, activity rail and title baseline.
- `src/plugins/app-shell/layout.ts`: rail geometry, normalization and localStorage persistence.
- `app-windows`, `plugin-manager`, `llm-settings`: activity rail entries rather than topbar entries.

Run:

```bash
pnpm gen:code-map
```

Do not hand-edit generated architecture blocks.

- [x] **Step 3: Update issue and note state**

After implementation is verified:

- Set issue status to `done` in both flow files and link the implemented ADR path.
- Move the note triad from `.agents/notes/proposed/architecture/` to `.agents/notes/implemented/architecture/`.
- Change both note `Status:` values from `proposed` to `implemented`.
- Update ADR paths in both flow fences to the implemented note path; keep both YAML fences byte-for-byte identical except for generated locale-projected paths if the tooling requires.
- Rewrite note Consequences to present tense and remove “proposed” wording.

Run:

```bash
pnpm record:i18n -- .agents/notes/implemented/architecture/2026-10-08-shell-rails-v2.md
pnpm record:i18n -- .agents/flow/issues/m2-shell-rails-v2.md
pnpm lint:docs
```

Expected: all doc gates PASS.

- [x] **Step 4: Commit**

```bash
git add docs/plugins/contract.md docs/plugins/contract.en.md docs/architecture.md docs/architecture.en.md scripts/code-map.manifest.json docs/architecture.md docs/architecture.en.md .agents/flow/issues/m2-shell-rails-v2.md .agents/flow/issues/m2-shell-rails-v2.en.md .agents/flow/issues/m2-shell-rails-v2.i18n.yaml .agents/notes/implemented/architecture/2026-10-08-shell-rails-v2.md .agents/notes/implemented/architecture/2026-10-08-shell-rails-v2.en.md .agents/notes/implemented/architecture/2026-10-08-shell-rails-v2.i18n.yaml
git commit -m "docs：登记 Activity Rail 壳布局实现 (#53)"
```

---

### Task 9: Whole-feature verification and packaged smoke

**Files:**
- No planned source changes; fix regressions in the owning task files if found.

**Interfaces:**
- Consumes every prior task contract.

- [x] **Step 1: Run full local gates**

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm verify:layering
pnpm lint:docs
pnpm verify:flow
```

Expected: all PASS.

- [x] **Step 2: Run release app bundle**

```bash
pnpm tauri build --bundles app
```

Expected: `.app` bundle succeeds. If DMG bundling is needed for release, run it separately and record any local tooling failure without treating it as this feature’s UI gate.

- [x] **Step 3: Manual macOS smoke**

Install the built `.app`, then verify each behavior with Computer Use or manual interaction:

1. Traffic lights do not cover the Files toggle; left toggle starts after the native controls.
2. `SW + StudyWiki` brand is absent from the in-app title row.
3. Activity Rail is white, fixed, and contains Open Folder, New Window, Plugins, Models.
4. Drag Files handle; drag Agent handle; hover shows blue line and vertical pill.
5. Hide Files: Activity Rail remains. Hide Agent: toggle has no red dot.
6. Double-click each handle resets width.
7. Restart app: widths and open/closed states restore.
8. Register the external `hello` sample and confirm its legacy `topbar.left` button appears in Activity Rail.
9. Open Agent and run one approval turn to confirm popover positioning and composer behavior still work after the shell change.

- [x] **Step 4: Record smoke evidence**

Save screenshots under `plans/smoke-test/` (already ignored). If defects are found, classify them into the owning task, fix with tests, and rerun this task. Do not add product fixes without their failing test.

- [x] **Step 5: Final commit if smoke produced fixes**

```bash
git status --short
git add <only files required by the regression fix>
git commit -m "shell：修复 Activity Rail 冒烟回归 (#53)"
```
