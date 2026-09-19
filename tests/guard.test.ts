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

test("门面放行 inject 声明的服务，未声明的读即抛教学错误，赋值/删除/定义均抛只读", () => {
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
      expect(() => delete ctx.files).toThrow(/只读.*删除/);
      expect(() =>
        Object.defineProperty(ctx, "files", { value: { injected: true } }),
      ).toThrow(/只读.*定义属性/);
      expect("files" in ctx).toBe(true);
      expect("windows" in ctx).toBe(false);
      expect(ctx.files.readTree()).toEqual(["a.md"]);
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

test("门面：JS 协议属性未声明时缺席，普通未声明服务仍教学报错", () => {
  const mod = guardExternalModule({
    name: "ext-demo",
    inject: ["files"],
    apply: (ctx: any) => {
      for (const prop of ["then", "toJSON", "toString", "valueOf"] as const) {
        expect(ctx[prop]).toBeUndefined();
        expect(prop in ctx).toBe(false);
      }
      expect(() => ctx.windows).toThrow(/未声明的服务 "windows"/);
      return () => {};
    },
  });
  (mod.apply as any)({ files: {} }, {});
});

test("门面：已声明同名服务优先于 JS 协议属性缺席规则", () => {
  const toString = () => "declared";
  const toJSON = () => ({ declared: true });
  const mod = guardExternalModule({
    name: "ext-demo",
    inject: ["toString", "toJSON"],
    apply: (ctx: any) => {
      expect(ctx.toString()).toBe("declared");
      expect(ctx.toJSON()).toEqual({ declared: true });
      expect("toString" in ctx).toBe(true);
      expect("toJSON" in ctx).toBe(true);
      return () => {};
    },
  });
  (mod.apply as any)({ toString, toJSON }, {});
});

test("门面：修改原型与扩展形态均失败且不改原始 ctx", () => {
  const replacementPrototype = {};
  const rawCtx = { files: { readTree: () => ["a.md"] } };
  const originalPrototype = Object.getPrototypeOf(rawCtx);
  const mod = guardExternalModule({
    name: "ext-demo",
    inject: ["files"],
    apply: (ctx: any) => {
      expect(() => Object.setPrototypeOf(ctx, replacementPrototype)).toThrow(
        /ctx 只读.*修改原型/,
      );
      expect(() => Object.preventExtensions(ctx)).toThrow(/ctx 只读.*扩展形态/);
      expect(Object.getPrototypeOf(rawCtx)).toBe(originalPrototype);
      expect(Object.isExtensible(rawCtx)).toBe(true);
      return () => {};
    },
  });
  (mod.apply as any)(rawCtx, {});
});

test("服务代理：赋值、删除与 defineProperty 均失败且不改原始服务对象", () => {
  const files = { existing: 1 };
  const mod = guardExternalModule({
    name: "ext-demo",
    inject: ["files"],
    apply: (ctx: any) => {
      expect(() => (ctx.files.existing = 2)).toThrow(/服务 "files" 只读.*赋值/);
      expect(() => delete ctx.files.existing).toThrow(/服务 "files" 只读.*删除/);
      expect(() =>
        Object.defineProperty(ctx.files, "injected", { value: 3, configurable: true }),
      ).toThrow(/服务 "files" 只读.*定义属性/);
      expect(files).toEqual({ existing: 1 });
      return () => {};
    },
  });
  (mod.apply as any)({ files }, {});
});

test("服务代理：修改原型与扩展形态均失败且不改原始服务对象", () => {
  const replacementPrototype = {};
  const files = { existing: 1 };
  const originalPrototype = Object.getPrototypeOf(files);
  const mod = guardExternalModule({
    name: "ext-demo",
    inject: ["files"],
    apply: (ctx: any) => {
      expect(() => Object.setPrototypeOf(ctx.files, replacementPrototype)).toThrow(
        /服务 "files" 只读.*修改原型/,
      );
      expect(() => Object.preventExtensions(ctx.files)).toThrow(
        /服务 "files" 只读.*扩展形态/,
      );
      expect(Object.getPrototypeOf(files)).toBe(originalPrototype);
      expect(Object.isExtensible(files)).toBe(true);
      expect(files).toEqual({ existing: 1 });
      return () => {};
    },
  });
  (mod.apply as any)({ files }, {});
});

test("模块形状原样透传（name/inject 不变，apply 被包装）", () => {
  const src = demoModule();
  const wrapped = guardExternalModule(src);
  expect(wrapped.name).toBe(src.name);
  expect(wrapped.inject).toBe(src.inject);
  expect(wrapped.apply).not.toBe(src.apply);
});
