import type { Context } from "cordis";
import { labelButton } from "../../ui/dom";
import { icon } from "../../ui/icons";
import { paintTitle } from "../../ui/viewer";
import {
  ACTIVITY_WIDTH,
  AGENT_DEFAULT,
  AGENT_MIN,
  clampRailWidth,
  FILES_DEFAULT,
  FILES_MIN,
  loadShellLayout,
  maxRailWidth,
  saveShellLayout,
  SHELL_LAYOUT_KEY,
  RAIL_KEYBOARD_STEP,
  type RailSide,
} from "./layout";

/** Plugin id in the manifest and the static module table. */
export const name = "app-shell";
/** Service keys awaited before apply runs. */
export const inject = ["files", "windows", "workspace", "slots"];

/** Config accepted by the app-shell plugin (manifest `config` merged over defaults). */
export interface ShellConfig {
  /** Application title shown in the welcome state and window-title baseline. */
  title: string;
}

/** Shell layout: titlebar (rail toggles + active filename), Activity Rail,
 * collapsible files/agent rails, and the reader; main states cover the no-root
 * welcome, no-active-file hint, and explicit unsupported hint for other files.
 * @param ctx Host context (files/windows/workspace/slots injected).
 * @param config Shell config (window title).
 * @returns Teardown removing document/window listeners, drag state, and workspace subscriptions. */
