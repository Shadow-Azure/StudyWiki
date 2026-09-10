import type { Context } from "cordis";

/** Plugin id in the manifest and the static module table. */
export const name = "app-shell";
/** Service keys awaited before apply runs. */
export const inject = ["files", "workspace", "slots"];

/** Config accepted by the app-shell plugin (manifest `config` merged over defaults). */
export interface ShellConfig {
  /** Application title shown in the topbar. */
  title: string;
}

/** Shell layout: topbar + sidebar + main grid and the three slot containers;
 * with no root open the main area renders the welcome state.
 * @param ctx Host context (files/workspace/slots injected).
 * @param config Shell config (window title).
 * @returns Teardown removing the root-changed subscription. */
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
  const brand = document.createElement("h1");
  brand.textContent = config.title;
  const topbarLeft = document.createElement("div");
  topbarLeft.className = "slot-host topbar-left";
  topbar.append(topbarLeft, brand);
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
  body.append(sidebar, main);
  app.append(topbar, body);

  ctx.slots.mount("topbar.left", topbarLeft);
  ctx.slots.mount("sidebar.tree", treeHost);
  ctx.slots.mount("main.viewer", viewerHost);

  const welcome = document.createElement("div");
  welcome.className = "welcome";
  const hint = document.createElement("p");
  hint.textContent = "打开一个文件夹，开始阅读与笔记。";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "打开文件夹…";
  btn.addEventListener("click", async () => {
    const root = await ctx.files.pickFolder();
    if (root) ctx.workspace.setRoot(root);
  });
  welcome.append(hint, btn);

  const syncWelcome = (): void => {
    if (ctx.workspace.root) {
      welcome.remove();
    } else {
      viewerHost.before(welcome);
    }
  };
  const off = ctx.workspace.events.on("root-changed", syncWelcome);
  syncWelcome();
  return () => off();
}
