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
});
