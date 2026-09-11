/** 外置模块装载缝：全前端唯一动态 import 点（layering-allowlist.json 单条登记）。
 * blob URL 通道（Phase 2 Note 决策 1 落定形态）：Rust 命令读入口源码 → JS 端
 * Blob → 动态 import → 用后即回收。单文件零依赖契约使 blob 的常见弱点
 * （相对导入解析、URL 生命周期）归零。
 * @param code 插件入口 ESM 源码（UTF-8 文本，来自 read_plugin_module）。
 * @param importFn 动态 import 实现；缺省为真实 import（webview 内 blob: 生效），
 *   测试注入假实现以离线全链路测试。
 * @returns 模块命名空间对象（形状校验在调用方 PluginsService.loadModule）。 */
export async function loadExternalModule(
  code: string,
  importFn: (url: string) => Promise<Record<string, unknown>> = (url) => import(/* @vite-ignore */ url),
): Promise<Record<string, unknown>> {
  const blob = new Blob([code], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    return await importFn(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
