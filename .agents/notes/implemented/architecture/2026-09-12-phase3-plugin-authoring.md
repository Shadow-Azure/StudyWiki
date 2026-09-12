# Agent Note: Phase 3 作者侧插件工具链 + 宿主加固收口

Status: implemented

[English](2026-09-12-phase3-plugin-authoring.en.md) | 中文

## Problem

Phase 2 交付了外置插件的消费者侧（安装/导入/装载/管理面板，[Note](../../implemented/architecture/2026-09-11-phase2-external-plugins.md)），供应链的作者侧仍是手工活：封闭契约的包结构要作者照 PR 描述里的 shell 片段逐字手搓，仓库里没有可复用的工程起点，发布前也没有机械校验兜底——格式错误要到用户安装那一刻才被宿主拒载。同时有两笔既定欠账：Phase 2 终审裁定的 fast-follow 加固捆包（ureq 无超时、tarball 无大小上限、`entry == "package.json"` 可过装、inject 非数组透传、面板 render unhandled rejection）；以及 [dynamic-asset-scope](../feature/2026-09-06-dynamic-asset-scope.md) 提案只落地了一半——assetProtocol 协议面在 Phase 2 收空了，命令面（`read_tree` / `read_text_file` / `write_text_file`）仍收任意绝对路径，"权限面与用户意图匹配"没有闭环。

## Decision

范围圈定：**本阶段 = 作者侧工具链（脚手架生成器 + 发布前校验 + 作者指南）+ 宿主加固捆包（fast-follow 五项 + 命令面根域校验）+ 顺路文档/Note 清扫**。文件监听（notify）、热装载、跨窗同文件 stale、symlink 治理、插件沙箱、运行时提供方（[Phase 1 Note](../../implemented/architecture/2026-09-10-plugin-architecture.md) 的 Phase 3+ 门，真实需求未触发）不进本阶段。

1. **脚手架生成器**（作者侧工程起点）：`pnpm gen:plugin -- <name>` 在 gitignored 的 `plugins-dev/<name>/` 生成完整 npm 包——package.json（`keywords` 含 `studywiki-plugin`、`dependencies` 空、`studywiki: {apiVersion: 1, entry: "index.js"}`、`files: ["index.js"]`、`scripts.build/check/prepublishOnly`）、`src/index.ts`（顶栏 hello 示例，带本地最小类型副本 `src/host.d.ts`）、`scripts/check.mjs`（发布面机械校验）。**不带 README**——npm 无条件把 README/package.json 打进 tgz，带 README 的发布面必为三文件，撞宿主"恰好两文件"契约；作者指南住 StudyWiki 文档而非生成物。模板文本内嵌于 `scripts/gen-plugin-template.mjs`：仓库零新增依赖；esbuild/typescript 是生成物的 devDependencies，装在作者机器，宿主 dep-audit 与发布产物完全不见。生成器配 spec 自测试（渲染字节断言 + 名字校验），模板与宿主封闭契约的漂移在 `pnpm test` 即红。
2. **发布前校验**：模板 `check.mjs` 用 `npm pack --dry-run --json` 断言发布面恰好 `package.json` + `index.js` 两文件、studywiki 块/keyword/空依赖齐备、entry 顶层——与宿主安装管线同一契约的作者侧镜像，fail at publish 而非 install。
3. **作者指南**（`docs/plugins/authoring.md` 三件套，进常驻文档体系——预算/配对/索引）：封闭契约全表（现状口径）、生成 → 构建 → 校验 → 发布（`npm publish`，prepublishOnly 自动 build + check）、本地导入内环（无热装载，重启生效，Phase 2 裁定不变）、apiVersion 语义、同进程全权信任模型披露。
4. **宿主加固捆包**（fast-follow 五项，[environment-independence.md](../../../../docs/environment-independence.md) 运行期离线与依赖面不变）：
   - ureq 共用 Agent 带整体超时（registry 元数据 + tarball 两调用点）；
   - tarball 下载与本地导入读文件均有大小上限（20 MiB；封闭契约下恶意大包是 DoS 加固面而非安全边界，超限 fail-loud 点名）；
   - `parse_package_json` 拒 `entry == "package.json"`（封掉双 package.json 计数旁路，安装期与装载期同拒）；
   - 外置模块 `inject` 非 `undefined` 且非字符串数组即拒（`undefined` 合法——inject 可选）；
   - plugin-manager render 对 `readManifest` / `list` 的 reject 内联显示，消灭 unhandled rejection。
5. **命令面根域校验**（dynamic-asset-scope 收尾）：`read_tree` / `read_text_file` / `write_text_file` 三命令的路径必须落在窗口注册表已授权 root 之内（词法 `starts_with`，与 `allow_directory` 的授权注入同源同层级；symlink 跟随维持停机坪）。授权准源 = WindowRegistry roots（`set_window_root` / `create_window` 注入处），lib.rs 单一决策点；注册表无 root（欢迎态）时三命令全拒。窗口 A 可读窗口 B 的 root 属 app 级共享授权，与 asset scope 已知局限一致。
6. **文档与 Note 收口**：code-map 补 lib.rs 职责行（插件命令注册现状）；boot-error 指引补"或重新打开文件夹"；dynamic-asset-scope 三件套转 implemented；本 Note 转 implemented；AGENTS.md 命令清单 +1（`gen:plugin`）；全量门禁 + release 档。

## Alternatives considered

- **模板独立仓库（plugin-starter）**：仓库分叉维护，模板与宿主契约的漂移无门禁看护；内嵌模板 + spec 钉渲染字节使漂移在本库测试即红。
- **发布宿主类型包 @studywiki/types**：作者侧类型体验更好，但引入发布物与版本同步责任；本阶段取生成物内的本地最小类型副本 + 指南为准，类型包留真实痛点触发。
- **check.mjs 调宿主 Rust 管线校验（tauri CLI import）**：要求作者机器有 Rust 工具链，与"作者侧只需 Node"的定位不符；`npm pack --dry-run --json` 是纯 npm 的发布面真值，足够。
- **命令面校验复用 FsScope::is_allowed**：与协议面同源最彻底，但 invoke 命令不走 asset scope 判定，命令侧需要自己的判定点；取注册表 roots 的词法判定，symlink 治理另册。
- **gen:plugin 做交互式向导**：YAGNI，参数即名字。
- **dev 模式热装载内环**：Phase 2 已裁定重启换正确性，不重开。

## Consequences

- 作者侧"工程化"不增加宿主复杂度：仓库新增的只有生成器脚本与文档；发布产物除加固项外零变化。
- 20 MiB 上限是产品裁量值：封闭契约下单文件插件远低于此，超限即拒并点名上限。
- 命令面根域校验后，欢迎态三命令全拒——任何"未开文件夹也能读文件"的潜在用法会 fail-loud 暴露（现有调用面经查无此形态）。
- 模板内嵌的契约校验与宿主 Rust 校验是同一契约的两份实现，由各自测试钉住；宿主改封闭契约须同步模板与指南（文档连锁）。
- dynamic-asset-scope 转 implemented 后，其"root 外默认拒绝"由根域校验与 scope 收空共同覆盖；子目录引用（库内指库外文件）默认拒绝、明确报错。
- 文件监听、热装载、symlink、跨窗 stale、沙箱、运行时提供方维持停机坪，随本阶段 PR 说明存档分诊。
