import type { Context } from "cordis";
import { labelButton } from "../../ui/dom";
import type { EndpointInput, LlmPreset, RedactedEndpoint } from "../../host/llm";
import { blankDraft, CUSTOM_VENDOR, instantiatePreset, validateDraft, type EndpointDraft } from "./model";

/** Plugin id in the manifest and the static module table. */
export const name = "llm-settings";
/** Service keys awaited before apply runs. */
export const inject = ["llm", "slots"];

/** 厂商徽标显示名（仅展示层；key 对齐 Rust 预设 vendor，未收录回退"自定义"）。 */
const VENDOR_LABELS: Record<string, string> = {
  zhipu: "智谱",
  deepseek: "DeepSeek",
  moonshot: "Kimi",
  minimax: "MiniMax",
  custom: "自定义",
};

/** vendor 徽标显示名；未收录的 key 视为自定义。 */
function vendorLabel(vendor: string): string {
  return VENDOR_LABELS[vendor] ?? VENDOR_LABELS.custom;
}

/** 与 Rust redact 预览同形：只用于展示态，不代表待保存 key。 */
function keyPreview(key: string): string {
  const chars = [...key];
  if (chars.length === 0) return "";
  if (chars.length <= 7) return "****";
  return `${chars.slice(0, 4).join("")}…${chars.slice(-2).join("")}`;
}

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

/** 模型能力勾选组：name 即保存载荷能力值，text 为面板显示文案。 */
const CAPABILITY_CHECKS = [
  { value: "vision", text: "vision" },
  { value: "audio", text: "audio" },
  { value: "tools", text: "工具调用" },
] as const;

/** 面板本体：模态覆盖层（Esc 可关），每次动作后整体重渲染。 */
async function openPanel(ctx: Context): Promise<void> {
  document.querySelector(".llm-panel")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "plugin-panel llm-panel";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "模型配置");
  const box = document.createElement("div");
  box.className = "plugin-panel-box llm-box";
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

  let vendorFilter: string | null = null;

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
      // 厂商摘要条：全部 + 各厂商计数（品牌色圆点 + 点击筛选，再点取消）
      if (settings.endpoints.length > 0) {
        const groups = new Map<string, number>();
        for (const e of settings.endpoints) groups.set(e.vendor, (groups.get(e.vendor) ?? 0) + 1);
        const summary = document.createElement("div");
        summary.className = "llm-summary";
        summary.setAttribute("role", "group");
        summary.setAttribute("aria-label", "厂商筛选");
        const mkChip = (vendor: string, label: string): HTMLButtonElement => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "llm-vchip";
          chip.dataset.vendor = vendor;
          chip.setAttribute("aria-pressed", String(vendorFilter === vendor));
          if (vendor !== "all") {
            const dot = document.createElement("span");
            dot.className = "llm-dot";
            dot.dataset.vendor = vendor;
            chip.append(dot);
          }
          chip.append(document.createTextNode(label));
          chip.addEventListener("click", () => {
            vendorFilter = vendor === "all" || vendorFilter === vendor ? null : vendor;
            void renderList();
          });
          return chip;
        };
        summary.append(mkChip("all", `全部 ${settings.endpoints.length}`));
        for (const [vendor, count] of groups) {
          summary.append(mkChip(vendor, `${vendorLabel(vendor)} ${count}`));
        }
        box.append(summary);
      }
      // 默认模型选择（跨 endpoint 聚合；选项带厂商后缀）
      const modelIds = [...new Set(settings.endpoints.flatMap((e) => e.models.map((m) => m.id)))];
      if (modelIds.length > 0) {
        const ownerOf = new Map<string, string>();
        for (const e of settings.endpoints) {
          for (const m of e.models) if (!ownerOf.has(m.id)) ownerOf.set(m.id, vendorLabel(e.vendor));
        }
        const defaultRow = document.createElement("div");
        defaultRow.className = "plugin-row llm-default-row";
        const label = document.createElement("span");
        label.textContent = "默认模型";
        const select = document.createElement("select");
        const none = document.createElement("option");
        none.value = "";
        none.textContent = "（不设置）";
        select.append(none);
        for (const id of modelIds) {
          const opt = document.createElement("option");
          opt.value = id;
          opt.textContent = `${id} · ${ownerOf.get(id) ?? ""}`;
          select.append(opt);
        }
        select.value = settings.defaultModel ?? "";
        select.addEventListener("change", () => {
          void ctx.llm
            .setDefaultModel(select.value || null)
            .then(() => renderList())
            .catch((err) => (feedbackOf(defaultRow).textContent = errorMessage(err)));
        });
        defaultRow.append(label, select);
        box.append(defaultRow);
      }
      // 可滚动卡片列表（厂商筛选生效）
      const list = document.createElement("div");
      list.className = "llm-list";
      const visible = settings.endpoints.filter(
        (e) => !vendorFilter || e.vendor === vendorFilter,
      );
      for (const e of visible) list.append(endpointRow(ctx, e, renderList));
      if (visible.length === 0) {
        const empty = document.createElement("p");
        empty.className = "llm-empty";
        empty.textContent = settings.endpoints.length === 0 ? "尚未配置任何 endpoint。" : "该厂商暂无配置";
        list.append(empty);
      }
      box.append(list);
      // 底部常驻新增
      const foot = document.createElement("div");
      foot.className = "llm-panel-foot";
      const add = document.createElement("button");
      add.type = "button";
      add.className = "btn llm-add";
      add.dataset.action = "add";
      add.textContent = "＋ 新增 endpoint";
      add.addEventListener("click", () => void renderForm(ctx, presets, renderList));
      foot.append(add);
      box.append(foot);
    } catch (e) {
      renderError(errorMessage(e));
    }
  };

  await renderList();
}

