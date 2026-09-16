import { expect, test } from "vitest";
import { Context } from "cordis";
import { guardExternalModule } from "../src/loader/guard";
import type { PluginModule } from "../src/loader/types";

function demoModule(): PluginModule {
  return {
    name: "ext-demo",
    inject: ["files"],
    apply: (ctx: any) => {
      ctx.files.readTree(); // 已声明：放行
      return () => {};
    },
  };
}

test("门面放行 inject 声明的服务，未声明的读即抛教学错误，赋值即抛只读", () => {
  // cordis 对未满足 inject 的 fiber 会停等待态不跑 apply，故门面单测手动驱动；
  // 真 Context 的集成行为归 Task 3 的 activate 测试。
  const files = { readTree: () => ["a.md"] };
  const mod = guardExternalModule({
    name: "ext-demo",
    inject: ["files"],
    apply: (ctx: any) => {
      expect(ctx.files.readTree()).toEqual(["a.md"]);
      expect(() => ctx.windows).toThrow(/未声明的服务 "windows"/);
      expect(() => (ctx.windows = 1)).toThrow(/只读/);
      expect("files" in ctx).toBe(true);
      expect("windows" in ctx).toBe(false);
      return () => {};
    },
  });
  (mod.apply as any)({ files }, {});
});

test("门面：声明过的服务方法放行，返回值里的 Context 被拒（同步与 Promise 解包）", async () => {
  const realCtx = new Context();
  const evil = {
    self: () => realCtx,
    read: () => 42,
    asyncSelf: async () => realCtx,
    asyncRead: async () => 43,
  };
  const mod = guardExternalModule({
    name: "ext-demo",
    inject: ["files"],
    apply: (ctx: any) => {
      expect(ctx.files.read()).toBe(42);
      expect(() => ctx.files.self()).toThrow(/Context/);
      return () => {};
    },
  });
  // 手动驱动：构造一个带 files 属性的假 ctx（真 Context 集成归 Task 3）
  (mod.apply as any)({ files: evil }, {});
  // Promise 解包后的 Context 同样被拒；普通异步值放行。断言必须 await 到，
  // 故插件 apply 走 async 由测试 await（控制器 R3）。
  const wrappedApply = guardExternalModule({
    name: "ext-demo",
    inject: ["files"],
    apply: async (ctx: any) => {
      await expect(ctx.files.asyncRead()).resolves.toBe(43);
      await expect(ctx.files.asyncSelf()).rejects.toThrow(/Context/);
      return () => {};
    },
  });
  await (wrappedApply.apply as any)({ files: evil }, {});
});

test("模块形状原样透传（name/inject 不变，apply 被包装）", () => {
  const src = demoModule();
  const wrapped = guardExternalModule(src);
  expect(wrapped.name).toBe(src.name);
  expect(wrapped.inject).toBe(src.inject);
  expect(wrapped.apply).not.toBe(src.apply);
});
