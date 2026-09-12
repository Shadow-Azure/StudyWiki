import type { Context } from "cordis";
import type { Manifest } from "../../loader/manifest";
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
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "插件";
    btn.addEventListener("click", () => void openPanel(ctx));
    el.append(btn);
  });
}

/** 面板本体：固定覆盖层；每次操作后整体重渲染（状态简单，不值得细粒度更新）。 */
async function openPanel(ctx: Context): Promise<void> {
  document.querySelector(".plugin-panel")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "plugin-panel";
  const box = document.createElement("div");
  box.className = "plugin-panel-box";
  overlay.append(box);
  document.body.append(overlay);
  const close = () => overlay.remove();
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
      const head = document.createElement("div");
      head.className = "plugin-panel-head";
      const installInput = document.createElement("input");
      installInput.placeholder = "包名或 包名@版本";
      head.append(
        installInput,
        button("安装", async () => {
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
        button("本地导入…", async () => {
          try {
            await ctx.plugins.importFromTgz();
            noteSaved();
          } catch (e) {
            showError(e);
          }
          await render();
        }),
        button("关闭", close),
      );
      box.replaceChildren(head, list, errLine, hint);
    } catch (e) {
      // readManifest/list 的 reject 走内联错误，不外溢成 unhandled rejection；
      // head/list 是读不出来时的陈旧状态，不保留。
      showError(e);
      box.replaceChildren(errLine, hint);
    }
  };
  await render();
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
  const label = document.createElement("span");
  label.textContent = row.id + (row.version ? `（${row.version}）` : "");
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = row.enabled;
  toggle.addEventListener("change", async () => {
    try {
      await ctx.plugins.writeManifest(withEnabled(manifest, row.id, toggle.checked));
      noteSaved();
    } catch (e) {
      showError(e);
    }
    await rerender();
  });
  line.append(label, toggle);
  if (row.problem) {
    const problem = document.createElement("span");
    problem.className = "plugin-problem";
    problem.textContent = `待清理：${row.problem}`;
    line.append(problem);
  }
  if (row.removable && row.externalName) {
    line.append(
      button("移除", async () => {
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
function button(text: string, onClick: () => void | Promise<void>): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
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
