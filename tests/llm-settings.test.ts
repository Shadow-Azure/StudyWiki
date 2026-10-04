// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { instantiatePreset, validateDraft } from "../src/plugins/llm-settings/model";
import * as llmSettings from "../src/plugins/llm-settings";

const preset = {
  vendor: "deepseek",
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com/v1",
  models: [{ id: "deepseek-v4-pro", capabilities: ["text"] }],
};

describe("model", () => {
  it("instantiates a preset into an editable draft", () => {
    const d = instantiatePreset(preset);
    expect(d).toMatchObject({
      id: "deepseek",
      name: "DeepSeek",
      kind: "chat",
      baseUrl: preset.baseUrl,
      apiKey: "",
      models: preset.models,
    });
  });

  it("validates drafts with Chinese field-named messages", () => {
    expect(validateDraft(instantiatePreset(preset))).toBeNull(); // 空 apiKey 合法（自托管/后填）
    const d = instantiatePreset(preset);
    d.baseUrl = "ftp://x";
    expect(validateDraft(d)).toContain("baseUrl");
    const dup = instantiatePreset(preset);
    dup.models.push({ ...dup.models[0] });
    expect(validateDraft(dup)).toContain("模型");
  });
});

describe("panel", () => {
  it("saves a default-model change through ctx.llm", async () => {
    const { ctx, saved, renders } = fakeCtx();
    (ctx.llm as { listEndpoints: () => Promise<unknown> }).listEndpoints = () =>
      Promise.resolve({
        endpoints: [{ ...preset, id: "deepseek", kind: "chat", hasKey: true, keyPreview: "sk-…ef",
          models: [{ id: "deepseek-v4-pro", capabilities: ["text"] }] }],
        defaultModel: null,
      });
    llmSettings.apply(ctx as never);
    const host = document.createElement("div");
    renders[0](host);
    document.body.append(host);
    (host.querySelector("button") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    const select = document.querySelector(".llm-default-row select") as HTMLSelectElement;
    expect(select).not.toBeNull();
    select.value = "deepseek-v4-pro";
    select.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r));
    expect(saved).toContainEqual({ defaultModel: "deepseek-v4-pro" });
  });


  function fakeCtx() {
    const saved: unknown[] = [];
    const llm = {
      listPresets: () => Promise.resolve([preset]),
      listEndpoints: () => Promise.resolve({ endpoints: [], defaultModel: null }),
      upsertEndpoint: (e: unknown) => {
        saved.push(e);
        return Promise.resolve();
      },
      removeEndpoint: () => Promise.resolve(),
      setDefaultModel: (m: string | null) => {
        saved.push({ defaultModel: m });
        return Promise.resolve();
      },
      probe: () => Promise.resolve(42),
    };
    const renders: ((host: HTMLElement) => void)[] = [];
    const slots = {
      register: (_slot: string, render: (host: HTMLElement) => void) => {
        renders.push(render);
        return () => {};
      },
    };
    return { ctx: { llm, slots }, saved, renders };
  }

  it("saves a preset-instantiated endpoint through ctx.llm", async () => {
    const { ctx, saved, renders } = fakeCtx();
    llmSettings.apply(ctx as never);
    const host = document.createElement("div");
    renders[0](host);
    document.body.append(host);
    (host.querySelector("button") as HTMLButtonElement).click(); // 顶栏按钮 → 面板
    await new Promise((r) => setTimeout(r)); // 面板数据加载
    (document.querySelector(".llm-panel [data-action=add]") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    const form = document.querySelector(".llm-panel form") as HTMLFormElement;
    (form.querySelector("[name=vendor]") as HTMLSelectElement).value = "deepseek";
    (form.querySelector("[name=vendor]") as HTMLSelectElement).dispatchEvent(new Event("change"));
    (form.querySelector("[name=apiKey]") as HTMLInputElement).value = "sk-test";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r));
    expect(saved[0]).toMatchObject({
      id: "deepseek",
      apiKey: "sk-test",
      models: [{ id: "deepseek-v4-pro", capabilities: ["text"] }],
    });
  });

  // 音频能力与视觉能力同形：勾选写入保存负载，取消后从保存负载移除。
  it("toggles audio capability through the model checkbox", async () => {
    const { ctx, saved, renders } = fakeCtx();
    llmSettings.apply(ctx as never);
    const host = document.createElement("div");
    renders[0](host);
    document.body.append(host);
    (host.querySelector("button") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    (document.querySelector(".llm-panel [data-action=add]") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    const form = document.querySelector(".llm-panel form") as HTMLFormElement;
    (form.querySelector("[name=vendor]") as HTMLSelectElement).value = "deepseek";
    (form.querySelector("[name=vendor]") as HTMLSelectElement).dispatchEvent(new Event("change"));
    const audio = form.querySelector("[name=audio]") as HTMLInputElement;
    expect(audio).not.toBeNull();
    audio.checked = true;
    audio.dispatchEvent(new Event("change"));
    (form.querySelector("[name=apiKey]") as HTMLInputElement).value = "sk-test";
    (ctx.llm as { listEndpoints: () => Promise<unknown> }).listEndpoints = () =>
      Promise.resolve({
        endpoints: [{ ...preset, id: "deepseek", kind: "chat", hasKey: false,
          models: [{ id: "deepseek-v4-pro", capabilities: ["text", "audio"] }] }],
        defaultModel: null,
      });
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r)); // 保存后列表重渲染
    expect(saved[0]).toMatchObject({
      id: "deepseek",
      models: [{ id: "deepseek-v4-pro", capabilities: ["text", "audio"] }],
    });

    const card = document.querySelector(".llm-card") as HTMLElement;
    (card.querySelectorAll("button")[1] as HTMLButtonElement).click(); // 编辑
    await new Promise((r) => setTimeout(r));
    const editForm = document.querySelector(".llm-panel form") as HTMLFormElement;
    const editAudio = editForm.querySelector("[name=audio]") as HTMLInputElement;
    expect(editAudio.checked).toBe(true);
    editAudio.checked = false;
    editAudio.dispatchEvent(new Event("change"));
    editForm.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r));
    expect(saved[1]).toMatchObject({
      id: "deepseek",
      models: [{ id: "deepseek-v4-pro", capabilities: ["text"] }],
    });
  });

  // 编辑态：掩码回填 + 未动保存 = 保留（apiKey 空且无 dirty 标记）。
  it("fills the key mask on edit and preserves the stored key when untouched", async () => {
    const { ctx, saved, renders } = fakeCtx();
    (ctx.llm as { listEndpoints: () => Promise<unknown> }).listEndpoints = () =>
      Promise.resolve({
        endpoints: [{ ...preset, id: "deepseek", kind: "chat", hasKey: true, keyPreview: "sk-…ef",
          models: [{ id: "deepseek-v4-pro", capabilities: ["text"] }] }],
        defaultModel: null,
      });
    llmSettings.apply(ctx as never);
    const host = document.createElement("div");
    renders[0](host);
    document.body.append(host);
    (host.querySelector("button") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    const card = document.querySelector(".llm-card") as HTMLElement;
    (card.querySelectorAll("button")[1] as HTMLButtonElement).click(); // 编辑
    await new Promise((r) => setTimeout(r));
    const form = document.querySelector(".llm-panel form") as HTMLFormElement;
    expect((form.querySelector("[name=apiKey]") as HTMLInputElement).value).toBe("sk-…ef");
    expect((form.querySelector("[name=apiKey]") as HTMLInputElement).readOnly).toBe(true);
    expect(form.querySelector(".llm-key-hint")?.textContent).toContain("不能编辑");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r));
    expect(saved[0]).toMatchObject({ id: "deepseek", apiKey: "" });
    expect("apiKeyDirty" in (saved[0] as object)).toBe(false);
  });

  // 编辑态：眼睛切明文 + 删空保存 = 显式清空（apiKeyDirty: true）。
  it("reveals the key via the eye toggle and clears it when saved empty", async () => {
    const { ctx, saved, renders } = fakeCtx();
    (ctx.llm as { listEndpoints: () => Promise<unknown> }).listEndpoints = () =>
      Promise.resolve({
        endpoints: [{ ...preset, id: "deepseek", kind: "chat", hasKey: true, keyPreview: "sk-…ef",
          models: [{ id: "deepseek-v4-pro", capabilities: ["text"] }] }],
        defaultModel: null,
      });
    (ctx.llm as { revealKey: () => Promise<string> }).revealKey = () =>
      Promise.resolve("sk-secret-full");
    llmSettings.apply(ctx as never);
    const host = document.createElement("div");
    renders[0](host);
    document.body.append(host);
    (host.querySelector("button") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    const card = document.querySelector(".llm-card") as HTMLElement;
    (card.querySelectorAll("button")[1] as HTMLButtonElement).click(); // 编辑
    await new Promise((r) => setTimeout(r));
    const form = document.querySelector(".llm-panel form") as HTMLFormElement;
    const keyInput = form.querySelector("[name=apiKey]") as HTMLInputElement;
    const eye = form.querySelector("[data-action=toggle-key]") as HTMLButtonElement;
    eye.click();
    await new Promise((r) => setTimeout(r));
    expect(keyInput.value).toBe("sk-secret-full");
    keyInput.value = "";
    keyInput.dispatchEvent(new Event("input"));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r));
    expect(saved[0]).toMatchObject({ id: "deepseek", apiKey: "", apiKeyDirty: true });
  });

  // 掩码只是展示态：明文编辑后切回掩码，保存值必须仍是已编辑的新 key。
  it("keeps an edited plaintext key when the eye toggles back to the mask", async () => {
    const { ctx, saved, renders } = fakeCtx();
    (ctx.llm as { listEndpoints: () => Promise<unknown> }).listEndpoints = () =>
      Promise.resolve({
        endpoints: [{ ...preset, id: "deepseek", kind: "chat", hasKey: true, keyPreview: "sk-…ef",
          models: [{ id: "deepseek-v4-pro", capabilities: ["text"] }] }],
        defaultModel: null,
      });
    (ctx.llm as { revealKey: () => Promise<string> }).revealKey = () =>
      Promise.resolve("sk-secret-full");
    llmSettings.apply(ctx as never);
    const host = document.createElement("div");
    renders[0](host);
    document.body.append(host);
    (host.querySelector("button") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    const card = document.querySelector(".llm-card") as HTMLElement;
    (card.querySelectorAll("button")[1] as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    const form = document.querySelector(".llm-panel form") as HTMLFormElement;
    const keyInput = form.querySelector("[name=apiKey]") as HTMLInputElement;
    const eye = form.querySelector("[data-action=toggle-key]") as HTMLButtonElement;
    eye.click();
    await new Promise((r) => setTimeout(r));
    keyInput.value = "sk-new-key-9876";
    keyInput.dispatchEvent(new Event("input"));
    eye.click();
    await new Promise((r) => setTimeout(r));
    expect(keyInput.value).toBe("sk-n…76");
    expect(keyInput.readOnly).toBe(true);
    expect(form.querySelector(".llm-key-hint")?.textContent).toContain("不会丢失");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r));
    expect(saved[0]).toMatchObject({ id: "deepseek", apiKey: "sk-new-key-9876", apiKeyDirty: true });
  });

  // 删空后的掩码不再是假 key：空白 + “已清空”提示继续表达同一个待保存空值。
  it("shows an edited empty key as blank when hidden and saves the explicit clear", async () => {
    const { ctx, saved, renders } = fakeCtx();
    (ctx.llm as { listEndpoints: () => Promise<unknown> }).listEndpoints = () =>
      Promise.resolve({
        endpoints: [{ ...preset, id: "deepseek", kind: "chat", hasKey: true, keyPreview: "sk-…ef",
          models: [{ id: "deepseek-v4-pro", capabilities: ["text"] }] }],
        defaultModel: null,
      });
    (ctx.llm as { revealKey: () => Promise<string> }).revealKey = () =>
      Promise.resolve("sk-secret-full");
    llmSettings.apply(ctx as never);
    const host = document.createElement("div");
    renders[0](host);
    document.body.append(host);
    (host.querySelector("button") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    const card = document.querySelector(".llm-card") as HTMLElement;
    (card.querySelectorAll("button")[1] as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    const form = document.querySelector(".llm-panel form") as HTMLFormElement;
    const keyInput = form.querySelector("[name=apiKey]") as HTMLInputElement;
    const eye = form.querySelector("[data-action=toggle-key]") as HTMLButtonElement;
    eye.click();
    await new Promise((r) => setTimeout(r));
    keyInput.value = "";
    keyInput.dispatchEvent(new Event("input"));
    eye.click();
    await new Promise((r) => setTimeout(r));
    expect(keyInput.value).toBe("");
    expect(form.querySelector(".llm-key-hint")?.textContent).toContain("已清空");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r));
    expect(saved[0]).toMatchObject({ id: "deepseek", apiKey: "", apiKeyDirty: true });
  });

  // 只揭示、未编辑、再隐藏 = 仍是“未动掩码”，Rust 侧安全保留旧 key。
  it("preserves the stored key after revealing and hiding without edits", async () => {
    const { ctx, saved, renders } = fakeCtx();
    (ctx.llm as { listEndpoints: () => Promise<unknown> }).listEndpoints = () =>
      Promise.resolve({
        endpoints: [{ ...preset, id: "deepseek", kind: "chat", hasKey: true, keyPreview: "sk-…ef",
          models: [{ id: "deepseek-v4-pro", capabilities: ["text"] }] }],
        defaultModel: null,
      });
    (ctx.llm as { revealKey: () => Promise<string> }).revealKey = () =>
      Promise.resolve("sk-secret-full");
    llmSettings.apply(ctx as never);
    const host = document.createElement("div");
    renders[0](host);
    document.body.append(host);
    (host.querySelector("button") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    const card = document.querySelector(".llm-card") as HTMLElement;
    (card.querySelectorAll("button")[1] as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    const form = document.querySelector(".llm-panel form") as HTMLFormElement;
    const eye = form.querySelector("[data-action=toggle-key]") as HTMLButtonElement;
    eye.click();
    await new Promise((r) => setTimeout(r));
    eye.click();
    await new Promise((r) => setTimeout(r));
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r));
    expect(saved[0]).toMatchObject({ id: "deepseek", apiKey: "" });
    expect("apiKeyDirty" in (saved[0] as object)).toBe(false);
  });

  // 固化 2026-10-01 GUI 人工冒烟旅程：保存后的列表行（含 🔑）+ 行内探测延迟。
  it("renders a saved endpoint row with key badge and probes latency inline", async () => {
    const { ctx, renders } = fakeCtx();
    (ctx.llm as { listEndpoints: () => Promise<unknown> }).listEndpoints = () =>
      Promise.resolve({
        endpoints: [{ ...preset, id: "mock", name: "Local Mock", kind: "chat", vendor: "zhipu",
          baseUrl: "http://127.0.0.1:18042/v1", hasKey: true, keyPreview: "sk-…ef",
          models: [{ id: "glm-5.3", capabilities: ["text", "vision"] }] }],
        defaultModel: null,
      });
    llmSettings.apply(ctx as never);
    const host = document.createElement("div");
    renders[0](host);
    document.body.append(host);
    (host.querySelector("button") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    const row = document.querySelector(".llm-card") as HTMLElement;
    expect(row.textContent).toContain("Local Mock");
    expect(row.textContent).toContain("127.0.0.1:18042");
    expect(row.textContent).toContain("🔑");
    expect(row.textContent).toContain("智谱");
    const probeBtn = row.querySelectorAll("button")[0] as HTMLButtonElement; // 顺序：探测/编辑/删除
    probeBtn.click();
    await new Promise((r) => setTimeout(r));
    expect(row.querySelector(".llm-probe-result")?.textContent).toBe("42ms");
  });

  // 固化探测失败路径：LlmError 以 code: message 归一内联展示（人工冒烟对应 UNAUTHORIZED: HTTP 401）。
  it("shows a normalized error code when probe fails", async () => {
    const { ctx, renders } = fakeCtx();
    (ctx.llm as { listEndpoints: () => Promise<unknown> }).listEndpoints = () =>
      Promise.resolve({
        endpoints: [{ ...preset, id: "mock", name: "Local Mock", kind: "chat", vendor: "deepseek",
          baseUrl: "https://api.deepseek.com/v1", hasKey: true, keyPreview: "sk-…ef",
          models: [{ id: "deepseek-v4-pro", capabilities: ["text"] }] }],
        defaultModel: null,
      });
    (ctx.llm as { probe: () => Promise<never> }).probe = () =>
      Promise.reject({ code: "UNAUTHORIZED", message: "HTTP 401" });
    llmSettings.apply(ctx as never);
    const host = document.createElement("div");
    renders[0](host);
    document.body.append(host);
    (host.querySelector("button") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    const row = document.querySelector(".llm-card") as HTMLElement;
    const probeBtn = row.querySelectorAll("button")[0] as HTMLButtonElement;
    probeBtn.click();
    await new Promise((r) => setTimeout(r));
    expect(row.querySelector(".llm-probe-result")?.textContent).toBe("UNAUTHORIZED: HTTP 401");
  });
});
