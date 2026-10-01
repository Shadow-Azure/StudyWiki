import type { Context } from "cordis";
import { labelButton } from "../../ui/dom";
import type { LlmPreset, RedactedEndpoint } from "../../host/llm";
import { blankDraft, CUSTOM_VENDOR, instantiatePreset, validateDraft, type EndpointDraft } from "./model";

/** Plugin id in the manifest and the static module table. */
export const name = "llm-settings";
/** Service keys awaited before apply runs. */
export const inject = ["llm", "slots"];

/** 模型配置面板（第七内置插件）：顶栏入口 + 厂商预设实例化 + endpoint 列表/编辑/探测。
 * 预设表来自 Rust llm_list_presets（baseUrl 不进前端源码）；key 明文仅内存持有，
 * 保存经 ctx.llm（写面仅内置插件可用）；探测/错误归一码原样内联展示。
 * @param ctx Host context（llm/slots injected）。
 * @returns Teardown removing the topbar button. */
export function apply(ctx: Context): () => void {
  return ctx.slots.register("topbar.left", (el) => {
    const btn = labelButton("sparkle", "", { className: "btn btn-ghost icon-btn", ariaLabel: "模型" });
    btn.title = "模型";
    btn.addEventListener("click", () => void openPanel(ctx));
    el.append(btn);
    return () => btn.remove();
  });
}

/** 面板本体：模态覆盖层（Esc 可关），每次动作后整体重渲染。 */
async function openPanel(ctx: Context): Promise<void> {
  document.querySelector(".llm-panel")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "plugin-panel llm-panel";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "模型配置");
  const box = document.createElement("div");
  box.className = "plugin-panel-box";
  overlay.append(box);
  document.body.append(overlay);
  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", onKey);

  const renderError = (message: string): void => {
    const el = document.createElement("div");
    el.className = "llm-error";
    el.textContent = message;
    box.append(el);
  };

  const renderList = async (): Promise<void> => {
    box.textContent = "";
    const title = document.createElement("h3");
    title.className = "plugin-panel-title";
    title.textContent = "模型配置";
    box.append(title);
    try {
      const [settings, presets] = await Promise.all([ctx.llm.listEndpoints(), ctx.llm.listPresets()]);
      for (const e of settings.endpoints) box.append(endpointRow(ctx, e, renderList, close));
      if (settings.endpoints.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "尚未配置任何 endpoint。";
        box.append(empty);
      }
      const add = document.createElement("button");
      add.type = "button";
      add.className = "btn";
      add.dataset.action = "add";
      add.textContent = "新增 endpoint";
      add.addEventListener("click", () => void renderForm(ctx, presets, renderList));
      box.append(add);
    } catch (e) {
      renderError(errorMessage(e));
    }
  };

  await renderList();
}