/** endpoint 卡片：厂商徽标 + id 片 + mono baseUrl + 状态徽章 + 探测（延迟/归一码）/编辑/删除。 */
function endpointRow(ctx: Context, e: RedactedEndpoint, rerender: () => Promise<void>): HTMLElement {
  const card = document.createElement("div");
  card.className = "llm-card";
  card.dataset.vendor = e.vendor;
  const main = document.createElement("div");
  main.className = "llm-card-main";
  const head = document.createElement("div");
  head.className = "llm-card-head";
  const name = document.createElement("span");
  name.className = "llm-card-name";
  name.textContent = e.name;
  const vendor = document.createElement("span");
  vendor.className = "llm-vendor";
  const dot = document.createElement("span");
  dot.className = "llm-dot";
  dot.dataset.vendor = e.vendor;
  vendor.append(dot, document.createTextNode(vendorLabel(e.vendor)));
  const idChip = document.createElement("span");
  idChip.className = "llm-idchip";
  idChip.textContent = e.id;
  head.append(name, vendor, idChip);
  const url = document.createElement("div");
  url.className = "llm-url";
  url.textContent = e.baseUrl;
  const meta = document.createElement("div");
  meta.className = "llm-meta";
  const count = document.createElement("span");
  count.className = "llm-badge";
  count.textContent = `${e.models.length} 个模型`;
  const keyBadge = document.createElement("span");
  keyBadge.className = e.hasKey ? "llm-badge llm-badge-key" : "llm-badge llm-badge-nokey";
  keyBadge.textContent = e.hasKey ? "🔑 密钥已配置" : "未配置密钥";
  const feedback = document.createElement("span");
  feedback.className = "llm-probe-result";
  meta.append(count, keyBadge, feedback);
  main.append(head, url, meta);
  const actions = document.createElement("div");
  actions.className = "llm-card-actions";
  const probe = document.createElement("button");
  probe.type = "button";
  probe.className = "btn btn-ghost";
  probe.textContent = "探测";
  probe.addEventListener("click", () => {
    feedback.className = "llm-probe-result";
    feedback.textContent = "…";
    void ctx.llm
      .probe(e.id)
      .then((ms) => {
        feedback.className = "llm-probe-result llm-probe-ok";
        feedback.textContent = `${ms}ms`;
      })
      .catch((err) => {
        feedback.className = "llm-probe-result llm-probe-err";
        feedback.textContent = errorMessage(err);
      });
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
      void renderForm(ctx, presets, rerender, draft, e);
    });
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "btn btn-danger";
  remove.textContent = "删除";
  remove.addEventListener("click", () => {
    void ctx.llm
      .removeEndpoint(e.id)
      .then(() => rerender())
      .catch((err) => {
        feedback.className = "llm-probe-result llm-probe-err";
        feedback.textContent = errorMessage(err);
      });
  });
  actions.append(probe, edit, remove);
  card.append(main, actions);
  return card;
}

