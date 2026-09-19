import { Context, FiberState, type Fiber } from "cordis";
import { guardExternalModule } from "./guard";
import type { PluginModule } from "./types";

/** 运行期外置插件登记（本窗内存）：name → 活 fiber + 模块对象 + 配置。
 * 模块对象同时是"重载失败回退旧版"的唯一副本（磁盘已被新代码覆盖）。 */
interface ActiveExternal {
  fiber: Fiber;
  module: PluginModule;
  config: Record<string, unknown>;
}

const active = new Map<string, ActiveExternal>();
/** 最近一次激活失败的原因（面板行"装载失败"投影的数据源；running 时无条目）。 */
const failures = new Map<string, string>();
/** 同一插件的操作串行链（dsh starting 表等价物）：连点不交错。 */
const queues = new Map<string, Promise<unknown>>();

/** 激活参数：snapshot 通道 + 审计等待配置（测试注入零等待）。 */
export interface ActivateDeps {
  /** 激活成功后的版本快照通道；快照失败只 console.warn，不卡死激活。 */
  snapshot: (name: string) => Promise<unknown>;
  /** 审计等待参数：intervalMs 轮询间隔、budgetMs 上限、sleep 实现。 */
  wait?: { intervalMs?: number; budgetMs?: number; sleep?: (ms: number) => Promise<void> };
}

/** 串行化一个插件的运行期操作（前序失败不阻塞后续）。
 * @param name 外置插件名（队列键，同名操作排队）。
 * @param fn 待执行操作（激活/重载/停用）。
 * @returns 该操作的完成 Promise（前序操作的失败已吞掉，不会连坐）。 */
export function serialized<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(name) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(name, next);
  return next;
}

/** fiber 等待式审计（boot 的 50ms 固定静默覆盖不了运行期热路径）：
 * 轮询 fiber.state 到 ACTIVE；FAILED/DISPOSED 立即失败；超预算仍非 ACTIVE
 * 判失败并点名"声明的服务未提供"（声明了但宿主没提供的服务停等待态）。
 * @param fiber 待审的插件 fiber。
 * @param name 外置插件名（错误文案点名用）。
 * @param wait 审计参数（轮询间隔/预算/sleep 实现）；缺省 10ms × 2000ms 真实预算。
 * @returns 激活成功即 resolve；失败抛错（原因含插件自身错误或审计超时）。 */
export async function waitActive(fiber: Fiber, name: string, wait: ActivateDeps["wait"] = {}): Promise<void> {
  const { intervalMs = 10, budgetMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = wait;
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const state = fiber.state;
    if (state === FiberState.ACTIVE) return;
    if (state === FiberState.FAILED) {
      // cordis 把 apply 抛出的原始错误记在 fiber 上；await() 是公开重放通道。
      // 面板与坏行理由要的是"新代码 boom"这种真实原因，不是 state 数字。
      throw new Error(`外置插件 ${name} 激活失败：${await failureReason(fiber)}`);
    }
    if (state === FiberState.DISPOSED) {
      throw new Error(`外置插件 ${name} 激活失败（state=${state}）`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`外置插件 ${name} 激活审计超时（state=${state}）：声明的服务未提供？`);
    }
    await sleep(intervalMs);
  }
}

/** 取 fiber 上记录的真实失败原因（cordis 公开 await() 重放原始错误）。 */
async function failureReason(fiber: Fiber): Promise<string> {
  try {
    await fiber.await();
  } catch (e) {
    return (e as Error)?.message ?? String(e);
  }
  return "（fiber 未给出错误详情）";
}

/** 共享激活：guard 包装 → ctx.plugin → 等待审计（失败处置半成品 fiber）→
 * 登记 running → 版本快照。boot 的 ext: 行与面板全部热路径的唯一入口。
 * @param ctx 宿主上下文（外置模块挂载点）。
 * @param name 外置插件名（登记键与错误文案点名用）。
 * @param mod 已过形状校验的外置模块（将被 guard 门面包装）。
 * @param config 清单行配置（直传插件 apply）。
 * @param deps 快照通道与审计等待参数。
 * @returns 激活完成即 resolve；审计失败已 dispose 半成品 fiber 并记入失败表后抛错。 */
export async function activateExternal(
  ctx: Context,
  name: string,
  mod: PluginModule,
  config: Record<string, unknown>,
  deps: ActivateDeps,
): Promise<void> {
  const fiber = ctx.plugin(guardExternalModule(mod) as never, config);
  try {
    await waitActive(fiber, name, deps.wait);
  } catch (e) {
    await fiber.dispose();
    failures.set(name, (e as Error).message);
    throw e;
  }
  active.set(name, { fiber, module: mod, config });
  failures.delete(name);
  try {
    await deps.snapshot(name);
  } catch (e) {
    console.warn(`[phase4] 版本快照失败（不阻断激活）：${(e as Error).message}`);
  }
}

/** 重新加载（先验证后切换）：新模块须已在调用方过完装载校验；先 dispose
 * 旧 fiber 再激活新模块，激活失败用内存中的旧模块回退（回退也失败则记坏行）。
 * @param ctx 宿主上下文。
 * @param name 外置插件名。
 * @param mod 新模块（装载校验已过）。
 * @param config 清单行配置。
 * @param deps 快照通道与审计等待参数。
 * @returns 新模块激活成功即 resolve；失败时旧版已回退仍 rethrow 新模块的错误。 */
export async function reloadExternal(
  ctx: Context,
  name: string,
  mod: PluginModule,
  config: Record<string, unknown>,
  deps: ActivateDeps,
): Promise<void> {
  return serialized(name, async () => {
    const prev = active.get(name);
    if (prev) {
      await prev.fiber.dispose();
      active.delete(name);
    }
    try {
      await activateExternal(ctx, name, mod, config, deps);
    } catch (e) {
      if (prev) {
        try {
          await activateExternal(ctx, name, prev.module, prev.config, {
            snapshot: async () => {},
            wait: deps.wait,
          });
        } catch (restoreError) {
          failures.set(name, (restoreError as Error).message);
        }
      } else {
        failures.set(name, (e as Error).message);
      }
      throw e;
    }
  });
}

/** 停用/移除前置：dispose 活 fiber 并销登记（幂等：没在跑也成功）。
 * @param name 外置插件名。
 * @returns 处置完成（含清理函数跑完）即 resolve。 */
export async function deactivateExternal(name: string): Promise<void> {
  return serialized(name, async () => {
    const cur = active.get(name);
    if (cur) {
      await cur.fiber.dispose();
      active.delete(name);
    }
  });
}

/** 本窗正在运行的外置插件名集合（面板"运行中"投影数据源）。
 * @returns 运行中插件名的只读快照（每次调用新建，调用方持有不随后续激活变化）。 */
export function runningExternals(): ReadonlySet<string> {
  return active.size ? new Set(active.keys()) : new Set();
}

/** 最近激活失败表（面板"装载失败"投影数据源；running 的插件无条目）。
 * @returns name → 最近失败原因的只读快照（新建副本）。 */
export function activationFailures(): ReadonlyMap<string, string> {
  return new Map(failures);
}
