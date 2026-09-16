import type { Context } from "cordis";
import type { Manifest } from "../../loader/manifest";
import { labelButton } from "../../ui/dom";
import { computePanelRows, withEnabled, withoutRow, type PanelRow } from "./model";

/** Plugin id in the manifest and the static module table. */
export const name = "plugin-manager";
/** Service keys awaited before apply runs. */
export const inject = ["plugins", "slots"];

/** 插件管理面板（第六内置插件）：顶栏"插件"按钮开合；列已装（内置+外置）、
 * 按名安装、本地导入、启用开关、外置移除；一切改动写清单后提示重启生效
 * （Phase 2 无热装载）。操作失败内联显示错误，不静默。
 * @param ctx Host context（plugins/slots injected）。
 * @returns Teardown removing the topbar button. */
export function apply(ctx: Context): () => void {
  return ctx.slots.register("topbar.left", (el) => {
    const btn = labelButton("module", "", { className: "btn btn-ghost icon-btn", ariaLabel: "插件" });
    btn.title = "插件";
    btn.addEventListener("click", () => void openPanel(ctx, btn));
    el.append(btn);
  });
}

/** 面板本体：模态覆盖层（Esc 可关）；每次操作后整体重渲染（状态简单，不值得细粒度更新）。 */
async function openPanel(ctx: Context, opener: HTMLButtonElement): Promise<void> {
  document.querySelector(".plugin-panel")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "plugin-panel";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "插件管理");
  const box = document.createElement("div");
  box.className = "plugin-panel-box";
  overlay.append(box);
  document.body.append(overlay);
  // Esc/Tab 挂 document 而非 overlay：整体重渲染会销毁焦点元素、焦点回落 body，
  // 事件不再路过 overlay 子树；模态焦点边界和键盘出口都不能断。
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
    else if (e.key === "Tab") trapFocus(e);
  };
  const trapFocus = (e: KeyboardEvent): void => {
    const focusable = [...box.querySelectorAll<HTMLElement>(
      "input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])",
    )];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !box.contains(active))) {
      e.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!e.shiftKey && (active === last || !box.contains(active))) {
      e.preventDefault();
      first.focus({ preventScroll: true });
    }
  };
  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    opener.focus({ preventScroll: true });
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  // 错误行与重启提示是同一元素跨 render 复用（render 的 replaceChildren 会重建
  // 其余节点）：失败内联显示才能在整体重渲染后仍可见，成功时清除旧错误。
  const errLine = document.createElement("p");
  errLine.className = "plugin-error";
  errLine.hidden = true;
  const hint = document.createElement("p");
  hint.className = "plugin-restart-hint";
  hint.hidden = true;
  hint.textContent = "已保存——重启应用后生效。";
  const showError = (e: unknown) => {
    errLine.textContent = `操作失败：${e instanceof Error ? e.message : String(e)}`;
    errLine.hidden = false;
  };
  const noteSaved = () => {
    hint.hidden = false;
    errLine.hidden = true;
  };
  const render = async () => {
    try {
      const raw = await ctx.plugins.readManifest();
      let manifest: Manifest;
      try {
        manifest = JSON.parse(raw ?? '{"plugins":[]}') as Manifest;
      } catch (e) {
        box.replaceChildren(errorLine(`清单读取失败：${(e as Error).message}`));
        return;
      }
      const entries = await ctx.plugins.list();
      const rows = computePanelRows(manifest, entries, ctx.plugins.bootBroken);
      const list = document.createElement("div");
      list.className = "plugin-list";
      for (const row of rows) list.append(rowEl(ctx, row, manifest, render, showError, noteSaved));
      const title = document.createElement("h2");
      title.className = "plugin-panel-title";
      title.textContent = "插件";
      const head = document.createElement("div");
      head.className = "plugin-panel-head";
      const installInput = document.createElement("input");
      installInput.type = "text";
      installInput.placeholder = "包名或 包名@版本";
      installInput.setAttribute("aria-label", "安装包名");
      head.append(
        installInput,
        button("安装", "btn", async () => {
          const spec = installInput.value.trim();
          if (!spec) return;
          try {
            await ctx.plugins.install(spec);
            noteSaved();
          } catch (e) {
            showError(e);
          }
          await render();
        }),
        button("本地导入…", "btn", async () => {
          try {
            await ctx.plugins.importFromTgz();
            noteSaved();
          } catch (e) {
            showError(e);
          }
          await render();
        }),
        button("关闭", "btn btn-ghost", close),
      );
      box.replaceChildren(title, head, list, errLine, hint);
    } catch (e) {
      // readManifest/list 的 reject 走内联错误，不外溢成 unhandled rejection；
      // head/list 是读不出来时的陈旧状态，不保留。
      showError(e);
      box.replaceChildren(errLine, hint);
    }
  };
  await render();
  box.querySelector<HTMLInputElement>(".plugin-panel-head input")?.focus({ preventScroll: true });
}

/** 单行：名称/版本/问题 + 开关 + 外置移除；改动走纯变换后写回。 */
function rowEl(
  ctx: Context,
  row: PanelRow,
  manifest: Manifest,
  rerender: () => Promise<void>,
  showError: (e: unknown) => void,
  noteSaved: () => void,
): HTMLElement {
  const line = document.createElement("div");
  line.className = `plugin-row${row.problem ? " plugin-row-broken" : ""}`;
  const name = document.createElement("span");
  name.className = "plugin-name";
  name.textContent = row.id;
  const version = document.createElement("span");
  version.className = "plugin-version";
  version.textContent = row.version ?? "";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = row.enabled;
  toggle.setAttribute("aria-label", `启用 ${row.id}`);
  toggle.addEventListener("change", async () => {
    try {
      await ctx.plugins.writeManifest(withEnabled(manifest, row.id, toggle.checked));
      noteSaved();
    } catch (e) {
      showError(e);
    }
    await rerender();
  });
  line.append(name, version, toggle);
  if (row.problem) {
    const problem = document.createElement("span");
    problem.className = "plugin-problem";
    problem.textContent = `待清理：${row.problem}`;
    line.append(problem);
  }
  if (row.removable && row.externalName) {
    line.append(
      button("移除", "btn btn-danger", async () => {
        try {
          await ctx.plugins.remove(row.externalName!);
          await ctx.plugins.writeManifest(withoutRow(manifest, row.id));
          noteSaved();
        } catch (e) {
          showError(e);
        }
        await rerender();
      }),
    );
  }
  return line;
}

/** 最小按钮工厂。 */
function button(text: string, className: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  b.addEventListener("click", () => void onClick());
  return b;
}

/** 错误行（面板内联显示，不白屏）。 */
function errorLine(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "plugin-error";
  p.textContent = text;
  return p;
}
