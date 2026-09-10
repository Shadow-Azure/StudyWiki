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
    return parsed as Manifest;
  }
  const manifest: Manifest = {
    plugins: Object.keys(table).map((id) => ({ id, enabled: true, config: { ...table[id].defaults } })),
  };
  await write(JSON.stringify(manifest, null, 2));
  return manifest;
}
