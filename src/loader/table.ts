import type { PluginModule } from "./types";

/** One static module table row. */
export interface TableEntry {
  plugin: PluginModule;
  defaults: Record<string, unknown>;
}

/** Static module table: every built-in plugin keyed by id. Rows land with
 * their plugin tasks; Phase 2 adds external modules as another source. */
export type ModuleTable = Record<string, TableEntry>;

/** The build-time module table (single home). */
export const MODULE_TABLE: ModuleTable = {};
