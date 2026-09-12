import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Manifest } from "../loader/manifest";
import { loadExternalModule } from "../loader/external";
import type { PluginModule } from "../loader/types";

/** 宿主支持的外置插件 apiVersion 支持集；扩集必须回 Phase 2 Note 修订。 */
export const SUPPORTED_API_VERSIONS: readonly number[] = [1];

/** list_plugins() 的行：健康行带元数据，坏行带 problem（面板标待清理）。 */
export interface PluginEntry {
  name: string;
  version: string | null;
  apiVersion: number | null;
  entry: string | null;
  problem: string | null;
}

/** boot 期间外置行装载失败的分治记录（面板待清理的数据来源）。 */
export interface BrokenRow {
  id: string;
  reason: string;
}

/** Tauri bindings this service wraps; injectable for tests. */
export interface PluginsDeps {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  loadExternal: (code: string) => Promise<Record<string, unknown>>;
  pickTgz: () => Promise<string | null>;
}

/** Real bindings; the loading seam lives in loader/external.ts. */
export const defaultPluginsDeps: PluginsDeps = {
  invoke,
  loadExternal: (code) => loadExternalModule(code),
  pickTgz: () =>
    open({
      multiple: false,
      filters: [{ name: "插件 tarball", extensions: ["tgz", "tar.gz"] }],
    }) as Promise<string | null>,
};

/** 宿主插件包服务：外置插件安装/导入/列出/移除 + 装载通道取模块 + 清单读写
 * 的唯一入口；plugin-manager 是其唯一消费者（Phase 2 内）。 */
export class PluginsService {
  readonly #deps: PluginsDeps;
  /** boot 报告的外置坏行；bootstrap 在 boot 后回填，面板读它点名待清理。 */
  bootBroken: BrokenRow[] = [];

  constructor(deps: PluginsDeps = defaultPluginsDeps) {
    this.#deps = deps;
  }

  /** 按名安装（`name` 或 `name@version`，registry 直拉；产品唯一联网动作）。 */
  async install(spec: string): Promise<string> {
    return this.#deps.invoke("install_plugin", { spec }) as Promise<string>;
  }

  /** 弹选本地 tgz 并导入（同校验管线免联网）；取消返回 null。 */
  async importFromTgz(): Promise<string | null> {
    const path = await this.#deps.pickTgz();
    if (path === null) return null;
    return this.#deps.invoke("import_plugin", { path }) as Promise<string>;
  }

  /** 扫描插件目录：健康行带元数据，坏行带 problem。 */
  async list(): Promise<PluginEntry[]> {
    return this.#deps.invoke("list_plugins") as Promise<PluginEntry[]>;
  }

  /** 删除外置插件目录（幂等：目录已不在也成功）。 */
  async remove(name: string): Promise<void> {
    await this.#deps.invoke("remove_plugin", { name });
  }

  /** 读清单原文（null = 首启未生成）。 */
  async readManifest(): Promise<string | null> {
    return this.#deps.invoke("read_manifest") as Promise<string | null>;
  }

  /** 写回清单（面板开关/移除后的持久化通道）。 */
  async writeManifest(manifest: Manifest): Promise<void> {
    await this.#deps.invoke("write_manifest", {
      json: JSON.stringify(manifest, null, 2),
    });
  }

  /** 经装载通道取外置模块：apiVersion 支持集判定 + 形状校验，不符即拒
   * （fail-loud 点名缺什么；boot 侧把它分治为待清理行而非崩溃）。 */
  async loadModule(name: string): Promise<PluginModule> {
    const src = (await this.#deps.invoke("read_plugin_module", { name })) as {
      code: string;
      apiVersion: number;
    };
    if (!SUPPORTED_API_VERSIONS.includes(src.apiVersion)) {
      throw new Error(`外置插件 ${name} 的 apiVersion ${src.apiVersion} 不在支持集 {${SUPPORTED_API_VERSIONS.join(", ")}} 内`);
    }
    const mod = (await this.#deps.loadExternal(src.code)) as Partial<PluginModule>;
    if (typeof mod.name !== "string" || mod.name.length === 0) {
      throw new Error(`外置插件 ${name} 缺少非空 name 导出`);
    }
    if (typeof mod.apply !== "function") {
      throw new Error(`外置插件 ${name}（${mod.name}）缺少 apply 函数导出`);
    }
    if (Array.isArray(mod.inject) && mod.inject.some((k) => typeof k !== "string")) {
      throw new Error(`外置插件 ${name}（${mod.name}）的 inject 必须是字符串数组`);
    }
    return mod as PluginModule;
  }
}
