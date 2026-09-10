# 架构

[English](architecture.en.md) | 中文

> 类型：参考 | 层级：架构地图。改 `src/` 或 `src-tauri/` 前必读。决策理由不在这里——见对应 Agent Note。

## 组成

StudyWiki 是单窗口 Tauri 2 桌面应用，两层：

<!-- BEGIN GENERATED code-map (scripts/gen-code-map.mjs) — do not edit between markers -->
```text
src/                               前端（TypeScript + Vite，无 UI 框架）
  bootstrap.ts                     每窗口启动流程：宿主服务入 ctx + 清单装载 + 插件激活（Tauri 绑定可注入）（→ files.ts、slots.ts、windows.ts、workspace.ts、boot.ts、manifest.ts、table.ts）
  host/context.d.ts                cordis Context 声明合并：files/windows/workspace/slots 四服务类型挂入（→ files.ts、slots.ts、windows.ts、workspace.ts）
  host/emitter.ts                  极简类型化事件发射器（on 返回反订阅）
  host/files.ts                    文件服务：树/读写/选目录/asset URL + fs://changed 桥接（deps 可注入）（→ emitter.ts、types.ts）
  host/slots.ts                    类型化 UI 槽位注册表：注册序渲染、各自容器、反订阅移除（mount 归 shell 插件）
  host/windows.ts                  窗口服务：label/建窗/root 查询/确认框/关闭守卫（deps 可注入）
  host/workspace.ts                窗口 scope 工作区状态机：root/activeFile + root-changed/file-opened 事件流（→ emitter.ts、types.ts）
  loader/boot.ts                   装载器：清单行驱动 ctx.plugin + 全树激活审计（非 ACTIVE 点名）（→ manifest.ts、table.ts）
  loader/manifest.ts               插件清单装载：缺失时从模块表生成默认并写回，损坏 fail-loud（→ table.ts）
  loader/table.ts                  静态模块表：id → 插件 + 默认配置（构建期单一 home，行随插件任务落地）（→ types.ts）
  loader/types.ts                  内置插件导出形状 PluginModule：(name, inject, apply) 三件套的结构子集
  main.ts                          入口：调用每窗口 bootstrap（三行）（→ bootstrap.ts、styles.css）
  plugins/app-shell/index.ts       app-shell 插件：topbar/sidebar/main 栅格 + 三槽容器挂载 + 无 root 欢迎态
  plugins/doc-markdown/editor.ts   doc-markdown CodeMirror 6 工厂：唯一 CodeMirror import 点（basicSetup + markdown 高亮 + Mod-s 键位），测试注入假工厂
  plugins/doc-markdown/index.ts    doc-markdown 插件：活动文件 markdown 预览/编辑双模式 + 脏标记 + Ctrl+S 保存 + 关窗守卫（file-opened 挂渲染，kind 不符清空）（→ editor.ts、mode.ts、preview.ts、types.ts）
  plugins/doc-markdown/mode.ts     doc-markdown 纯函数：文档状态机（open/edit/saved/toggle/dirty）
  plugins/doc-markdown/preview.ts  doc-markdown 纯函数：markdown-it 渲染（html:false，内嵌 HTML 转义）
  plugins/doc-video/index.ts       doc-video 插件：活动文件视频查看器（video controls + asset protocol 播放；file-opened 挂渲染，kind 不符清空）
  plugins/view-filetree/index.ts   view-filetree 插件：侧栏文件树 UI（展开折叠/点开文档/手动刷新/fs 变更重读）（→ tree.ts、types.ts）
  plugins/view-filetree/tree.ts    view-filetree 纯函数：点文件递归过滤 + 可见行铺平（深度优先、携带深度）（→ types.ts）
  styles.css                       样式（无逻辑）
  types.ts                         FileNode —— 前后端共享的唯一形状
src-tauri/                         Rust 壳
  lib.rs                           tauri::Builder + 文件命令 + 窗口事件接线（→ windows.rs）
  main.rs                          入口壳（Windows 隐藏控制台）（→ lib.rs）
  windows.rs                       窗口注册表（label→root）+ create/get 窗口命令 + plugins.json 清单 IO
```
<!-- END GENERATED code-map -->

组成树走生成区：文件职责登记在 [code-map.manifest.json](../scripts/code-map.manifest.json)，内部依赖（→）从源码 import 推导；加/删源文件或改 import 后登记并跑 `pnpm gen:code-map`。`types.ts` 与 Rust 侧 `LibraryEntry` 是前后端共享的唯一形状。文档侧贴的声明用 type-equiv 围栏与源码公证（`scripts/verify-type-equiv.mjs`，逐字等价，改源码不同步文档即红）：

```ts type-equiv
/** A playable or readable file inside the opened library. */
export type LibraryEntry = {
  /** File name including extension. */
  name: string;
  /** Absolute path, used for reads and asset-protocol URLs. */
  path: string;
  /** Dispatches the viewer: markdown or video. */
  kind: "markdown" | "video";
};
```

命令面的权威清单（含签名）在 [commands.md](commands.md) 的生成区，源码改后跑 `pnpm gen:commands` 同步。

数据流：用户选文件夹（dialog 插件）→ `list_library` 命令扫描并按扩展名分类 → 前端渲染侧栏 → 点开文件 → Markdown 走 `read_text_file` + markdown-it 前端渲染；视频走 `convertFileSrc`（asset protocol）交给系统 webview 的 `<video>` 解码。

## 关键决策点

- **扩展名分派在 Rust 侧**（`MARKDOWN_EXTS` / `VIDEO_EXTS`）：单一决策点，前端不重复判断。
- **`assetProtocol.scope: ["**"]`**：用户可打开任意文件夹，无法预先收窄；靠 CSP 的 `media-src`/`img-src` 限制其他资源。收紧 scope 是 [安全边界已知欠账](environment-independence.md#已知欠账)。
- **markdown-it 在构建期打包进 bundle**，`html: false` 关闭内嵌 HTML：环境无关约束（见下）的直接推论，同时降低 XSS 面。
- **系统 webview 做渲染与视频解码**（macOS WKWebView / Windows WebView2 / Linux webkit2gtk）：这是体积与依赖的取舍，边界与补救见 [environment-independence.md](environment-independence.md)。

## 环境无关性

架构上任何新增能力都要过一道检查：会不会引入运行期环境依赖？规则、门禁与豁免登记的唯一 home 是 [environment-independence.md](environment-independence.md)。