export function apply(ctx: Context, config: ShellConfig): () => void {
  let app = document.getElementById("app");
  if (!app) {
    // 挂载点缺失时自建（jsdom/极简宿主也能起壳；正式 index.html 静态提供）。
    app = document.createElement("div");
    app.id = "app";
    document.body.append(app);
  }
  app.className = "shell";
  app.replaceChildren();
  const titlebar = document.createElement("header");
  titlebar.className = "topbar titlebar";
  const filesToggle = labelButton("panel-left", "", {
    className: "btn btn-ghost icon-btn titlebar-toggle",
    ariaLabel: "显示或隐藏文件栏",
  });
  filesToggle.dataset.railToggle = "files";
  const fileTitle = document.createElement("div");
  fileTitle.className = "topbar-file titlebar-title";
  const agentToggle = labelButton("panel-right", "", {
    className: "btn btn-ghost icon-btn titlebar-toggle",
    ariaLabel: "显示或隐藏 Agent 栏",
  });
  agentToggle.dataset.railToggle = "agent";
  titlebar.append(filesToggle, fileTitle, agentToggle);
  if (/Macintosh/.test(navigator.userAgent)) app.classList.add("is-macos");
  const body = document.createElement("div");
  body.className = "workbench";
  const activity = document.createElement("aside");
  activity.className = "activity";
  const activityHost = document.createElement("div");
  activityHost.className = "slot-host activity-left";
  activity.append(activityHost);
  const sidebar = document.createElement("aside");
  sidebar.className = "rail files";
  const treeHost = document.createElement("div");
  treeHost.className = "slot-host sidebar-tree";
  sidebar.append(treeHost);
  const main = document.createElement("main");
  main.className = "main";
  const viewerHost = document.createElement("div");
  viewerHost.className = "slot-host main-viewer";
  main.append(viewerHost);
  const chatRail = document.createElement("aside");
  chatRail.className = "rail agent";
  const chatHost = document.createElement("div");
  chatHost.className = "slot-host sidebar-right";
  chatRail.append(chatHost);
  let state = loadShellLayout();
  const filesResizer = document.createElement("div");
  filesResizer.className = "workspace-resizer rail-resizer";
  filesResizer.dataset.side = "files";
  filesResizer.tabIndex = 0;
  filesResizer.setAttribute("role", "separator");
  filesResizer.setAttribute("aria-orientation", "vertical");
  filesResizer.setAttribute("aria-label", "调整文件栏宽度");
  const agentResizer = document.createElement("div");
  agentResizer.className = "workspace-resizer rail-resizer";
  agentResizer.dataset.side = "agent";
  agentResizer.tabIndex = 0;
  agentResizer.setAttribute("role", "separator");
  agentResizer.setAttribute("aria-orientation", "vertical");
  agentResizer.setAttribute("aria-label", "调整 Agent 栏宽度");
  // Resize and reopen share one clamp pass: closed widths stay saved, while every
  // rendered rail tracks the latest viewport concession before ARIA/CSS repaint.
  const constrainState = (): void => {
    if (state.files.open) {
      state.files.width = clampRailWidth(
        "files", state.files.width, window.innerWidth,
        state.agent.open ? state.agent.width : 0,
      );
    }
    if (state.agent.open) {
      state.agent.width = clampRailWidth(
        "agent", state.agent.width, window.innerWidth,
        state.files.open ? state.files.width : 0,
      );
    }
  };
  const otherOpenWidth = (side: RailSide): number => {
    const other = side === "files" ? state.agent : state.files;
    return other.open ? other.width : 0;
  };
  const paint = (): void => {
    constrainState();
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
    filesResizer.setAttribute("aria-valuemin", String(FILES_MIN));
    agentResizer.setAttribute("aria-valuemin", String(AGENT_MIN));
    filesResizer.setAttribute("aria-valuemax", String(maxRailWidth(
      "files", window.innerWidth, state.agent.open ? state.agent.width : 0,
    )));
    agentResizer.setAttribute("aria-valuemax", String(maxRailWidth(
      "agent", window.innerWidth, state.files.open ? state.files.width : 0,
    )));
  };
  const toggleRail = (side: RailSide): void => {
    state[side].open = !state[side].open;
    paint();
    saveShellLayout(state);
  };
  const setWidth = (side: RailSide, next: number, options: { persist?: boolean } = {}): void => {
    state[side].width = clampRailWidth(side, next, window.innerWidth, otherOpenWidth(side));
    paint();
    if (options.persist !== false) saveShellLayout(state);
  };
  let activeDragCount = 0;
  const isDragging = (): boolean => activeDragCount > 0;
  const disconnectors: Array<() => void> = [];
  const connectHandle = (handle: HTMLElement, side: RailSide): void => {
    let startX = 0;
    let startWidth = 0;
    let latestX = 0;
    let frame: number | null = null;
    let active = false;
    let pointerId: number | null = null;
    const write = (): void => {
      frame = null;
      const delta = side === "files" ? latestX - startX : startX - latestX;
      setWidth(side, startWidth + delta, { persist: false });
    };
    const cancelGesture = (event?: PointerEvent, restoreWidth = true): void => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (!active) return;
      const capturedId = pointerId;
      active = false;
      pointerId = null;
      activeDragCount -= 1;
      if (
        (event === undefined || event.pointerId === capturedId) &&
        capturedId !== null && handle.hasPointerCapture(capturedId)
      ) {
        handle.releasePointerCapture(capturedId);
      }
      if (activeDragCount === 0) delete body.dataset.dragging;
      // Cancellation is not a settle: return to the geometry captured on down.
      if (restoreWidth) state[side].width = startWidth;
      paint();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || active) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      pointerId = event.pointerId;
      startX = latestX = event.clientX;
      startWidth = state[side].width;
      active = true;
      activeDragCount += 1;
      body.dataset.dragging = "true";
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (!active || event.pointerId !== pointerId || !handle.hasPointerCapture(event.pointerId)) return;
      latestX = event.clientX;
      frame ??= requestAnimationFrame(write);
    };
    const stop = (event: PointerEvent): void => {
      if (!active || event.pointerId !== pointerId) return;
      const hasPendingFrame = frame !== null;
      cancelGesture(event, false);
      // A settle flushes the last coalesced position even if pointerup arrives
      // before the browser runs the scheduled animation frame.
      if (hasPendingFrame) write();
      setWidth(side, state[side].width);
    };
    const onCancel = (event: PointerEvent): void => {
      if (!active || event.pointerId !== pointerId) return;
      cancelGesture(event);
    };
    const onDoubleClick = (): void => {
      state[side].width = side === "files" ? FILES_DEFAULT : AGENT_DEFAULT;
      state[side].open = true;
      paint();
      saveShellLayout(state);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -RAIL_KEYBOARD_STEP : RAIL_KEYBOARD_STEP;
        setWidth(side, state[side].width + direction);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        setWidth(side, event.key === "Home" ? 0 : Number.MAX_SAFE_INTEGER);
      }
    };
    handle.addEventListener("pointerdown", onPointerDown);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", onCancel);
    handle.addEventListener("dblclick", onDoubleClick);
    handle.addEventListener("keydown", onKeyDown);
    disconnectors.push(() => {
      cancelGesture();
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", onCancel);
      handle.removeEventListener("dblclick", onDoubleClick);
      handle.removeEventListener("keydown", onKeyDown);
    });
  };
  connectHandle(filesResizer, "files");
  connectHandle(agentResizer, "agent");
  filesToggle.addEventListener("click", () => toggleRail("files"));
  agentToggle.addEventListener("click", () => toggleRail("agent"));
  body.append(activity, sidebar, filesResizer, main, agentResizer, chatRail);
  app.append(titlebar, body);
  paint();
  saveShellLayout(state);

  ctx.slots.mount("activity.left", activityHost);
  ctx.slots.mount("sidebar.tree", treeHost);
  ctx.slots.mount("main.viewer", viewerHost);
  ctx.slots.mount("sidebar.right", chatHost);

  const welcome = document.createElement("div");
  welcome.className = "welcome";
  const welcomeSeal = document.createElement("div");
  welcomeSeal.className = "welcome-seal";
  welcomeSeal.append(icon("iceberg", 30));
  const welcomeTitle = document.createElement("h2");
  welcomeTitle.textContent = config.title;
  const hint = document.createElement("p");
  hint.textContent = "打开一个文件夹，开始阅读与笔记。";
  const btn = labelButton("folder-open", "打开文件夹…", { className: "btn btn-primary" });
  btn.addEventListener("click", async () => {
    const root = await ctx.files.pickFolder();
    // 换根单路：授权+登记成功才切前端工作区（scope 收空后漏授权即视频 403）。
    if (root) await ctx.windows.changeRoot(root);
  });
  welcome.append(welcomeSeal, welcomeTitle, hint, btn);

  // 次级空态：已开库未选文档——主区留一句安静的方向提示，不留白屏。
  const mainEmpty = document.createElement("div");
  mainEmpty.className = "main-empty";
  const emptyHint = document.createElement("p");
  emptyHint.textContent = "从左侧选择一篇文档，开始阅读。";
  mainEmpty.append(emptyHint);

  // other 文件保留在树中并可点击；主区显式解释为什么不渲染，避免静默无响应。
  const unsupportedFormat = document.createElement("div");
  unsupportedFormat.className = "main-empty unsupported-format";
  const unsupportedTitle = document.createElement("p");
  unsupportedTitle.textContent = "暂不支持预览该格式。";
  const unsupportedHint = document.createElement("p");
  unsupportedHint.textContent = "支持 Markdown、xlsx、视频；Excel 兼容格式可另存为 .xlsx 后重试。";
  unsupportedFormat.append(unsupportedTitle, unsupportedHint);

  const syncMainState = (): void => {
    mainEmpty.remove();
    unsupportedFormat.remove();
    if (!ctx.workspace.root) return;
    if (!ctx.workspace.activeFile) viewerHost.before(mainEmpty);
    else if (ctx.workspace.activeFile.kind === "other") viewerHost.before(unsupportedFormat);
  };
  const syncWelcome = (): void => {
    fileTitle.textContent = "";
    paintTitle(ctx.workspace.activeFile, false, config.title);
    syncMainState();
    if (ctx.workspace.root) {
      welcome.remove();
    } else {
      viewerHost.before(welcome);
    }
  };
  const off = ctx.workspace.events.on("root-changed", syncWelcome);
  const offFile = ctx.workspace.events.on("file-opened", (file) => {
    fileTitle.textContent = file?.name ?? "";
    paintTitle(file, false, config.title);
    syncMainState();
  });
  const syncViewport = (): void => paint();
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== SHELL_LAYOUT_KEY || isDragging()) return;
    state = loadShellLayout();
    paint();
  };
  const onKeydown = (event: KeyboardEvent): void => {
    const isKeyB = event.code === "KeyB" || event.key.toLowerCase() === "b";
    const hasCommandModifier = event.metaKey !== event.ctrlKey;
    if (!isKeyB || !hasCommandModifier || event.shiftKey) return;
    event.preventDefault();
    toggleRail(event.altKey ? "agent" : "files");
  };
  window.addEventListener("resize", syncViewport);
  window.addEventListener("storage", onStorage);
  document.addEventListener("keydown", onKeydown);
  syncWelcome();
  return () => {
    window.removeEventListener("resize", syncViewport);
    window.removeEventListener("storage", onStorage);
    document.removeEventListener("keydown", onKeydown);
    for (const disconnect of disconnectors) disconnect();
    off();
    offFile();
  };
}
