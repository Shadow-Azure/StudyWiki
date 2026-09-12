import { Context, FiberState } from "cordis";
import type { Manifest } from "./manifest";
import type { ModuleTable } from "./table";

/** Boot every enabled row from the static table, then audit fiber states:
 * anything not ACTIVE is reported by id, fail-loud.
 * @param ctx Host context the plugins attach to.
 * @param manifest Persisted manifest rows driving what gets loaded.
 * @param table Static module table resolving manifest ids to plugins. */
export async function boot(ctx: Context, manifest: Manifest, table: ModuleTable): Promise<void> {
  const states: Array<{ id: string; state: () => number }> = [];
  for (const row of manifest.plugins) {
    if (!row.enabled) continue;
    const entry = table[row.id];
    if (!entry) throw new Error(`装载失败：清单条目 "${row.id}" 不在静态模块表中`);
    const fiber = ctx.plugin(entry.plugin, { ...entry.defaults, ...row.config });
    states.push({ id: row.id, state: () => fiber.state });
  }
  await new Promise((r) => setTimeout(r, 50)); // 全树静默（注入等待 + 激活）
  const stuck = states
    .filter((s) => s.state() !== FiberState.ACTIVE)
    .map((s) => `${s.id}（state=${s.state()}）`);
  if (stuck.length) {
    throw new Error(`装载审计失败：${stuck.join("、")} 未激活——声明的服务未提供？`);
  }
}
