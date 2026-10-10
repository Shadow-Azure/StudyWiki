// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, test } from "vitest";
import * as llmSettings from "../src/plugins/llm-settings";

const preset = {
  vendor: "deepseek",
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com/v1",
  models: [{ id: "deepseek-v4-pro", capabilities: ["text"] }],
};

// 钉子（PR #15 检视 §6.14）：doc-markdown 的关闭守卫在每个窗口注册 onCloseRequested
// 监听后，tauri 无条件拦截原生关闭（prevent_close），关窗只能经 wrapper 自动
// destroy()——该调用受 ACL 门禁，权限缺失时被拒且拒绝落在包装层 promise，
// release 下无可见出口（症状：点 X 零反应）。这类失败无运行期症状可测
// （vitest mock 掉 Tauri 边界，权限面在测试射程外），只能钉配置面：
// capabilities 必须持有窗口销毁权限。
test("capabilities：default 含窗口销毁权限 core:window:allow-destroy（X 关窗链路终点）", () => {
  const raw = readFileSync(resolve(process.cwd(), "src-tauri/capabilities/default.json"), "utf8");
  const caps = JSON.parse(raw) as { permissions: string[] };
  expect(caps.permissions).toContain("core:window:allow-destroy");
});

describe("llm-settings capability checkboxes", () => {
  function fakeCtx() {
    const upserts: { endpoint: unknown }[] = [];
    const llm = {
      listPresets: () => Promise.resolve([preset]),
      listEndpoints: () => Promise.resolve({ endpoints: [], defaultModel: null }),
      upsertEndpoint: (endpoint: unknown) => {
        upserts.push({ endpoint });
        return Promise.resolve();
      },
      removeEndpoint: () => Promise.resolve(),
      setDefaultModel: () => Promise.resolve(),
      probe: () => Promise.resolve(42),
    };
    const renders: ((host: HTMLElement) => void)[] = [];
    const slots = {
      register: (_slot: string, render: (host: HTMLElement) => void) => {
        renders.push(render);
        return () => {};
      },
    };
    return { ctx: { llm, slots }, upserts, renders };
  }

  it("tools 能力可勾选保存并进入 upsert 载荷", async () => {
    const { ctx, upserts, renders } = fakeCtx();
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
    const tools = form.querySelector("[name=tools]") as HTMLInputElement;
    expect(tools).not.toBeNull();
    tools.checked = true;
    tools.dispatchEvent(new Event("change"));
    (form.querySelector("[name=apiKey]") as HTMLInputElement).value = "sk-test";
    (ctx.llm as { listEndpoints: () => Promise<unknown> }).listEndpoints = () =>
      Promise.resolve({
        endpoints: [{ ...preset, id: "deepseek", kind: "chat", hasKey: false,
          models: [{ id: "deepseek-v4-pro", capabilities: ["text", "tools"] }] }],
        defaultModel: null,
      });
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r));
    const caps = (upserts[0].endpoint as { models: { capabilities: string[] }[] }).models[0].capabilities;
    expect(caps).toContain("tools");

    const card = document.querySelector(".llm-card") as HTMLElement;
    (card.querySelectorAll("button")[1] as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r));
    const editForm = document.querySelector(".llm-panel form") as HTMLFormElement;
    const editTools = editForm.querySelector("[name=tools]") as HTMLInputElement;
    expect(editTools.checked).toBe(true);
    editTools.checked = false;
    editTools.dispatchEvent(new Event("change"));
    editForm.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r));
    const savedCaps = (upserts[1].endpoint as { models: { capabilities: string[] }[] }).models[0].capabilities;
    expect(savedCaps).not.toContain("tools");
  });
});
