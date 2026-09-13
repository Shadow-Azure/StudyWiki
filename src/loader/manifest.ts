import type { ModuleTable } from "./table";

/** One manifest row: which plugin, enabled or not, with what config. */
export interface ManifestRow {
  id: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

/** The whole persisted manifest. */
export interface Manifest {
  plugins: ManifestRow[];
}

/** Read the manifest; when missing, generate defaults from the table and
 * write them back. Corrupt JSON or shape fails loud.
 * @param read Manifest JSON reader; null means the file is absent (first run).
 * @param write Persists the generated default manifest.
 * @param table Static module table supplying each plugin's default config.
 * @returns The loaded or freshly generated manifest. */
export async function loadManifest(
  read: () => Promise<string | null>,
  write: (json: string) => Promise<void>,
  table: ModuleTable,
): Promise<Manifest> {
  const raw = await read();
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`插件清单损坏（JSON 解析失败）：${(e as Error).message}`);
    }
    const plugins = (parsed as Manifest).plugins;
    if (!Array.isArray(plugins)) throw new Error("插件清单损坏：plugins 不是数组");
    // 逐行形状校验：残缺行若静默跳过会伪装成"禁用"，fail-loud 点名行索引或 id。
    plugins.forEach((row: ManifestRow, i: number) => {
      if (typeof row?.id !== "string") throw new Error(`插件清单损坏：第 ${i} 行缺字符串 id`);
      if (typeof row?.enabled !== "boolean") {
        throw new Error(`插件清单损坏：条目 "${row?.id ?? i}" 的 enabled 缺失或不是布尔`);
      }
      if (typeof row?.config !== "object" || row?.config === null || Array.isArray(row?.config)) {
        throw new Error(`插件清单损坏：条目 "${row?.id ?? i}" 的 config 不是对象`);
      }
    });
    // 存量迁移：静态表新增而清单缺失的内置行合并进去（enabled 默认 true，与首启
    // 一致——版本升级带新内置属行为一致条款的设计内变化）；外置行（ext:）不迁移
    // 不猜，以插件目录为准源。合并发生即写回落盘。
    const known = new Set(plugins.map((row) => row.id));
    const missing = Object.keys(table)
      .filter((id) => !known.has(id))
      .map((id) => ({ id, enabled: true, config: { ...table[id].defaults } }));
    if (missing.length) {
      const merged: Manifest = { plugins: [...plugins, ...missing] };
      await write(JSON.stringify(merged, null, 2));
      return merged;
    }
    return parsed as Manifest;
  }
  const manifest: Manifest = {
    plugins: Object.keys(table).map((id) => ({ id, enabled: true, config: { ...table[id].defaults } })),
  };
  await write(JSON.stringify(manifest, null, 2));
  return manifest;
}
