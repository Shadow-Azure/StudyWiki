// 手写 cordis v4 类型面：tsc 走这里；vite/vitest alias 仍指 src/index.ts（运行时真实源码）。
// 升级 fork 时同步本文件（登记在 vendor/VENDORED.md）。符号集 = 本仓库实际使用的 API 面。

/** Fiber 生命周期状态（数值对照 vendor/cordis/src/fiber.ts 逐字抄写）。 */
export declare enum FiberState {
  PENDING = 0,
  LOADING = 1,
  ACTIVE = 2,
  FAILED = 3,
  DISPOSED = 4,
  UNLOADING = 5,
}

/** 插件 fiber：ctx.plugin() 的返回值。 */
export interface Fiber {
  /** 当前生命周期状态。 */
  state: FiberState;
}

/** 服务反射面（本仓库使用的子集）。 */
export interface Reflect {
  /** 以 name 提供服务，占据 ctx.<name>。 */
  provide(name: string, instance: unknown): void;
}

/** 宿主上下文：插件 apply 的第一参数；宿主服务经 src/host/context.d.ts 声明合并挂入。 */
export declare class Context {
  /** 服务反射面。 */
  reflect: Reflect;
  /** 装载插件并返回其 fiber。 */
  plugin(plugin: unknown, config?: unknown): Fiber;
}
