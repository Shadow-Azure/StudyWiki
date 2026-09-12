import type { Context } from "cordis";
import type { FilesService } from "./files";
import type { WindowsService } from "./windows";
import type { WorkspaceService } from "./workspace";
import type { SlotsService } from "./slots";
import type { PluginsService } from "./plugins";

declare module "cordis" {
  interface Context {
    /** 文件通道（读树/读写文本/选目录/媒体 URL/fs 变更流）。 */
    files: FilesService;
    /** 窗口身份/创建/原生确认框/关窗守卫。 */
    windows: WindowsService;
    /** 窗口 scope 工作区状态（root/activeFile）。 */
    workspace: WorkspaceService;
    /** 类型化 UI 槽位注册表。 */
    slots: SlotsService;
    /** 外置插件包管理 + 装载通道（plugin-manager 唯一消费者）。 */
    plugins: PluginsService;
  }
}
