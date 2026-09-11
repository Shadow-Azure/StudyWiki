import { Context } from "cordis";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FilesService } from "./host/files";
import { WindowsService, defaultWindowsDeps } from "./host/windows";
import { WorkspaceService } from "./host/workspace";
import { SlotsService } from "./host/slots";
import { PluginsService, defaultPluginsDeps } from "./host/plugins";
import { loadExternalModule } from "./loader/external";
import { loadManifest } from "./loader/manifest";
import { boot } from "./loader/boot";
import { MODULE_TABLE, type ModuleTable } from "./loader/table";

/** Injected environment; defaults bind real Tauri APIs (tests fake these). */
export interface BootstrapEnv {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  listen: (event: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;
  openDialog: () => Promise<string | null>;
  assetUrl: (path: string) => string;
  currentLabel: () => string;
  onCloseRequested: (cb: (e: { preventDefault(): void }) => void) => Promise<() => void>;
  /** Native confirm dialog (close-guard prompt); defaults to the real one. */
  confirmDialog?: (message: string) => Promise<boolean>;
  table?: ModuleTable;
  /** 外置装载通道注桩（测试用）；缺省为真实 blob 通道。 */
  loadExternal?: (code: string) => Promise<Record<string, unknown>>;
  /** 本地导入 tgz 的选框注桩（测试用）；缺省为真实 dialog。 */
  openTgz?: () => Promise<string | null>;
}

/** Real bindings. */
export const defaultEnv: BootstrapEnv = {
  invoke,
  listen,
  openDialog: () => open({ directory: true, multiple: false }) as Promise<string | null>,
  assetUrl: convertFileSrc,
  currentLabel: () => getCurrentWebviewWindow().label,
  onCloseRequested: (cb) => getCurrentWebviewWindow().onCloseRequested(cb),
  confirmDialog: (message) => confirm(message, { title: "StudyWiki" }),
};

/** Per-window bootstrap: label → root → context + host services → manifest → boot.
 * @param env Injected bindings; omitted fields fall back to the real Tauri ones.
 * @returns The activated host context (plugins attached, audit passed). */
export async function bootstrap(env: BootstrapEnv = defaultEnv): Promise<Context> {
  const ctx = new Context();
  const files = new FilesService({ invoke: env.invoke, listen: env.listen, openDialog: env.openDialog, assetUrl: env.assetUrl });
  const windows = new WindowsService({
    invoke: env.invoke,
    currentLabel: env.currentLabel,
    onCloseRequested: env.onCloseRequested,
    confirmDialog: env.confirmDialog ?? defaultWindowsDeps.confirmDialog,
  });
  const workspace = new WorkspaceService();
  const slots = new SlotsService();
  const plugins = new PluginsService({
    invoke: env.invoke,
    loadExternal: env.loadExternal ?? loadExternalModule,
    pickTgz: env.openTgz ?? defaultPluginsDeps.pickTgz,
  });
  ctx.reflect.provide("files", files);
  ctx.reflect.provide("windows", windows);
  ctx.reflect.provide("workspace", workspace);
  ctx.reflect.provide("slots", slots);
  ctx.reflect.provide("plugins", plugins);
  await files.start();
  // 持久 root 启动即重授权（配置 scope 已收空，运行期动态注入是唯一通道）。
  const label = windows.currentLabel();
  const root = await windows.fetchRoot(label);
  if (root !== null) await windows.setRoot(label, root);
  workspace.setRoot(root);
  // 注入行叠加在静态表上（同 id 覆盖）：测试补探针行时，默认清单仍含全部内置插件。
  const table: ModuleTable = { ...MODULE_TABLE, ...env.table };
  const manifest = await loadManifest(
    () => env.invoke("read_manifest") as Promise<string | null>,
    (json) => env.invoke("write_manifest", { json }).then(() => undefined),
    table,
  );
  const report = await boot(ctx, manifest, table, (name) => plugins.loadModule(name));
  plugins.bootBroken = report.broken;
  return ctx;
}
