import type { Context } from "cordis";
import type { FilesService } from "./files";
import type { ExcelService } from "./excel";
import type { WindowsService } from "./windows";
import type { WorkspaceFacade } from "./workspace";
import type { SlotsService } from "./slots";
import type { PluginsService } from "./plugins";
import type { LlmService } from "./llm";

declare module "cordis" {
  interface Context {
    /** 文件通道（读树/读写文本/选目录/媒体 URL/fs 变更流）。 */
    files: FilesService;
    /** Excel 数据模型服务（xlsx 解析/序列化；人与 AI 共用读写面）。 */
    excel: ExcelService;
    /** 窗口身份/创建/原生确认框/关窗守卫。 */
    windows: WindowsService;
    /** 窗口 scope 工作区插件面（读/事件/守卫打开；换根仅经 windows 单路）。 */
    workspace: WorkspaceFacade;
    /** 类型化 UI 槽位注册表。 */
    slots: SlotsService;
    /** 外置插件包管理 + 装载通道（plugin-manager 唯一消费者）。 */
    plugins: PluginsService;
    /** LLM 推理服务（endpoint 列表/探测/非流式 chat；模型路由在本层）。 */
    llm: LlmService;
  }
}
