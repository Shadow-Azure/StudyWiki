# 架构

> 类型：参考 | 层级：架构地图。改 `src/` 或 `src-tauri/` 前必读。决策理由不在这里——见对应 Agent Note。

## 组成

StudyWiki 是单窗口 Tauri 2 桌面应用，两层：

```
src/            前端（TypeScript + Vite，无 UI 框架）
  main.ts         入口：侧栏文件列表 + 查看器分发
  types.ts        LibraryEntry —— 前后端共享的唯一形状
src-tauri/      Rust 壳
  lib.rs          tauri::Builder + 两条命令
  main.rs         入口壳（Windows 隐藏控制台）
```

数据流：用户选文件夹（dialog 插件）→ `list_library` 命令扫描并按扩展名分类 → 前端渲染侧栏 → 点开文件 → Markdown 走 `read_text_file` + markdown-it 前端渲染；视频走 `convertFileSrc`（asset protocol）交给系统 webview 的 `<video>` 解码。

## 关键决策点

- **扩展名分派在 Rust 侧**（`MARKDOWN_EXTS` / `VIDEO_EXTS`）：单一决策点，前端不重复判断。
- **`assetProtocol.scope: ["**"]`**：用户可打开任意文件夹，无法预先收窄；靠 CSP 的 `media-src`/`img-src` 限制其他资源。收紧 scope 是 [安全边界已知欠账](environment-independence.md#已知欠账)。
- **markdown-it 在构建期打包进 bundle**，`html: false` 关闭内嵌 HTML：环境无关约束（见下）的直接推论，同时降低 XSS 面。
- **系统 webview 做渲染与视频解码**（macOS WKWebView / Windows WebView2 / Linux webkit2gtk）：这是体积与依赖的取舍，边界与补救见 [environment-independence.md](environment-independence.md)。

## 环境无关性

架构上任何新增能力都要过一道检查：会不会引入运行期环境依赖？规则、门禁与豁免登记的唯一 home 是 [environment-independence.md](environment-independence.md)。
