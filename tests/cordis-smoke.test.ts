import { expect, test } from "vitest";
import { Context, FiberState } from "cordis";

test("vendored cordis: provide 使服务占 ctx.<key>，inject 插件激活为 ACTIVE", async () => {
  const ctx = new Context();
  const service = { value: 42 };
  ctx.reflect.provide("answer", service);
  expect((ctx as any).answer).toBe(service);

  let seen = 0;
  const plugin = {
    name: "probe",
    inject: ["answer"],
    apply(c: any) {
      seen = c.answer.value;
      return () => {}; // 可逆副作用：清理函数
    },
  };
  const fiber = ctx.plugin(plugin, {});
  await new Promise((r) => setTimeout(r, 20)); // fiber 异步激活
  expect(seen).toBe(42);
  expect(fiber.state).toBe(FiberState.ACTIVE);
});

test("vendored cordis: 注入缺失时 fiber 停在非 ACTIVE", async () => {
  const ctx = new Context();
  const plugin = { name: "orphan", inject: ["missing"], apply() {} };
  const fiber = ctx.plugin(plugin, {});
  await new Promise((r) => setTimeout(r, 20));
  expect(fiber.state).not.toBe(FiberState.ACTIVE);
});
