import { expect, test } from "vitest";
import { Context } from "cordis";
import { boot } from "../src/loader/boot";
import { loadManifest } from "../src/loader/manifest";
import type { ModuleTable } from "../src/loader/table";

const entry = (plugin: object, defaults: Record<string, unknown> = {}) =>
  ({ plugin: plugin as never, defaults });

test("boot: 注入缺失 fail-loud 点名", async () => {
  const table: ModuleTable = { "p-orphan": entry({ name: "p-orphan", inject: ["nope"], apply() {} }) };
  await expect(boot(new Context(), { plugins: [{ id: "p-orphan", enabled: true, config: {} }] }, table))
    .rejects.toThrow(/p-orphan/);
});

test("boot: enabled=false 跳过；未知 id 报错", async () => {
  const table: ModuleTable = { "p-on": entry({ name: "p-on", apply() {} }) };
  await expect(boot(new Context(), { plugins: [{ id: "p-on", enabled: false, config: {} }] }, table))
    .resolves.toBeUndefined();
  await expect(boot(new Context(), { plugins: [{ id: "ghost", enabled: true, config: {} }] }, table))
    .rejects.toThrow(/ghost/);
});

test("boot: defaults 与 config 合并后传入 apply", async () => {
  const seen: unknown[] = [];
  const table: ModuleTable = { "p-cfg": entry({ name: "p-cfg", apply(_c, cfg) { seen.push(cfg); } }, { a: 1, b: 1 }) };
  await boot(new Context(), { plugins: [{ id: "p-cfg", enabled: true, config: { b: 2 } }] }, table);
  expect(seen).toEqual([{ a: 1, b: 2 }]);
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
