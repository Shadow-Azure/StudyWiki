# 外置插件作者指南

[English](authoring.en.md) | 中文

> 类型：教程 | 层级：外置插件作者。宿主安装管线（`src-tauri/src/plugins.rs`）与生成物 `scripts/check.mjs` 执行同一契约；本页是作者侧权威口径，宿主改契约须同步本页。

外置插件是零依赖单文件 ESM 模块，以 npm tarball 形态进入宿主，下列要求全部由宿主机械校验。

## 封闭契约（宿主机械校验，安装即拒）

| 项 | 要求 |
|---|---|
| 包名 name | 小写字母/数字/连字符，≤100 字符（生成器强制）；宿主安装另拒空名与路径形态；`check.mjs` 不校验 name——手改后先对照本行 |
| tgz 内容 | 恰好 `package/package.json` + `package/<entry>` 两个文件（README/LICENSE 会被 npm 无条件打包，勿放） |
| keywords | 含 `studywiki-plugin` |
| dependencies | 显式空对象（零依赖单文件） |
| studywiki.apiVersion | `1`（宿主支持集 {1}，不符拒载） |
| studywiki.entry | 顶层单文件名（拒 `/`、`\`、`..`、`package.json`） |
| 大小上限 | 20 MiB（拉取与本地导入同限，超限拒装点名上限） |
| 模块导出 | ESM：非空 `name`、函数 `apply`；`inject` 可选（缺省 `undefined`），给出时必须是字符串数组 |

## 快速开始

在 StudyWiki 仓库根生成（`plugins-dev/` 已 gitignore）：

```sh
pnpm gen:plugin -- my-plugin   # 生成 plugins-dev/my-plugin/ 完整 npm 包
```

包内循环（esbuild/typescript 是 devDependencies，只装作者机器）：

```sh
npm install        # 装构建工具链
npm run build      # esbuild 把 src/index.ts 打包成单文件 index.js
npm run check      # 发布面校验：npm pack 断言恰好两文件 + 契约字段齐备
```

生成的 `src/index.ts` 是顶栏 hello 示例（`name`/`inject`/`apply` 三段式），`src/host.d.ts` 是本地最小类型副本。

## 在宿主里试装

`pnpm tauri dev` 起宿主 → 插件面板 → “本地导入…” 选 `npm pack` 产出的 tgz → **重启生效**。无热装载（Phase 2 裁定）：清单一致性/失败回滚/多窗同步的最简正确形态是下次 boot 见；装坏的行面板点名待清理，不影响其余插件。

## 发布

```sh
npm publish        # prepublishOnly 自动 build + check，先校验后上传
```

发布名即安装名：面板输入 `name` 或 `name@version` 从 registry 安装；版本号即安装形态里的版本。

## 信任模型与边界

插件与宿主运行在同一 webview JS 世界，**同进程全权**——能触达宿主能触达的一切（Obsidian 前鉴）。apiVersion、零依赖、单文件是当前全部防线，不是沙箱。作者侧类型 `./src/host.d.ts` 是本地最小副本，可能与宿主实现漂移；权威契约以本页为准。
