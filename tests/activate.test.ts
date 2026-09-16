import { expect, test, vi } from "vitest";
import { Context } from "cordis";
import {
  activateExternal, activationFailures, deactivateExternal, reloadExternal,
  runningExternals, serialized,
} from "../src/loader/activate";

const noopDeps = { snapshot: vi.fn(async () => {}) };
const fastWait = { intervalMs: 0, budgetMs: 50, sleep: () => Promise.resolve() };

function hello(name = "ext-demo"): { name: string; inject?: string[]; apply: (ctx: never, config: unknown) => () => void } {
  return { name, apply: () => () => {} };
}

test("激活成功：登记 running + 快照被调 + guard 包装生效（apply 拿不到未声明服务）", async () => {
  const ctx = new Context();
  const seen: string[] = [];
  await activateExternal(ctx, "demo", {
    name: "ext-demo",
    apply: (ctx2: any) => {
      try { ctx2.files; } catch (e) { seen.push((e as Error).message); }
      return () => {};
    },
  }, {}, { ...noopDeps, snapshot: async (n) => { seen.push(`snap:${n}`); } });
  expect(runningExternals().has("demo")).toBe(true);
  expect(seen.some((m) => m.includes("未声明的服务"))).toBe(true); // 无 inject 声明
  expect(seen).toContain("snap:demo");
  await deactivateExternal("demo");
});

test("声明服务未提供：审计超时失败，fiber 被处置，记入 activationFailures", async () => {
  const ctx = new Context();
  await expect(
    activateExternal(ctx, "stuck", { ...hello(), inject: ["nonexistent"] } as never, {}, { ...noopDeps, wait: fastWait }),
  ).rejects.toThrow(/审计超时|未激活/);
  expect(runningExternals().has("stuck")).toBe(false);
  expect(activationFailures().get("stuck")).toMatch(/声明的服务未提供/);
});

test("重载失败回退旧版：新模块激活抛错，旧模块重新激活并仍在 running", async () => {
  const ctx = new Context();
  const v1 = hello();
  await activateExternal(ctx, "demo", v1, {}, noopDeps);
  const bad = { name: "ext-demo", apply: () => { throw new Error("new code boom"); } };
  await expect(reloadExternal(ctx, "demo", bad as never, {}, { ...noopDeps, wait: fastWait })).rejects.toThrow("new code boom");
  expect(runningExternals().has("demo")).toBe(true); // 旧版已恢复
  expect(activationFailures().has("demo")).toBe(false);
  await deactivateExternal("demo");
});

test("同一插件操作串行：两次 reload 不交错", async () => {
  const ctx = new Context();
  const order: string[] = [];
  const slow = (tag: string) => ({
    name: "ext-demo",
    apply: () => { order.push(`apply:${tag}`); return () => { order.push(`dispose:${tag}`); }; },
  });
  await activateExternal(ctx, "demo", slow("v1"), {}, noopDeps);
  await Promise.all([
    reloadExternal(ctx, "demo", slow("v2") as never, {}, noopDeps),
    reloadExternal(ctx, "demo", slow("v3") as never, {}, noopDeps),
  ]);
  expect(order).toEqual(["apply:v1", "dispose:v1", "apply:v2", "dispose:v2", "apply:v3"]);
  await deactivateExternal("demo");
});
