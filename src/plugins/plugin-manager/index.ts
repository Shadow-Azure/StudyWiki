import type { Context } from "cordis";
import type { Manifest } from "../../loader/manifest";
import { labelButton } from "../../ui/dom";
import {
  activationFailures,
  deactivateExternal,
  reloadExternal,
  runningExternals,
  type ActivateDeps,
} from "../../loader/activate";
import { computePanelRows, withEnabled, withoutRow, withRow, type PanelRow } from "./model";

/** Plugin id in the manifest and the static module table. */
export const name = "plugin-manager";
/** Service keys awaited before apply runs. */
export const inject = ["plugins", "slots", "windows"];

/** 插件管理面板（第六内置插件）：顶栏"插件"按钮开合；列已装（内置+外置）、
 * 按名安装、本地导入、启用开关、重新加载、版本回退、外置移除。全部动作即时生效
 * 于本窗口（清单是跨窗口一致性的唯一准源，其他窗口重启后跟随）。
 * 动作可见性：安装/导入/启停/移除恒在；重新加载只在已启用且健康的外置行出现
 * （停用行的清单语义是"不该在跑"）；历史在健康外置行恒在，但停用行的回退只落盘。
 * 安装/导入走 reloadExternal（已在跑的同名插件先 dispose 旧 fiber 再挂新的）。
 * 安装/导入同时把清单行置为 enabled（显式意图：同名行原本停用时也启用，不留"在跑但清单说停用"）。
 * 操作失败内联显示错误，不静默。
 * @param ctx Host context（plugins/slots/windows injected）。
 * @returns Teardown removing the topbar button. */
export function apply(ctx: Context): () => void {
  return ctx.slots.register("topbar.left", (el) => {
    const btn = labelButton("module", "", { className: "btn btn-ghost icon-btn", ariaLabel: "插件" });
    btn.title = "插件";
    btn.addEventListener("click", () => void openPanel(ctx, btn));
    el.append(btn);
  });
}

/** 面板热路径的激活参数：快照走宿主插件服务（版本仓落一代）。 */
function activateDeps(ctx: Context): ActivateDeps {
  return { snapshot: (name) => ctx.plugins.snapshot(name) };
}

/** 按 id 取清单行（面板所有动作都要该行的 config；行必在，调用方即渲染方）。 */
function rowOf(manifest: Manifest, id: string) {
  return manifest.plugins.find((row) => row.id === id)!;
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
  // 错误行与常驻说明是同一元素跨 render 复用（render 的 replaceChildren 会重建
  // 其余节点）：失败内联显示才能在整体重渲染后仍可见，清除由成功路径显式调
  // clearError() 完成（render 在失败路径紧接 showError 之后跑，不能无条件清）。
  const errLine = document.createElement("p");
  errLine.className = "plugin-error";
  errLine.hidden = true;
  const note = document.createElement("p");
  note.className = "plugin-note";
  note.textContent = "改动即时生效于本窗口；其他窗口重启后跟随清单。";
  const showError = (e: unknown) => {
    errLine.textContent = `操作失败：${e instanceof Error ? e.message : String(e)}`;
    errLine.hidden = false;
  };
  /** 成功路径清除内联错误（与 showError 对称）：不清则陈旧失败常驻到面板关闭。
   * 取消类结果（导入取消、移除未确认）不算成功，不清。 */
  const clearError = (): void => {
    errLine.textContent = "";
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
      const rows = computePanelRows(manifest, entries, ctx.plugins.bootBroken, runningExternals(), activationFailures());
      const list = document.createElement("div");
      list.className = "plugin-list";
      for (const row of rows) list.append(rowEl(ctx, row, manifest, render, showError, clearError));
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
            // 落清单行 → 取模块 → 热重载路径激活：安装即生效，且 ext: 行自此有入清单路径
            // （Phase 2 的验收盲区：此前装完重启也不会被装载）。走 reloadExternal 而非
            // activateExternal：覆盖安装 = 升级，它先 dispose 同名旧 fiber 再挂新模块
            // （直调 activateExternal 会覆盖登记、把旧 fiber 变成谁都没法 dispose 的孤儿）；
            // 它内部已按名串行，面板不能再套一层 serialized（同名单层嵌套会自锁）。
            const installed = await ctx.plugins.install(spec);
            // 写行同时补启用：装/导入是"要有这个插件"的显式意图，而 withRow 对已存在的
            // 停用行是空操作——不补启用就会出现插件在跑而清单仍说停用（投影按 !enabled
            // 先判 stopped，下次启动又不装，面板与清单长期打架）。
            const row = `ext:${installed}`;
            await ctx.plugins.writeManifest(withEnabled(withRow(manifest, row), row, true));
            const mod = await ctx.plugins.loadModule(installed);
            await reloadExternal(ctx, installed, mod, {}, activateDeps(ctx));
            clearError();
          } catch (e) {
            showError(e);
          }
          await render();
        }),
        button("本地导入…", "btn", async () => {
          try {
            const imported = await ctx.plugins.importFromTgz();
            if (imported !== null) {
              // 同安装路径：导入也是"要有这个插件"的显式意图，停用的同名行一并启用。
              const row = `ext:${imported}`;
              await ctx.plugins.writeManifest(withEnabled(withRow(manifest, row), row, true));
              const mod = await ctx.plugins.loadModule(imported);
              await reloadExternal(ctx, imported, mod, {}, activateDeps(ctx));
              clearError();
            }
          } catch (e) {
            showError(e);
          }
          await render();
        }),
        button("关闭", "btn btn-ghost", close),
      );
      box.replaceChildren(title, head, list, errLine, note);
    } catch (e) {
      // readManifest/list 的 reject 走内联错误，不外溢成 unhandled rejection；
      // head/list 是读不出来时的陈旧状态，不保留。
      showError(e);
      box.replaceChildren(errLine, note);
    }
  };
  await render();
  box.querySelector<HTMLInputElement>(".plugin-panel-head input")?.focus({ preventScroll: true });
}

