# Agent Note: Phase 2 外置插件：registry 直拉 + 本地导入 + 装载校验

Status: proposed

[English](2026-09-11-phase2-external-plugins.en.md) | 中文

## Problem

Phase 1 交付了内置插件的静态装载（模块表 + JSON 清单 + fail-loud 审计），但产物不含任何外置插件能力：第三方作者无法分发插件，用户无法安装。开放外置插件的硬约束是环境无关铁律——用户机器无 Node、无网络运行时、无包管理器；解法已在 Phase 1 预登（[environment-independence.md](../../../../docs/environment-independence.md) 条款 5：安装动作可联网且仅限 registry tarball 直拉，运行全程离线，一律预打包零依赖单文件，宿主拒载其他形态）。动工前欠着三笔账：`assetProtocol.scope: ["**"]` 过宽、CSP/自定义协议装载通道未经验证、存量清单无迁移逻辑（同文档已知欠账区）。

Phase 1 全分支终审另沉淀了四项顺路欠账：layering 扫描的无空白 import 盲区、启动失败白屏（外置插件装载失败必须有可见出口）、唯一 home 缺 dep-audit/layering 门禁条目、以及 32 条可延后 minor（分诊记录随 PR #14）。

## Decision

范围圈定：**本阶段 = 外置插件全链路**（安装/导入/装载/校验/管理面板）+ 三笔前置欠账收口 + 三项顺路欠账；文件监听（notify）、跨窗同文件 stale、dep-audit symlink 跟随与其余 minor 不进本阶段。总纲：宿主把 npm 当仓库用、不当运行时用——安装是 Rust 侧的一次性联网动作，装载是运行期离线的本地资源读取。

1. **装载通道（动工前置，技术验证定案）**：webview 内动态 `import()` 外置单文件 ESM。两个候选：Tauri 自定义协议（Rust 注册 `plugin://` 类协议读插件目录）vs blob URL（Rust 命令读字节 → JS 端 Blob → import）。首任务做一次真实通道验证（dev 与 build 双形态、darwin WKWebView），**自定义协议优先、blob URL 兜底**（Phase 1 Note 预许）。定案后：CSP `script-src` 增对应来源（协议名或 `blob:`）；联网只发生在 Rust 安装动作，webview CSP 不开任何 connect-src。`src/loader/external.ts` 是全前端唯一动态 import 点——`layering-allowlist.json` 开 Phase 1 以来的第一条缝（单文件登记，扩缝必须回本 Note 修订）。
2. **Rust 包管理命令**（全局住 Rust）：`install_plugin(spec)`（spec = `name` 或 `name@version`：查 registry 元数据 → 下载 dist.tarball → sha512 校验（npm dist.integrity，base64）→ 解压 → 校验格式（见第 3 条）→ 入 `app_config_dir/plugins/<name>/`）、`import_plugin(path)`（本地 tgz，同管线免联网）、`list_plugins()`（目录扫描 + package.json 元数据）、`remove_plugin(name)`（删目录）。HTTP/TLS/gzip/tar/sha512 全部纯 Rust 栈（rustls 系，禁系统 OpenSSL dylib——`verify:native-links` 是机械看门人；具体 crate 归实现计划定）。registry 固定公网 npmjs，不内置镜像配置（用户侧差异交给系统级代理）。
3. **外置插件格式（封闭契约）**：tgz 内必须恰好是 `package.json` + 单个入口 `.js`（ESM）；`package.json` 声明 `"studywiki": { "apiVersion": <number>, "entry": "<file>" }` 且 `keywords` 含 `"studywiki-plugin"` 且 `dependencies` 为空对象（零依赖）。宿主支持集当前为 `{1}`；apiVersion 不在支持集 → 拒载。任何一条不符 → 安装即拒（fail-loud 点名缺什么），不从坏包里猜。
4. **装载器第二来源**：boot 时经命令扫描插件目录，外置模块走装载通道动态 import 后与内置静态表合并进同一装载流程（同一 `ctx.plugin`、同一激活审计）。清单行 id 命名空间：内置 id 原样，外置一律 `ext:<name>`。**资源缺失与形状错误分治**：清单行形状残缺仍按既有校验抛错；插件目录缺失/入口损坏 → 该行跳过装载、面板点名标记"待清理"、不阻断其余插件（外置资源是用户侧状态，不配让整个应用起不来）。
5. **存量清单迁移**：`loadManifest` 读到存量清单时，把静态模块表新增而清单缺失的内置行合并进去（enabled 默认 true，与首启一致——版本升级带新内置属行为一致条款的设计内变化），写回落盘。外置行不迁移不猜，以插件目录为准源。
6. **assetProtocol 收紧**（欠账收口，方案沿用唯一 home 预登）：配置 scope 从 `["**"]` 收窄为空，用户选中/新建窗口携带 root 时由 Rust 动态注入该目录（recursive），视频与图片仍走 asset protocol。
7. **宿主服务 `ctx.plugins`**：PluginService 封装四个包管理命令 + 装载通道取模块（install/import/list/remove/loadModule）——外置插件管理与装载走宿主服务，`src/plugins/**` 分层纪律零例外。plugin-manager 是唯一消费者（Phase 2 内）。
8. **plugin-manager 内置插件**（第六件，最简管理面）：顶栏按钮 → 面板列已装（内置 + 外置）、按名安装、本地导入、启用开关、外置删除；一切改动写清单后**提示重启生效**（Phase 2 不做热装载——cordis 天生支持运行时 ctx.plugin，但审计/清单一致性的最简正确形态是重启生效；热装载留后续阶段）。待清理行（第 4 条）在面板提供一键移除。
9. **启动期最小错误面板**（M1 收口，外置装载失败的可见出口）：bootstrap 拒绝时向 `#app` 内联渲染错误文本与待清理指引，替代白屏；错误仍同时进 console。
10. **门禁与文档连锁**：layering 无空白 import 盲区顺修（`import{x}from"…"` 形态，外置装载缝开启前把扫描器补齐）；environment-independence 补 dep-audit/layering 机械门禁条目（M2）、豁免登记表"外置插件安装联网"从预登转生效、已知欠账区清掉本 Note 收口的三条；architecture 三件套（组成树 + 外置装载数据流 + 决策表）、commands 生成区（新命令带文档注释）、code-map、本 Note 收口转 implemented。Rust 依赖变化天然落在既有 route:gates 的 `src-tauri/` 改动面（含 native-links）。

