import type { Context } from "cordis";
import { labelButton } from "../../ui/dom";
import { icon } from "../../ui/icons";

/** Plugin id in the manifest and the static module table. */
export const name = "app-shell";
/** Service keys awaited before apply runs. */
export const inject = ["files", "windows", "workspace", "slots"];

/** Config accepted by the app-shell plugin (manifest `config` merged over defaults). */
export interface ShellConfig {
  /** Application title shown in the topbar and the welcome state. */
  title: string;
}

const SIDEBAR_MIN = 210;
const SIDEBAR_MAX = 380;
const SIDEBAR_DEFAULT = 252;
const SIDEBAR_KEYBOARD_STEP = 16;

/** Shell layout: topbar (seal brand + actions + active filename) + sidebar + main
 * grid and the three slot containers; with no root open the main area renders the
 * welcome state.
 * @param ctx Host context (files/windows/workspace/slots injected).
 * @param config Shell config (window title).
 * @returns Teardown removing the root-changed / file-opened subscriptions. */
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
  const topbar = document.createElement("header");
  topbar.className = "topbar";
  const brand = document.createElement("div");
  brand.className = "brand";
  const seal = document.createElement("span");
  seal.className = "brand-seal";
  seal.append(icon("iceberg", 14));
  const brandName = document.createElement("span");
  brandName.className = "brand-name";
  brandName.textContent = config.title;
  brand.append(seal, brandName);
  const topbarLeft = document.createElement("div");
  topbarLeft.className = "slot-host topbar-left";
  const fileTitle = document.createElement("div");
  fileTitle.className = "topbar-file";
  topbar.append(brand, fileTitle, topbarLeft);
  const body = document.createElement("div");
  body.className = "body";
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";
  const treeHost = document.createElement("div");
  treeHost.className = "slot-host sidebar-tree";
  sidebar.append(treeHost);
  const main = document.createElement("main");
  main.className = "main";
  const viewerHost = document.createElement("div");
  viewerHost.className = "slot-host main-viewer";
  main.append(viewerHost);
  let sidebarSize = SIDEBAR_DEFAULT;
  const resizer = document.createElement("div");
  resizer.className = "workspace-resizer line-resizer";
  resizer.tabIndex = 0;
  resizer.setAttribute("role", "separator");
  resizer.setAttribute("aria-orientation", "vertical");
  resizer.setAttribute("aria-label", "调整文件树宽度");
  resizer.setAttribute("aria-valuemin", String(SIDEBAR_MIN));
  resizer.setAttribute("aria-valuemax", String(SIDEBAR_MAX));
  resizer.setAttribute("aria-valuenow", String(sidebarSize));
  const resize = (next: number): void => {
    sidebarSize = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(next)));
    body.style.setProperty("--sidebar-size", `${sidebarSize}px`);
    resizer.setAttribute("aria-valuenow", String(sidebarSize));
  };
  const stopDrag = (): void => {
    body.classList.remove("is-resizing");
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", stopDrag);
    document.removeEventListener("pointercancel", stopDrag);
  };
  const onPointerMove = (event: PointerEvent): void => resize(event.clientX);
  resizer.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    body.classList.add("is-resizing");
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", stopDrag);
    document.addEventListener("pointercancel", stopDrag);
  });
  resizer.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      resize(sidebarSize + (event.key === "ArrowRight" ? SIDEBAR_KEYBOARD_STEP : -SIDEBAR_KEYBOARD_STEP));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      resize(event.key === "Home" ? SIDEBAR_MIN : SIDEBAR_MAX);
    }
  });
  body.append(sidebar, resizer, main);
  app.append(topbar, body);

  ctx.slots.mount("topbar.left", topbarLeft);
  ctx.slots.mount("sidebar.tree", treeHost);
  ctx.slots.mount("main.viewer", viewerHost);

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
    if (root) await ctx.windows.changeRoot(ctx.workspace, root);
  });
  welcome.append(welcomeSeal, welcomeTitle, hint, btn);

  // 次级空态：已开库未选文档——主区留一句安静的方向提示，不留白屏。
  const mainEmpty = document.createElement("div");
  mainEmpty.className = "main-empty";
  const emptyHint = document.createElement("p");
  emptyHint.textContent = "从左侧选择一篇文档，开始阅读。";
  mainEmpty.append(emptyHint);

  const syncEmpty = (): void => {
    if (ctx.workspace.root && !ctx.workspace.activeFile) viewerHost.before(mainEmpty);
    else mainEmpty.remove();
  };
  const syncWelcome = (): void => {
    fileTitle.textContent = "";
    syncEmpty();
    if (ctx.workspace.root) {
      welcome.remove();
    } else {
      viewerHost.before(welcome);
    }
  };
  const off = ctx.workspace.events.on("root-changed", syncWelcome);
  const offFile = ctx.workspace.events.on("file-opened", () => {
    fileTitle.textContent = ctx.workspace.activeFile?.name ?? "";
    syncEmpty();
  });
  syncWelcome();
  return () => {
    stopDrag();
    off();
    offFile();
  };
}
