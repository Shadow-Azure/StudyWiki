import { expect, test, vi } from "vitest";
import { PluginsService, SUPPORTED_API_VERSIONS } from "../src/host/plugins";

const deps = (invoke: ReturnType<typeof vi.fn>, loadExternal?: (code: string) => Promise<Record<string, unknown>>) => ({
  invoke,
  loadExternal: loadExternal ?? (async () => ({})),
  pickTgz: vi.fn(async () => "/x/demo.tgz"),
});

test("install/remove/list/readManifest/writeManifest 透传参数与错误", async () => {
  const invoke = vi.fn().mockResolvedValue("demo");
  const p = new PluginsService(deps(invoke));
  await expect(p.install("demo@1.0.0")).resolves.toBe("demo");
  expect(invoke).toHaveBeenCalledWith("install_plugin", { spec: "demo@1.0.0" });
  await p.remove("demo");
  expect(invoke).toHaveBeenCalledWith("remove_plugin", { name: "demo" });
  await p.list();
  expect(invoke).toHaveBeenCalledWith("list_plugins");
  await p.readManifest();
  expect(invoke).toHaveBeenCalledWith("read_manifest");
  await p.writeManifest({ plugins: [] });
  expect(invoke).toHaveBeenLastCalledWith("write_manifest", { json: JSON.stringify({ plugins: [] }, null, 2) });
});

test("importFromTgz：选文件后走 import_plugin；取消返回 null 不调命令", async () => {
  const invoke = vi.fn().mockResolvedValue("demo");
  const d = deps(invoke);
  await expect(new PluginsService(d).importFromTgz()).resolves.toBe("demo");
  expect(invoke).toHaveBeenCalledWith("import_plugin", { path: "/x/demo.tgz" });
  const cancelled = deps(vi.fn());
  cancelled.pickTgz = vi.fn(async () => null);
  await expect(new PluginsService(cancelled).importFromTgz()).resolves.toBeNull();
  expect(cancelled.invoke).not.toHaveBeenCalled();
});

test("loadModule：apiVersion 支持集外拒载（点名版本）", async () => {
  const invoke = vi.fn().mockResolvedValue({ code: "export const name='d'", apiVersion: 2 });
  const p = new PluginsService(deps(invoke));
  await expect(p.loadModule("d")).rejects.toThrow(/apiVersion 2.*支持集/);
});

test("loadModule：形状校验 fail-loud 点名缺什么", async () => {
  const invoke = vi.fn().mockResolvedValue({ code: "x", apiVersion: 1 });
  const noName = new PluginsService(deps(invoke, async () => ({ apply: () => {} })));
  await expect(noName.loadModule("d")).rejects.toThrow(/缺.*name/);
  const noApply = new PluginsService(deps(invoke, async () => ({ name: "d" })));
  await expect(noApply.loadModule("d")).rejects.toThrow(/缺.*apply/);
  const badInject = new PluginsService(deps(invoke, async () => ({ name: "d", apply: () => {}, inject: [1] })));
  await expect(badInject.loadModule("d")).rejects.toThrow(/inject/);
});

test("loadModule：支持集内 + 形状合法即返回模块（blob 原料逐字传递）", async () => {
  const code = "export const name = 'demo-hello';";
  const invoke = vi.fn().mockResolvedValue({ code, apiVersion: 1 });
  const loadExternal = vi.fn(async (c: string) => {
    expect(c).toBe(code);
    return { name: "demo-hello", inject: ["slots"], apply: () => {} };
  });
  const mod = await new PluginsService(deps(invoke, loadExternal)).loadModule("demo-hello");
  expect(mod.name).toBe("demo-hello");
  expect(SUPPORTED_API_VERSIONS).toEqual([1]);
});

test("loadModule: inject 非 undefined 且非字符串数组即拒（undefined 合法）", async () => {
  const bad = {
    invoke: async () => ({ code: "export const name=1", apiVersion: 1 }),
    loadExternal: async () => ({ name: "demo", apply: () => {}, inject: "slots" }),
    pickTgz: async () => null,
  };
  const svc = new PluginsService(bad);
  await expect(svc.loadModule("demo")).rejects.toThrow("inject 必须是字符串数组");

  const noInject = { ...bad, loadExternal: async () => ({ name: "demo", apply: () => {} }) };
  await expect(new PluginsService(noInject).loadModule("demo")).resolves.toMatchObject({ name: "demo" });
});