## Alternatives considered

- **npm/pnpm 运行时安装（DSH 原样）**：Phase 1 Note 已否——要求用户机器有 Node ≥22 + pnpm + 网络，三条直撞铁律；postinstall 任意代码执行无审核。不重开。
- **纯本地导入（无 registry 下载）**：最稳但放弃按名安装的分发便利；registry 直拉以"npm 当仓库用"同时拿到便利与零运行时。本地导入保留为第二入口而非唯一入口。
- **WebWorker/iframe 沙箱装载**：隔离更佳，但宿主 API 注入（ctx.* 直达 DOM/slots）复杂度大增且违背两栖同契约；同进程全权是既定信任模型（Obsidian 前车之鉴记录在 Phase 1 Note），apiVersion + 零依赖 + 单文件是当前防线。沙箱留给真有恶意插件治理需求的阶段。
- **热装载（安装即激活，免重启）**：cordis 原生支持，但清单写回一致性、失败回滚、多窗同步三件事的最简正确解都是"下次 boot 见"；Phase 2 用重启换正确性，把热装载留给有真实痛点的后续。
- **存量迁移 enabled 默认 false（保守）**：升级用户会"静默少了新内置"，与首启用户行为分叉，反而制造两种初始态；取 true 与"同一版本 + 同一插件集 → 行为一致"自洽（版本升级换插件集，是设计内变化）。
- **CSP 开 connect-src 让 webview 直接下载**：把网络面引进渲染层，撞"联网仅限 Rust 安装动作"的预登记款；下载必须走 Rust 命令。

## Consequences

- 运行期离线不变；安装动作成为产品第一个用户可见的联网点（豁免登记表生效行）。
- 装载缝从零到一：`src/loader/external.ts` 是全前端唯一动态 import，白名单单条即断言；任何第二条缝都必须回本 Note 修订并说明理由。
- 外置插件同进程全权：apiVersion 拒载 + 零依赖 + 单文件格式是全部防线，作者侧靠 prepublishOnly 自动构建保证格式（分发契约见 Phase 1 Note）；恶意插件治理不在本阶段承诺内。
- 升级用户的存量清单自动补新内置行（enabled true）；外置行以插件目录为准源，目录先删则面板点名待清理。
- 技术验证若以 blob URL 收场（自定义协议在 WKWebView 的 ESM 装载不成立），CSP 增 `blob:` 且本 Note 落 implemented 时记实际通道与理由——两个候选都是预许形态，验证只决定取哪个。
- 欠账区三条清空；新欠账预期一条：linux 面的 ureq/rustls 链接扫描待首个真实发布验证（native-links 白名单覆盖系统 C 运行时，纯 Rust 栈理论零新增 dylib）。
- 文件监听、跨窗 stale、symlink 跟随与其余 minor 继续停机坪，随本 Note 的 PR 说明存档分诊。
