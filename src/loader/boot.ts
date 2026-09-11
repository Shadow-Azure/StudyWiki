import { Context, FiberState } from "cordis";
import type { Manifest } from "./manifest";
import type { ModuleTable } from "./table";
import type { PluginModule } from "./types";

/** boot 结果报告：成功激活的 id 与分治跳过的外置坏行（面板待清理）。 */
export interface BootReport {
  loaded: string[];
  /** 外置行装载失败（目录缺失/入口损坏/形状不符/审计卡死）：跳过不阻断，面板点名。 */
  broken: Array<{ id: string; reason: string }>;
}

/** Boot every enabled row, then audit fiber states: built-in failures stay
 * fail-loud; external (ext:*) failures are quarantined into the report —
 * external resources are user-side state and must not block the whole app.
 * @param ctx Host context the plugins attach to.
 * @param manifest Persisted manifest rows driving what gets loaded.
 * @param table Static module table resolving built-in ids to plugins.
 * @param loadExternal Resolves an external plugin name to its module
 *   (Rust 读入口 + blob 装载 + 支持集/形状校验，见 host/plugins.ts).
 * @returns The boot report (activated ids + quarantined external rows). */
export async function boot(
  ctx: Context,
  manifest: Manifest,
  table: ModuleTable,
  loadExternal: (name: string) => Promise<PluginModule>,
): Promise<BootReport> {
  const loaded: string[] = [];
  const broken: Array<{ id: string; reason: string }> = [];
  const states: Array<{ id: string; state: () => number }> = [];
  for (const row of manifest.plugins) {
    if (!row.enabled) continue;
    if (row.id.startsWith("ext:")) {
      const name = row.id.slice(4);
      try {
        const plugin = await loadExternal(name);
        const fiber = ctx.plugin(plugin, row.config);
        states.push({ id: row.id, state: () => fiber.state });
        loaded.push(row.id);
      } catch (e) {
        // 资源缺失/入口损坏/形状不符：跳过并点名，不阻断其余插件。
        broken.push({ id: row.id, reason: (e as Error).message });
      }
      continue;
    }
    const entry = table[row.id];
    if (!entry) throw new Error(`装载失败：清单条目 "${row.id}" 不在静态模块表中`);
    const fiber = ctx.plugin(entry.plugin, { ...entry.defaults, ...row.config });
    states.push({ id: row.id, state: () => fiber.state });
    loaded.push(row.id);
  }
  await new Promise((r) => setTimeout(r, 50)); // 全树静默（注入等待 + 激活）
  const stuck = states.filter((s) => s.state() !== FiberState.ACTIVE);
  const stuckBuiltin = stuck
    .filter((s) => !s.id.startsWith("ext:"))
    .map((s) => `${s.id}（state=${s.state()}）`);
  if (stuckBuiltin.length) {
    throw new Error(`装载审计失败：${stuckBuiltin.join("、")} 未激活——声明的服务未提供？`);
  }
  for (const s of stuck) {
    // 外置行审计卡死（声明的服务未提供等）同样分治为坏行。
    broken.push({ id: s.id, reason: `审计未激活（state=${s.state()}）：声明的服务未提供？` });
    const i = loaded.indexOf(s.id);
    if (i >= 0) loaded.splice(i, 1);
  }
  return { loaded, broken };
}
