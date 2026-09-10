import type { PluginModule } from "./types";
import * as appShell from "../plugins/app-shell";
import * as viewFiletree from "../plugins/view-filetree";
import * as docMarkdown from "../plugins/doc-markdown";
import * as docVideo from "../plugins/doc-video";

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

Object.assign(MODULE_TABLE, {
  "app-shell": { plugin: appShell as PluginModule, defaults: { title: "StudyWiki" } },
  "view-filetree": { plugin: viewFiletree as PluginModule, defaults: { ignoreDotfiles: true } },
  "doc-markdown": { plugin: docMarkdown as PluginModule, defaults: {} },
  "doc-video": { plugin: docVideo as PluginModule, defaults: {} },
});
