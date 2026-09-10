# 架构

[English](architecture.en.md) | 中文

> 类型：参考 | 层级：架构地图。改 `src/` 或 `src-tauri/` 前必读。决策理由不在这里——见对应 Agent Note。

## 组成

StudyWiki 是单窗口 Tauri 2 桌面应用，两层：

<!-- BEGIN GENERATED code-map (scripts/gen-code-map.mjs) — do not edit between markers -->
```text
src/                 前端（TypeScript + Vite，无 UI 框架）
  host/context.d.ts  cordis Context 声明合并：files/windows/workspace/slots 四服务类型挂入（→ files.ts、slots.ts、windows.ts、workspace.ts）
  host/emitter.ts    极简类型化事件发射器（on 返回反订阅）
  host/files.ts      文件服务：树/读写/选目录/asset URL + fs://changed 桥接（deps 可注入）（→ emitter.ts、types.ts）
  host/slots.ts      类型化 UI 槽位注册表：注册序渲染、各自容器、反订阅移除（mount 归 shell 插件）
  host/windows.ts    窗口服务：label/建窗/root 查询/确认框/关闭守卫（deps 可注入）
  host/workspace.ts  窗口 scope 工作区状态机：root/activeFile + root-changed/file-opened 事件流（→ emitter.ts、types.ts）
  main.ts            入口：侧栏文件列表 + 查看器分发（→ styles.css、types.ts）
  styles.css         样式（无逻辑）
  types.ts           LibraryEntry —— 前后端共享的唯一形状
src-tauri/           Rust 壳
  lib.rs             tauri::Builder + 文件命令 + 窗口事件接线（→ windows.rs）
  main.rs            入口壳（Windows 隐藏控制台）（→ lib.rs）
  windows.rs         窗口注册表（label→root）+ create/get 窗口命令 + plugins.json 清单 IO
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