/** 表单态：厂商预设置顶（决定其余字段的第一选择）→ 字段回填 → 模型行编辑 → 校验保存。 */
async function renderForm(
  ctx: Context,
  presets: LlmPreset[],
  rerender: () => Promise<void>,
  initial?: EndpointDraft,
  endpoint?: RedactedEndpoint,
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
  form.className = "llm-form";
  // 顶部：厂商预设 + 类型
  const top = document.createElement("div");
  top.className = "llm-grid";
  const vendorField = document.createElement("div");
  vendorField.className = "llm-field";
  const vendorLabel = fieldLabel("厂商预设");
  const vendor = document.createElement("select");
  vendor.name = "vendor";
  for (const p of presets) {
    const opt = document.createElement("option");
    opt.value = p.vendor;
    opt.textContent = p.name;
    vendor.append(opt);
  }
  const custom = document.createElement("option");
  custom.value = CUSTOM_VENDOR;
  custom.textContent = "自定义（OpenAI 兼容）";
  vendor.append(custom);
  if (initial) {
    vendor.disabled = true;
    vendor.title = "编辑态不可切换厂商；如需换预设请删除后新增";
  }
  vendorField.append(vendorLabel, vendor);
  const kindField = document.createElement("div");
  kindField.className = "llm-field";
  const kindLabel = fieldLabel("类型");
  const kind = document.createElement("select");
  kind.name = "kind";
  for (const [value, text] of [["chat", "chat（LLM/VLM）"], ["asr", "asr（转写，预留）"]] as const) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    kind.append(opt);
  }
  kind.value = draft.kind;
  kind.addEventListener("change", () => (draft.kind = kind.value === "asr" ? "asr" : "chat"));
  kindField.append(kindLabel, kind);
  top.append(vendorField, kindField);
  form.append(top);
  if (!initial) {
    const hint = document.createElement("p");
    hint.className = "llm-hint";
    hint.textContent = "选择预设自动填入 id / 名称 / baseUrl 与模型清单，只需补 apiKey；切「自定义」则全部手填。";
    form.append(hint);
  }
  const setField = (field: "id" | "name" | "baseUrl" | "apiKey", value: string): void => {
    if (field === "id") draft.id = value;
    else if (field === "name") draft.name = value;
    else if (field === "baseUrl") draft.baseUrl = value;
    else draft.apiKey = value;
  };
  const error = document.createElement("div");
  error.className = "llm-error";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn-ghost";
  cancel.textContent = "取消";
  cancel.addEventListener("click", () => void rerender());
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "btn btn-primary";
  save.textContent = "保存";
  const foot = document.createElement("div");
  foot.className = "llm-form-foot";
  foot.append(error, cancel, save);
  form.append(foot);

  // 动态区：字段网格 + 模型 fieldset（vendor change / 模型增删触发整体重建）
  let zone: HTMLElement | null = null;
  let keyRevealed = false;
  let editedKey: string | null = null;
  let revealedStoredKey: string | null = null;
  const drawFields = (): void => {
    zone?.remove();
    zone = document.createElement("div");
    zone.dataset.dyn = "";
    const grid = document.createElement("div");
    grid.className = "llm-grid";
    for (const [label, name, value, wide] of [
      ["id", "id", draft.id, false],
      ["名称", "name", draft.name, false],
      ["baseUrl", "baseUrl", draft.baseUrl, true],
      ["apiKey", "apiKey", draft.apiKey, true],
    ] as const) {
      const f = document.createElement("div");
      f.className = wide ? "llm-field llm-field-wide" : "llm-field";
      const l = fieldLabel(label);
      const input = document.createElement("input");
      input.name = name;
      input.value = value;
      if (name === "id" && initial) {
        // 编辑态锁 id：改 id 等于"删旧建新"，显式走删除动作更诚实。
        input.disabled = true;
        input.title = "id 不可改；如需改名请删除后重建";
      }
      if (name === "id" || name === "baseUrl") input.classList.add("llm-mono");
      if (name === "apiKey") {
        input.autocomplete = "off";
        input.placeholder = initial
          ? "掩码仅展示；点眼睛查看或编辑"
          : "粘贴厂商控制台签发的 API Key（自托管可留空）";
        const row = document.createElement("div");
        row.className = "llm-key-row";
        row.append(input);
        let eye: HTMLButtonElement | null = null;
        const keyHint = document.createElement("span");
        keyHint.className = "llm-hint llm-key-hint";
        const syncKeyDisplay = (): void => {
          const hasStoredKey = Boolean(initial && endpoint?.hasKey);
          input.readOnly = hasStoredKey && !keyRevealed;
          if (hasStoredKey) {
            input.value = keyRevealed
              ? editedKey ?? revealedStoredKey ?? ""
              : editedKey !== null ? keyPreview(editedKey) : endpoint!.keyPreview;
          }
          input.title = keyRevealed ? "编辑明文 Key" : "掩码仅展示；点击眼睛查看或编辑";
          if (hasStoredKey && editedKey !== null) {
            keyHint.textContent = keyRevealed
              ? "正在编辑新 Key；保存会替换旧 key。仅保存在本机 ~/.studywiki/settings.json（0600）"
              : `已修改待保存：${editedKey === "" ? "已清空" : keyPreview(editedKey)}；切回掩码不会丢失修改。`;
          } else if (keyRevealed) {
            keyHint.textContent = "已揭示旧 key；编辑后保存替换，未编辑保存保留。仅保存在本机 ~/.studywiki/settings.json（0600）";
          } else {
            keyHint.textContent = "掩码仅展示，不能编辑；点眼睛查看或编辑。仅保存在本机 ~/.studywiki/settings.json（0600）";
          }
          if (eye) {
            eye.setAttribute("aria-label", keyRevealed ? "隐藏密钥" : "显示密钥");
            eye.title = keyRevealed ? "隐藏完整密钥" : "显示/隐藏完整密钥";
          }
        };
        if (initial && endpoint?.hasKey) {
          eye = labelButton("eye", "", { className: "btn btn-ghost icon-btn", ariaLabel: "显示密钥" });
          eye.type = "button";
          eye.dataset.action = "toggle-key";
          eye.title = "显示/隐藏完整密钥";
          eye.addEventListener("click", () => {
            void (async () => {
              if (keyRevealed) {
                keyRevealed = false;
              } else {
                if (editedKey === null) {
                  revealedStoredKey = await ctx.llm.revealKey(endpoint.id);
                }
                keyRevealed = true;
              }
              syncKeyDisplay();
            })();
          });
          row.append(eye);
          syncKeyDisplay();
        } else {
          syncKeyDisplay();
        }
        f.append(l, row, keyHint);
      } else {
        f.append(l, input);
      }
      input.addEventListener("input", () => {
        if (name === "apiKey" && initial && endpoint?.hasKey) {
          if (!keyRevealed) return;
          editedKey = input.value;
        }
        setField(name, input.value);
      });
      grid.append(f);
    }
    zone.append(grid);
    const fieldset = document.createElement("fieldset");
    fieldset.className = "llm-fieldset";
    const legend = document.createElement("legend");
    legend.textContent = "模型（随预设带入，可增删改）";
    fieldset.append(legend);
    for (const [i, m] of draft.models.entries()) {
      const row = document.createElement("div");
      row.className = "llm-model-row";
      const id = document.createElement("input");
      id.classList.add("llm-mono");
      id.value = m.id;
      id.placeholder = "模型 id";
      id.addEventListener("input", () => (m.id = id.value));
      row.append(id);
      for (const { value, text } of CAPABILITY_CHECKS) {
        const check = document.createElement("input");
        check.type = "checkbox";
        check.name = value;
        check.checked = m.capabilities.includes(value);
        check.addEventListener("change", () => {
          const withoutCapability = m.capabilities.filter((capability) => capability !== value);
          m.capabilities = check.checked ? [...withoutCapability, value] : withoutCapability;
        });
        const label = document.createElement("label");
        label.className = "llm-vision";
        label.append(check, document.createTextNode(text));
        row.append(label);
      }
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-ghost";
      del.textContent = "×";
      del.addEventListener("click", () => {
        draft.models.splice(i, 1);
        drawFields();
      });
      row.append(del);
      fieldset.append(row);
    }
    const addModel = document.createElement("button");
    addModel.type = "button";
    addModel.className = "llm-model-add";
    addModel.textContent = "＋ 添加模型";
    addModel.addEventListener("click", () => {
      draft.models.push({ id: "", capabilities: ["text"] });
      drawFields();
    });
    fieldset.append(addModel);
    zone.append(fieldset);
    form.insertBefore(zone, foot);
  };

  const refreshFields = (): void => {
    draft =
      vendor.value === CUSTOM_VENDOR
        ? blankDraft()
        : instantiatePreset(presets.find((p) => p.vendor === vendor.value)!);
    kind.value = draft.kind;
    drawFields();
  };
  vendor.addEventListener("change", refreshFields);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    // 提交时从 DOM 收值（对程序化赋值与手动输入同样稳健）；模型行走闭包编辑态。
    for (const name of ["id", "name", "baseUrl", "apiKey"] as const) {
      const input = form.querySelector<HTMLInputElement>(`[name=${name}]`);
      if (input) setField(name, input.value);
    }
    if (initial && endpoint?.hasKey) {
      draft.apiKey = keyRevealed && editedKey === null
        ? revealedStoredKey ?? ""
        : editedKey ?? "";
    }
    const problem = validateDraft(draft);
    if (problem) {
      error.textContent = problem;
      return;
    }
    error.textContent = "";
    // key 保存值独立于显示态：掩码永远只读；只有明文编辑产生的 editedKey 才替换。
    const keyDirty = !initial || !endpoint?.hasKey || editedKey !== null;
    const payload: EndpointInput = {
      ...draft,
      // 新增态原样传（空 key 合法）；编辑态未动掩码 = 保留（空 + 无 dirty）。
      apiKey: keyDirty || !initial ? draft.apiKey : "",
    };
    if (keyDirty) payload.apiKeyDirty = true;
    void ctx.llm
      .upsertEndpoint(payload)
      .then(() => rerender())
      .catch((err) => (error.textContent = errorMessage(err)));
  });

  vendor.value = initial ? CUSTOM_VENDOR : presets[0]?.vendor ?? CUSTOM_VENDOR;
  if (initial) drawFields();
  else refreshFields();
  box.append(title, form);
}

/** 行内反馈槽（缺失时建一个），供默认模型行等复用。 */
function feedbackOf(row: HTMLElement): HTMLElement {
  let el = row.querySelector<HTMLElement>(".llm-probe-result");
  if (!el) {
    el = document.createElement("span");
    el.className = "llm-probe-result";
    row.append(el);
  }
  return el;
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
