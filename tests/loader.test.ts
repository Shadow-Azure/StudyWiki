import { expect, test } from "vitest";
import { Context } from "cordis";
import { boot } from "../src/loader/boot";
import { loadManifest } from "../src/loader/manifest";
import type { ModuleTable } from "../src/loader/table";

const entry = (plugin: object, defaults: Record<string, unknown> = {}) =>
  ({ plugin: plugin as never, defaults });

const noExt = async () => {
  throw new Error("不应触达外置装载");
};

test("boot: 注入缺失 fail-loud 点名", async () => {
  const table: ModuleTable = { "p-orphan": entry({ name: "p-orphan", inject: ["nope"], apply() {} }) };
  await expect(boot(new Context(), { plugins: [{ id: "p-orphan", enabled: true, config: {} }] }, table, noExt))
    .rejects.toThrow(/p-orphan/);
});

test("boot: enabled=false 跳过；未知 id 报错；返回报告形状", async () => {
  const table: ModuleTable = { "p-on": entry({ name: "p-on", apply() {} }) };
  await expect(boot(new Context(), { plugins: [{ id: "p-on", enabled: false, config: {} }] }, table, noExt))
    .resolves.toEqual({ loaded: [], broken: [] });
  await expect(boot(new Context(), { plugins: [{ id: "ghost", enabled: true, config: {} }] }, table, noExt))
    .rejects.toThrow(/ghost/);
});

test("boot: defaults 与 config 合并后传入 apply", async () => {
  const seen: unknown[] = [];
  const table: ModuleTable = { "p-cfg": entry({ name: "p-cfg", apply(_c, cfg) { seen.push(cfg); } }, { a: 1, b: 1 }) };
  await boot(new Context(), { plugins: [{ id: "p-cfg", enabled: true, config: { b: 2 } }] }, table, noExt);
  expect(seen).toEqual([{ a: 1, b: 2 }]);
});

test("boot: ext: 行经 loadExternal 装载，row.config 直传（无 defaults 合并）", async () => {
  const table: ModuleTable = { "p-on": entry({ name: "p-on", apply() {} }) };
  const configs: unknown[] = [];
  const loadExternal = async (name: string) => ({
    name: `ext-${name}`,
    apply(_c: unknown, cfg: unknown) { configs.push(cfg); },
  });
  const report = await boot(
    new Context(),
    { plugins: [{ id: "p-on", enabled: true, config: {} }, { id: "ext:demo", enabled: true, config: { x: 1 } }] },
    table,
    loadExternal,
  );
  expect(report).toEqual({ loaded: ["p-on", "ext:demo"], broken: [] });
  expect(configs).toEqual([{ x: 1 }]);
});

test("boot: ext: 行装载失败分治为坏行，不阻断其余插件", async () => {
  const table: ModuleTable = { "p-on": entry({ name: "p-on", apply() {} }) };
  const loadExternal = async () => {
    throw new Error("读 demo/package.json 失败：NotFound");
  };
  const report = await boot(
    new Context(),
    { plugins: [{ id: "ext:demo", enabled: true, config: {} }, { id: "p-on", enabled: true, config: {} }] },
    table,
    loadExternal,
  );
  expect(report.loaded).toEqual(["p-on"]);
  expect(report.broken).toEqual([{ id: "ext:demo", reason: "读 demo/package.json 失败：NotFound" }]);
});

test("boot: ext: 行审计卡死也归坏行；内置卡死仍 fail-loud", async () => {
  const table: ModuleTable = { "p-bad": entry({ name: "p-bad", inject: ["nope"], apply() {} }) };
  const stuck = async () => ({ name: "ext-stuck", inject: ["nope"], apply() {} });
  // 外置卡死：不抛，进 broken
  const r1 = await boot(new Context(), { plugins: [{ id: "ext:stuck", enabled: true, config: {} }] }, {}, stuck);
  expect(r1.broken[0].id).toBe("ext:stuck");
  expect(r1.broken[0].reason).toMatch(/未激活/);
  // 内置卡死：照旧抛（契约不变）
  await expect(boot(new Context(), { plugins: [{ id: "p-bad", enabled: true, config: {} }] }, table, noExt))
    .rejects.toThrow(/装载审计失败/);
});