/** 列表行：名称 / baseUrl / 模型数 / key 徽标 + 探测（延迟或归一码）/ 编辑 / 删除。 */
function endpointRow(
  ctx: Context,
  e: RedactedEndpoint,
  rerender: () => Promise<void>,
  close: () => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "plugin-row llm-row";
  const info = document.createElement("span");
  info.style.flex = "1";
  info.textContent = `${e.name}（${e.id}） · ${e.baseUrl} · ${e.models.length} 个模型${e.hasKey ? " · 🔑" : ""}`;
  row.append(info);
  const feedback = document.createElement("span");
  feedback.className = "llm-probe-result";
  const probe = document.createElement("button");
  probe.type = "button";
  probe.className = "btn btn-ghost";
  probe.textContent = "探测";
  probe.addEventListener("click", () => {
    feedback.textContent = "…";
    void ctx.llm
      .probe(e.id)
      .then((ms) => (feedback.textContent = `${ms}ms`))
      .catch((err) => (feedback.textContent = errorMessage(err)));
  });
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "btn btn-ghost";
  edit.textContent = "编辑";
  edit.addEventListener("click", () => {
    void ctx.llm.listPresets().then((presets) => {
      const draft: EndpointDraft = {
        id: e.id,
        name: e.name,
        kind: e.kind === "asr" ? "asr" : "chat",
        baseUrl: e.baseUrl,
        apiKey: "",
        models: e.models.map((m) => ({ id: m.id, capabilities: [...m.capabilities] })),
      };
      void renderForm(ctx, presets, rerender, draft);
    });
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn btn-ghost";
  remove.textContent = "删除";
  remove.addEventListener("click", () => {
    void ctx.llm
      .removeEndpoint(e.id)
      .then(() => rerender())
      .catch((err) => (feedback.textContent = errorMessage(err)));
  });
  row.append(feedback, probe, edit, remove);
  return row;
}

/** 表单态：vendor 选择（预设或自定义）→ 字段回填 → 模型行编辑 → 校验保存。 */
async function renderForm(
  ctx: Context,
  presets: LlmPreset[],
  rerender: () => Promise<void>,
  initial?: EndpointDraft,
): Promise<void> {
  const overlay = document.querySelector(".llm-panel");
  if (!overlay) return;
  const box = overlay.querySelector(".plugin-panel-box") as HTMLElement;
  let draft = initial ?? blankDraft();
  box.textContent = "";
  const title = document.createElement("h3");
  title.className = "plugin-panel-title";
  title.textContent = initial ? "编辑 endpoint" : "新增 endpoint";
  const form = document.createElement("form");
  const vendorLabel = fieldLabel("厂商预设");
  const vendor = document.createElement("select");
  vendor.name = "vendor";
  for (const p of presets) {
    const opt = document.createElement("option");
    opt.value = p.vendor;
    opt.textContent = `${p.name}（${p.baseUrl}）`;
    vendor.append(opt);
  }
  const custom = document.createElement("option");
  custom.value = CUSTOM_VENDOR;
  custom.textContent = "自定义（OpenAI 兼容）";
  vendor.append(custom);
  const refreshFields = (): void => {
    draft =
      vendor.value === CUSTOM_VENDOR
        ? blankDraft()
        : instantiatePreset(presets.find((p) => p.vendor === vendor.value)!);
    drawFields();
  };
  vendor.addEventListener("change", refreshFields);
  const error = document.createElement("div");
  error.className = "llm-error";
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "btn";
  save.textContent = "保存";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn-ghost";
  cancel.textContent = "取消";
  cancel.addEventListener("click", () => void rerender());

  const drawFields = (): void => {
    form.querySelectorAll("[data-dyn]").forEach((el) => el.remove());
    for (const [label, name, value] of [
      ["id", "id", draft.id],
      ["名称", "name", draft.name],
      ["baseUrl", "baseUrl", draft.baseUrl],
      ["apiKey", "apiKey", draft.apiKey],
    ] as const) {
      const l = fieldLabel(label);
      const input = document.createElement("input");
      input.dataset.dyn = "";
      input.name = name;
      input.value = value;
      if (name === "apiKey") {
        input.type = "password";
        input.autocomplete = "off";
        input.placeholder = "留空 = 自托管无鉴权";
      }
      input.addEventListener("input", () => ((draft as Record<string, string>)[name] = input.value));
      form.append(l, input);
    }
    for (const [i, m] of draft.models.entries()) {
      const row = document.createElement("div");
      row.dataset.dyn = "";
      row.className = "llm-model-row";
      const id = document.createElement("input");
      id.value = m.id;
      id.placeholder = "模型 id";
      id.addEventListener("input", () => (m.id = id.value));
      const vision = document.createElement("input");
      vision.type = "checkbox";
      vision.name = "vision";
      vision.checked = m.capabilities.includes("vision");
      vision.addEventListener("change", () => {
        m.capabilities = vision.checked
          ? [...m.capabilities.filter((c) => c !== "vision"), "vision"]
          : m.capabilities.filter((c) => c !== "vision");
      });
      const visionLabel = document.createElement("label");
      visionLabel.append(vision, document.createTextNode("vision"));
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "×";
      del.addEventListener("click", () => {
        draft.models.splice(i, 1);
        drawFields();
      });
      row.append(id, visionLabel, del);
      form.append(row);
    }
    const addModel = document.createElement("button");
    addModel.dataset.dyn = "";
    addModel.type = "button";
    addModel.textContent = "添加模型";
    addModel.addEventListener("click", () => {
      draft.models.push({ id: "", capabilities: ["text"] });
      drawFields();
    });
    form.append(addModel);
  };

  vendor.value = initial ? CUSTOM_VENDOR : presets[0]?.vendor ?? CUSTOM_VENDOR;
  if (initial) drawFields();
  else refreshFields();
  form.append(vendorLabel, vendor);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    // 提交时从 DOM 收值（对程序化赋值与手动输入同样稳健）；模型行走闭包编辑态。
    for (const name of ["id", "name", "baseUrl", "apiKey"] as const) {
      const input = form.querySelector<HTMLInputElement>(`[name=${name}]`);
      if (input) (draft as Record<string, string>)[name] = input.value;
    }
    const problem = validateDraft(draft);
    if (problem) {
      error.textContent = problem;
      return;
    }
    error.textContent = "";
    void ctx.llm
      .upsertEndpoint(draft)
      .then(() => rerender())
      .catch((err) => (error.textContent = errorMessage(err)));
  });
  form.append(error, save, cancel);
  box.append(title, form);
}

function fieldLabel(text: string): HTMLElement {
  const l = document.createElement("label");
  l.textContent = text;
  return l;
}

/** 归一错误展示：带 code 的错误（Rust/宿主 LlmError）显示 code + message；其余原样转文案。 */
function errorMessage(e: unknown): string {
  const shape = e as { code?: unknown; message?: unknown };
  if (shape && typeof shape.code === "string") {
    return `${shape.code}: ${typeof shape.message === "string" ? shape.message : shape.code}`;
  }
  return e instanceof Error ? e.message : String(e);
}