/** 单行：名称/版本/运行态/问题 + 开关 + 外置三动作（重新加载/历史/移除）。
 * 外置行的开关与按钮都即时作用于本窗运行态，清单写入是持久化副产物；
 * 激活失败时清单不动（行状态由失败表投影），下次启动按清单重试。 */
function rowEl(
  ctx: Context,
  row: PanelRow,
  manifest: Manifest,
  rerender: () => Promise<void>,
  showError: (e: unknown) => void,
  clearError: () => void,
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
      if (row.externalName) {
        // 外置行：先动运行态（启用走热重载路径，停用走 dispose），再落清单；
        // 热路径抛错则清单保持原样，开关在重渲染时回弹。
        if (toggle.checked) {
          const mod = await ctx.plugins.loadModule(row.externalName);
          await reloadExternal(ctx, row.externalName, mod, rowOf(manifest, row.id).config, activateDeps(ctx));
        } else {
          await deactivateExternal(row.externalName);
        }
      }
      await ctx.plugins.writeManifest(withEnabled(manifest, row.id, toggle.checked));
      clearError();
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
  if (row.runtime === "failed" && row.failure) {
    const failure = document.createElement("span");
    failure.className = "plugin-problem";
    failure.textContent = `装载失败：${row.failure}`;
    line.append(failure);
  } else if (row.runtime === "running") {
    const runtime = document.createElement("span");
    runtime.className = "plugin-runtime";
    runtime.textContent = "运行中";
    line.append(runtime);
  }
  if (row.removable && row.externalName) {
    const name = row.externalName;
    // 历史与重新加载只在健康行出现：坏行（目录 problem / boot 坏行）连模块都读不出来，
    // 先动的是"待清理"这条路径（移除），给了按钮只会把错误再报一遍。
    if (!row.problem) {
      // 重新加载额外要求已启用：停用行的清单语义是"不该在跑"，点它会把插件装回来
      // 而清单仍是 enabled:false（投影按 enabled 先判 stopped，行显示停用、插件在跑）。
      if (row.enabled) {
        line.append(
          button("重新加载", "btn btn-ghost", async () => {
            try {
              const mod = await ctx.plugins.loadModule(name);
              await reloadExternal(ctx, name, mod, rowOf(manifest, row.id).config, activateDeps(ctx));
              clearError();
            } catch (e) {
              showError(e);
            }
            await rerender();
          }),
        );
      }
      line.append(
        button("历史", "btn btn-ghost", async () => {
          // 展开 = 现读现列（版本仓是磁盘事实，缓存它只会显示陈旧历史）；再点收起。
          const box = line.querySelector(".plugin-versions");
          if (box) {
            box.remove();
            return;
          }
          try {
            const versions = await ctx.plugins.listVersions(name);
            const list = document.createElement("div");
            list.className = "plugin-versions";
            for (const v of versions) {
              const item = document.createElement("div");
              item.className = "plugin-version-row";
              const label = document.createElement("span");
              label.textContent =
                `${v.id.slice(11)} ${v.version ?? ""} ${new Date(v.createdAt * 1000).toLocaleString()}${v.current ? "（当前）" : ""}`;
              item.append(label);
              if (!v.current) {
                item.append(
                  button("回退", "btn btn-ghost", async () => {
                    try {
                      await ctx.plugins.restoreVersion(name, v.id);
                      // 停用行只落盘：清单说 enabled:false，面板就不该把它跑起来——
                      // 下次启用/重新加载自然按恢复后的代码激活。
                      if (row.enabled) {
                        const mod = await ctx.plugins.loadModule(name);
                        await reloadExternal(ctx, name, mod, rowOf(manifest, row.id).config, activateDeps(ctx));
                      }
                      clearError();
                    } catch (e) {
                      showError(e);
                    }
                    await rerender();
                  }),
                );
              }
              list.append(item);
            }
            line.append(list);
          } catch (e) {
            showError(e); // 历史读取失败同样内联，不外溢成 unhandled rejection
          }
        }),
      );
    }
    line.append(
      button("移除", "btn btn-danger", async () => {
        try {
          if (await ctx.windows.confirmDialog(`移除 ${name}？其版本历史将一并删除。`)) {
            await deactivateExternal(name);
            await ctx.plugins.remove(name);
            await ctx.plugins.writeManifest(withoutRow(manifest, row.id));
            clearError();
          }
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
