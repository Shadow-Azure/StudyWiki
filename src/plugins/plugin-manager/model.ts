import type { Manifest, ManifestRow } from "../../loader/manifest";
import type { BrokenRow, PluginEntry } from "../../host/plugins";

/** 面板单行：四源（manifest × 目录扫描 × boot 坏行 × 本窗运行态）合一的纯投影。 */
export interface PanelRow {
  /** manifest 行 id（外置带 ext: 前缀）。 */
  id: string;
  /** 外置目录名（内置为 null）。 */
  externalName: string | null;
  /** manifest enabled。 */
  enabled: boolean;
  /** 版本（目录扫描带出；内置或未知为 null）。 */
  version: string | null;
  /** 待清理原因（boot 坏行 > 扫描 problem > 目录缺失）；null = 健康。 */
  problem: string | null;
  /** 可移除（仅外置）。 */
  removable: boolean;
  /** 本窗运行态投影（内置恒 null）：running 活 fiber 在跑，failed 最近激活失败，
   * stopped 停用或从未激活——重启后按清单重新装载。 */
  runtime: "running" | "failed" | "stopped" | null;
  /** 最近一次激活失败原因（无失败为 null）；failed 行点名用。 */
  failure: string | null;
}

/** 四源合一：manifest 供 id/enabled，目录扫描供版本与 problem，boot 坏行
 * 优先作 problem（装载失败的运行期事实最准），运行态集合供"运行中/装载失败"
 * 徽章（本窗内存事实，重启前不对其他窗口成立）。纯函数，可测。
 * @param manifest 当前清单（行序即面板行序）。
 * @param entries 插件目录扫描结果（按目录名索引）。
 * @param bootBroken boot 报告的外置坏行（id → 原因）。
 * @param running 本窗正在运行的外置插件名集合（runningExternals()）。
 * @param failures 本窗最近激活失败表（activationFailures()）。
 * @returns 与清单等长的面板行投影。 */
export function computePanelRows(
  manifest: Manifest,
  entries: PluginEntry[],
  bootBroken: BrokenRow[],
  running: ReadonlySet<string>,
  failures: ReadonlyMap<string, string>,
): PanelRow[] {
  const byName = new Map(entries.map((e) => [e.name, e]));
  const brokenById = new Map(bootBroken.map((b) => [b.id, b.reason]));
  return manifest.plugins.map((row: ManifestRow) => {
    if (row.id.startsWith("ext:")) {
      const name = row.id.slice(4);
      const entry = byName.get(name);
      const failure = failures.get(name) ?? null;
      return {
        id: row.id,
        externalName: name,
        enabled: row.enabled,
        version: entry?.version ?? null,
        problem: brokenById.get(row.id) ?? entry?.problem ?? (entry ? null : "插件目录缺失"),
        removable: true,
        runtime: !row.enabled ? "stopped" : running.has(name) ? "running" : failure ? "failed" : "stopped",
        failure,
      };
    }
    return {
      id: row.id,
      externalName: null,
      enabled: row.enabled,
      version: null,
      problem: null,
      removable: false,
      runtime: null,
      failure: null,
    };
  });
}

/** 追加一行 enabled 的外置清单行（幂等：已在则原样返回）。
 * @param manifest 变换前的清单。
 * @param id 新行 id（外置带 ext: 前缀）。
 * @returns 含新行的新清单。 */
export function withRow(manifest: Manifest, id: string): Manifest {
  if (manifest.plugins.some((row) => row.id === id)) return manifest;
  return { plugins: [...manifest.plugins, { id, enabled: true, config: {} }] };
}

/** 开关一行 enabled 后的新清单（纯变换，落盘归调用方）。
 * @param manifest 变换前的清单。
 * @param id 目标行 id。
 * @param enabled 新的启用状态。
 * @returns 仅目标行 enabled 变化的新清单。 */
export function withEnabled(manifest: Manifest, id: string, enabled: boolean): Manifest {
  return { plugins: manifest.plugins.map((row) => (row.id === id ? { ...row, enabled } : row)) };
}

/** 移除一行后的新清单（纯变换，落盘归调用方）。
 * @param manifest 变换前的清单。
 * @param id 要移除的行 id。
 * @returns 过滤掉目标行的新清单。 */
export function withoutRow(manifest: Manifest, id: string): Manifest {
  return { plugins: manifest.plugins.filter((row) => row.id !== id) };
}