test("boot: 禁用的 ext: 行不触达装载通道", async () => {
  const table: ModuleTable = { "p-on": entry({ name: "p-on", apply() {} }) };
  await expect(
    boot(new Context(), { plugins: [{ id: "ext:off", enabled: false, config: {} }] }, table, noExt),
  ).resolves.toEqual({ loaded: [], broken: [] });
});

test("loadManifest: 缺失时生成默认并写回", async () => {
  const table: ModuleTable = { "p-x": entry({ name: "p-x", apply() {} }, { k: "v" }) };
  let written = "";
  const m = await loadManifest(async () => null, async (j) => { written = j; }, table);
  expect(m.plugins).toEqual([{ id: "p-x", enabled: true, config: { k: "v" } }]);
  expect(JSON.parse(written).plugins[0].id).toBe("p-x");
});

test("loadManifest: 损坏清单 fail-loud", async () => {
  await expect(loadManifest(async () => "{oops", async () => {}, {})).rejects.toThrow();
});

test("loadManifest: 行缺 enabled fail-loud 点名", async () => {
  const raw = JSON.stringify({ plugins: [{ id: "p-x", config: {} }] });
  await expect(loadManifest(async () => raw, async () => {}, {}))
    .rejects.toThrow(/插件清单损坏.*enabled/);
  const rawStr = JSON.stringify({ plugins: [{ id: "p-x", enabled: "yes", config: {} }] });
  await expect(loadManifest(async () => rawStr, async () => {}, {}))
    .rejects.toThrow(/插件清单损坏.*enabled/);
});

test("loadManifest: config 非 object fail-loud 点名 id", async () => {
  const raw = JSON.stringify({ plugins: [{ id: "p-y", enabled: true, config: "nope" }] });
  await expect(loadManifest(async () => raw, async () => {}, {}))
    .rejects.toThrow(/插件清单损坏.*p-y.*config/);
  const rawArr = JSON.stringify({ plugins: [{ id: "p-z", enabled: true, config: [1] }] });
  await expect(loadManifest(async () => rawArr, async () => {}, {}))
    .rejects.toThrow(/插件清单损坏.*p-z.*config/);
});

test("loadManifest: 存量清单合并静态表新增内置行（enabled true）并写回；ext: 行不动", async () => {
  const table: ModuleTable = {
    "p-old": entry({ name: "p-old", apply() {} }),
    "p-new": entry({ name: "p-new", apply() {} }, { k: 1 }),
  };
  const raw = JSON.stringify({
    plugins: [
      { id: "p-old", enabled: false, config: {} },
      { id: "ext:demo", enabled: true, config: { x: 1 } },
    ],
  });
  const written: string[] = [];
  const m = await loadManifest(async () => raw, async (j) => { written.push(j); }, table);
  expect(m.plugins.map((r) => r.id)).toEqual(["p-old", "ext:demo", "p-new"]);
  expect(m.plugins[2]).toEqual({ id: "p-new", enabled: true, config: { k: 1 } });
  expect(written).toHaveLength(1); // 合并发生才写回
  expect(JSON.parse(written[0]).plugins[2].enabled).toBe(true);
});

test("loadManifest: 清单已含全部内置行则不写回（无谓写盘）", async () => {
  const table: ModuleTable = { "p-x": entry({ name: "p-x", apply() {} }) };
  const raw = JSON.stringify({ plugins: [{ id: "p-x", enabled: false, config: {} }] });
  const written: string[] = [];
  const m = await loadManifest(async () => raw, async (j) => { written.push(j); }, table);
  expect(m.plugins[0].enabled).toBe(false); // 既有开关不被迁移覆盖
  expect(written).toHaveLength(0);
});
