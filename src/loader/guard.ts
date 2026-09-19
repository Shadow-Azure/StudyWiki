import { Context } from "cordis";
import type { PluginModule } from "./types";

const jsProtocolProperties = new Set(["then", "toJSON", "toString", "valueOf"]);

/** 外置插件 guard 门面（只包外置；内置一等公民静态表直装）。
 * 白名单：inject 声明过的服务名；未声明的 JS 协议属性按缺席返回 undefined，
 * 其余属性读即抛教学错误，赋值/删除/定义均抛只读错误，
 * 服务返回值里的 cordis Context 一律拒绝（防经返回值摸到别的上下文）。
 * 边界诚实化：本门面收窄的是服务面，不是语言能力——外置插件仍可触达
 * DOM/fetch/全局对象，这不是沙箱（同进程真沙箱在停机坪，见 Phase 4 Note）。
 * @param mod 已过形状校验的外置模块。
 * @returns 包装后的模块：name/inject 透传，apply 的 ctx 换门面。 */
export function guardExternalModule(mod: PluginModule): PluginModule {
  const declared = new Set(mod.inject ?? []);
  return {
    name: mod.name,
    inject: mod.inject,
    apply(ctx: unknown, config: unknown) {
      return mod.apply(facade(mod.name, ctx, declared) as never, config);
    },
  };
}

/** 单插件门面 Proxy：按声明集合放行/教学拒绝。 */
function facade(name: string, ctx: unknown, declared: Set<string>): unknown {
  const wrapped = new Map<string, unknown>();
  return new Proxy(Object.create(null), {
    get(_target, prop) {
      // symbol 探测与未声明 JS 协议属性一律缺席；已声明同名服务优先放行。
      if (typeof prop !== "string") return undefined;
      if (!declared.has(prop) && jsProtocolProperties.has(prop)) return undefined;
      if (!declared.has(prop)) {
        throw new Error(
          `外置插件 ${name} 访问了未声明的服务 "${prop}"——在模块的 inject 数组里声明 "${prop}" 后重新加载。已声明：${[...declared].join(", ") || "（无）"}`,
        );
      }
      if (!wrapped.has(prop)) {
        wrapped.set(prop, guardService(name, prop, (ctx as Record<string, unknown>)[prop]));
      }
      return wrapped.get(prop);
    },
    set(_target, prop) {
      throw new Error(`外置插件 ${name} 的 ctx 只读：不可赋值 "${String(prop)}"`);
    },
    setPrototypeOf() {
      throw new Error(`外置插件 ${name} 的 ctx 只读：不可修改原型`);
    },
    deleteProperty(_target, prop) {
      throw new Error(`外置插件 ${name} 的 ctx 只读：不可删除属性 "${String(prop)}"`);
    },
    defineProperty(_target, prop) {
      throw new Error(`外置插件 ${name} 的 ctx 只读：不可定义属性 "${String(prop)}"`);
    },
    preventExtensions() {
      throw new Error(`外置插件 ${name} 的 ctx 只读：不可改变扩展形态`);
    },
    has(_target, prop) {
      return typeof prop === "string" && declared.has(prop);
    },
  });
}

/** 服务对象包装：方法以原 receiver 调用，返回值（含 Promise 解包）拒 Context。 */
function guardService(name: string, serviceName: string, service: unknown): unknown {
  if (service === null || (typeof service !== "object" && typeof service !== "function")) return service;
  const target = service as Record<string | symbol, unknown>;
  return new Proxy(target, {
    get(t, prop) {
      const value = Reflect.get(t, prop, t);
      if (typeof value !== "function") return denyContext(name, serviceName, value);
      return (...args: unknown[]) => {
        const result = Reflect.apply(value as (...a: unknown[]) => unknown, t, args);
        if (result instanceof Promise) return result.then((r) => denyContext(name, serviceName, r));
        return denyContext(name, serviceName, result);
      };
    },
    set(_target, prop) {
      throw new Error(
        `外置插件 ${name} 的服务 "${serviceName}" 只读：不可赋值属性 "${String(prop)}"`,
      );
    },
    setPrototypeOf() {
      throw new Error(`外置插件 ${name} 的服务 "${serviceName}" 只读：不可修改原型`);
    },
    deleteProperty(_target, prop) {
      throw new Error(
        `外置插件 ${name} 的服务 "${serviceName}" 只读：不可删除属性 "${String(prop)}"`,
      );
    },
    defineProperty(_target, prop) {
      throw new Error(
        `外置插件 ${name} 的服务 "${serviceName}" 只读：不可定义属性 "${String(prop)}"`,
      );
    },
    preventExtensions() {
      throw new Error(`外置插件 ${name} 的服务 "${serviceName}" 只读：不可改变扩展形态`);
    },
  });
}

/** Context 返回值拒绝（门面不提供别的上下文，教学文案点名来源服务）。 */
function denyContext(name: string, serviceName: string, value: unknown): unknown {
  if (value instanceof Context) {
    throw new Error(
      `外置插件 ${name} 的服务 "${serviceName}" 返回了 cordis Context——门面不提供 Context，请只经自身 inject 声明的服务操作`,
    );
  }
  return value;
}
