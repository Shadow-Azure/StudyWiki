import { describe, expect, it } from "vitest";
import { LlmError, LlmService, type LlmDeps } from "../src/host/llm";

const redacted = {
  endpoints: [
    {
      id: "deepseek",
      name: "DeepSeek",
      kind: "chat",
      baseUrl: "https://api.deepseek.com/v1",
      hasKey: true,
      keyPreview: "sk-…ef",
      models: [{ id: "deepseek-v4-flash", capabilities: ["text"] }],
    },
    {
      id: "zhipu",
      name: "智谱 GLM",
      kind: "chat",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      hasKey: true,
      keyPreview: "ab…yz",
      models: [{ id: "glm-5.3", capabilities: ["text", "vision"] }],
    },
  ],
  defaultModel: "deepseek-v4-flash",
};

function depsWith(calls: { cmd: string; args?: unknown }[], chatResult?: unknown): LlmDeps {
  return {
    invoke: (cmd, args) => {
      calls.push({ cmd, args });
      if (cmd === "llm_list_endpoints") return Promise.resolve(redacted);
      if (cmd === "llm_chat") return Promise.resolve(chatResult ?? { content: "ok", finishReason: "stop" });
      return Promise.resolve(null);
    },
  };
}

describe("LlmService", () => {
  it("routes an explicit model to its owning endpoint", async () => {
    const calls: { cmd: string; args?: unknown }[] = [];
    const llm = new LlmService(depsWith(calls));
    const r = await llm.chat({ model: "glm-5.3", messages: [{ role: "user", content: "hi" }] });
    expect(r.content).toBe("ok");
    expect(calls.at(-1)).toMatchObject({
      cmd: "llm_chat",
      args: { req: { endpointId: "zhipu", model: "glm-5.3", messages: [{ role: "user", content: "hi" }] } },
    });
  });

  it("falls back to defaultModel and reports MODEL_UNSPECIFIED without it", async () => {
    const calls: { cmd: string; args?: unknown }[] = [];
    const llm = new LlmService(depsWith(calls));
    await llm.chat({ messages: [{ role: "user", content: "hi" }] });
    expect(calls.at(-1)?.args).toMatchObject({ req: { model: "deepseek-v4-flash", endpointId: "deepseek" } });
    const noDefault = new LlmService({
      invoke: (cmd) =>
        cmd === "llm_list_endpoints"
          ? Promise.resolve({ ...redacted, defaultModel: null })
          : Promise.resolve(null),
    });
    await expect(noDefault.chat({ messages: [] })).rejects.toMatchObject({ code: "MODEL_UNSPECIFIED" });
  });

  it("throws MODEL_UNKNOWN and MODEL_AMBIGUOUS from the routing layer", async () => {
    const llm = new LlmService(depsWith([]));
    await expect(llm.chat({ model: "nope", messages: [] })).rejects.toMatchObject({ code: "MODEL_UNKNOWN" });
    const dup = new LlmService({
      invoke: (cmd) =>
        cmd === "llm_list_endpoints"
          ? Promise.resolve({
              ...redacted,
              endpoints: [...redacted.endpoints, { ...redacted.endpoints[0], id: "copy" }],
            })
          : Promise.resolve(null),
    });
    await expect(dup.chat({ model: "deepseek-v4-flash", messages: [] })).rejects.toMatchObject({
      code: "MODEL_AMBIGUOUS",
    });
  });

  it("normalizes IPC rejections into LlmError with the Rust code", async () => {
    const llm = new LlmService({
      invoke: (cmd) =>
        cmd === "llm_chat"
          ? Promise.reject({ code: "UNAUTHORIZED", message: "bad key" })
          : Promise.resolve(redacted),
    });
    const err = await llm.chat({ model: "glm-5.3", messages: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("exposes presets, upsert, remove and probe as thin command wrappers", async () => {
    const calls: { cmd: string; args?: unknown }[] = [];
    const llm = new LlmService(depsWith(calls));
    await llm.listPresets();
    await llm.upsertEndpoint({ id: "x", name: "X", kind: "chat", baseUrl: "https://h/v1", apiKey: "k", models: [] });
    await llm.removeEndpoint("x");
    await llm.probe("x");
    expect(calls.map((c) => c.cmd)).toEqual([
      "llm_list_presets",
      "llm_upsert_endpoint",
      "llm_remove_endpoint",
      "llm_probe",
    ]);
  });
});
