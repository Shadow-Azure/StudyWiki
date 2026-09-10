# Agent Note: 插件化架构：cordis 契约 + 两栖插件

Status: proposed

[English](2026-09-10-plugin-architecture.en.md) | 中文

## Problem

StudyWiki 要从单窗口两层小应用（前端约 60 行、Rust 两条命令）长成多窗口、带文件树与 markdown 编辑/预览、后续还有视频与 AI 能力的客户端，需要一种可持续的拓展开发方式；同时硬约束要求产物零预装、完全离线、行为一致。要决定的是：以什么插件机制承载拓展，且该机制与环境无关约束长期共存——不是今天不冲突，而是结构上不可能互相背叛。

## Decision

全工程基于 cordis v4 插件契约开发：插件 = `name` / `inject` / `apply` 三段式，服务占 `ctx.<key>`，注册即可逆副作用，Fiber 管生命周期。**取契约、弃装载器**——plugin-loader / plugin-include / plugin-hmr 绑定 Node API（fs、内部 ESM loader、chokidar），一律不用；组装改为清单 + 静态模块表 + 百行级装载器（DSH 浏览器端静态模块表先例的骨架版）。cordis 从自有 fork（Shadow-Azure/cordis，v4.0.0-rc.10）vendor 进仓库锁死，`dependencies` 里 cordis 相关条目为零。分层纪律物理化：插件只能经宿主服务触达系统能力，`src/plugins/` 禁止 import `@tauri-apps/*`（门禁机械校验）。

插件分两栖：**内置插件**静态编译进 bundle，是仓库内的普通模块（第一期全部功能走这条路，作者即本仓库开发者，免发布流程）；**外置插件**（Phase 2）是预打包零依赖单文件，安装 = Rust 侧 registry 直拉（查元数据 → 下载 tgz → sha512 校验 → 解压 → 入插件目录，全程无 npm/pnpm/Node）或本地文件导入，发布靠作者侧 `npm publish` 的 prepublishOnly 自动构建。两栖共用同一契约与同一宿主 API 面。参照系：DSH 出契约与静态装载先例；VS Code 出离线分发形态（扩展预打包、宿主注入 API、marketplace 可选）；Obsidian 提供同进程全权的前车之鉴。

### 阶段划分

- **Phase 1**（`multi-window-file-tree` 分支）：vendored cordis、宿主服务层、装载器、全部内置插件（多窗口 / 文件树 / markdown 编辑预览 / 视频）、门禁与文档连锁。产物不含任何外置插件能力。
- **Phase 2**（独立分支）：registry 直拉 + 本地导入 + 外置插件装载校验（apiVersion、零依赖格式检查）。
- **Phase 3+**（只留门）：可选运行时提供方（如 Node sidecar）按可插拔服务形状设计接口、不实现，由真实插件需求触发。

### 分层与窗口模型

Rust 壳全局一份，前端每窗口一份；全局状态住 Rust，窗口状态住各自的 cordis Context：

```text
┌─ Rust 壳（src-tauri，全应用单份）──────────────────────────┐
│  文件服务：目录树扫描、读文件、写文件（新增）                  │
│  窗口注册表：label → root，谁开着、开的是哪个文件夹            │
│  （Phase 2）插件包管理：registry 直拉、校验、解压、目录管理     │
└──────────── Tauri 命令 + 事件（IPC）──────────────────────┘
                         ↕
┌─ 前端（src/，每个窗口一份独立实例）─────────────────────────┐
│  vendor/cordis（Context/Fiber/Registry，从 fork 收编）        │
│  宿主服务层：files / windows / workspace / slots             │
│    —— 全前端唯一有权 import @tauri-apps/* 的层                │
│  装载器：清单(JSON) → 静态模块表 → ctx.plugin() → 激活审计    │
│  内置插件：文件树、markdown 文档、视频查看器、窗口管理……      │
│  UI：原生 DOM + 类型化 slot 注册表（无 UI 框架，遵惯例）       │
└────────────────────────────────────────────────────────────┘
```

三条结构纪律：**单向依赖**（插件 → 宿主服务 → Tauri API → Rust）；**全局住 Rust、窗口住 Context**（判断口诀：这个状态关掉一个窗口该不该消失？该 → 窗口 scope，不该 → Rust 侧权威）；**组合是数据**（启用哪些插件、各自什么配置由清单驱动，装载器只是清单执行器，Phase 2 只多一个模块来源）。

多窗口机制：每个 webview 加载同一 bundle、各自 bootstrap——取当前窗口 label → Rust `get_window_state(label)` 领 root → 建 Context 挂四个宿主服务 → 装载器跑清单 → 审计渲染。新建窗口由 Rust 命令执行（生成 label、登记注册表、创建 WebviewWindow），注册表是 root 的唯一权威，刷新重载不丢。窗口间无直接握手，同步只走 Rust 事件总线：

| 事件 | 触发 | 消费方 |
|---|---|---|
| `fs://changed {path}` | Rust 在写文件落盘后广播（含写入者自己） | 所有持相同 root 的文件树重读该目录 |
| `win://closed {label}` | Rust 清理注册表时 | 需要"打开中的窗口"概念的 UI（Phase 1 预留） |

关窗即杀掉该 webview 的 JS 世界（cordis 树随之消失），Rust 在窗口销毁事件清注册表；关窗前有脏文档则弹确认（前端拦截即可），保存为 Ctrl+S 手动 + 脏标记，自动保存不做。错误处理三层：启动期装载审计 fail-loud（点名"某插件等待某服务"）；运行期插件 fiber 失败自动回滚其注册项、其余继续活、对应槽位变空；Rust 命令错误原样上抛、UI 内联显示。

### 组件与宿主 API 面

```text
src/
  main.ts                # 每窗口 bootstrap
  host/                  # files.ts windows.ts workspace.ts slots.ts
  loader/                # manifest.ts table.ts boot.ts
  plugins/
    app-shell/           # 基础布局：顶栏/侧栏容器/主区容器（slot 宿主）
    app-windows/         # 新建窗口入口
    view-filetree/       # 侧栏文件树：展开折叠、点击打开
    doc-markdown/        # CodeMirror 6 编辑 + markdown-it 预览 + 切换 + 保存
    doc-video/           # 视频查看器（保留现有能力）
  vendor/                # cordis + cosmokit，tsconfig paths 映射
```

四个宿主服务（签名 spec 于实现计划定稿，均带契约注释）：`ctx.files`——`readTree(root)` 返回 `FileNode{name,path,kind,children?}`（kind 由 Rust 定，扩展名分派单一决策点）、`readText`、`writeText`、`pickFolder()`（包住 dialog）、`assetUrl(path)`（包住 convertFileSrc）、`onChanged` 事件；`ctx.windows`——`create({root?})`、`current()`、`onClosed`；`ctx.workspace`——窗口 scope 的 `root` / `activeFile` / `openFile(path)` 与变更事件；`ctx.slots`——类型化 UI 槽位注册表（TS 声明合并登记契约，DSH SlotMap 的原生 DOM 版）。槽位是有序渲染器列表、各渲染器自决可见性（非自己关心的 kind 不画），避免单槽竞争。`LibraryEntry` 升级为 `FileNode`。

内置插件与依赖：`app-shell`（inject slots，定义 `topbar.*` / `sidebar.tree` / `main.viewer` 槽位）；`app-windows`（windows, slots）；`view-filetree`（files, workspace, slots，点击 → `workspace.openFile`）；`doc-markdown`（files, workspace, slots，订阅 activeFile，kind=markdown 挂载）；`doc-video`（同构，`files.assetUrl` 喂 `<video>`）。

清单住应用数据目录（首次启动从静态模块表默认值生成）：

```json
{ "plugins": [
  { "id": "app-shell", "enabled": true, "config": {} },
  { "id": "view-filetree", "enabled": true, "config": { "ignoreDotfiles": true } }
] }
```

装载流程：读清单 → 逐行查静态模块表 → `ctx.plugin(plugin, config)`（顺序由 `inject` 自动解析，无人工编排）→ 树静默后逐行审计 Fiber 状态，fail-loud 点名。清单未列的模块表条目默认禁用（"关掉视频插件"即改一个 `false`）。

Rust 命令面变化：新增 `read_tree`（递归，取代 `list_library`，不并存）、`write_text_file`、`create_window`、`get_window_state`；`read_text_file` 保留。

### 铁律修订与门禁

[docs/environment-independence.md](../../../../docs/environment-independence.md)（唯一 home）条款修订：条款 2"完全离线"主体收窄为"核心与内置插件"构建期打包、全程离线；条款 3"行为一致"改为"同一版本 + 同一插件集"；新增外置插件条款（规则现在立、Phase 2 生效）：外置插件是用户主动安装的本地资源，安装动作可联网且仅限 registry tarball 直拉，安装后运行全程离线，一律预打包零依赖单文件、宿主拒载其他形态；豁免登记表预登"外置插件安装联网（Phase 2 启用）"并附本 Note 链接。

新增机械门禁（均进 `pnpm test` 自测试）：`verify-dep-audit`——依赖白名单 diff + 传递闭包扫 `node:` 内建引用，新增依赖未登记即红；分层纪律扫描——`src/plugins/` import `@tauri-apps/*` 或宿主实现即红（type-only 放行），`src/` 出现任何动态 `import()` / `eval` / `new Function` 即红（装载缝白名单 Phase 1 为空，零动态加载，Phase 2 才开那一条缝）；`verify-native-links`——otool/ldd 扫发布产物动态链接（收掉已知欠账，进 release 档）；门禁接线——`run-gates` 模式组合与 `route:gates` 改动面映射同步。依赖白名单初值：`@tauri-apps/api`、`@tauri-apps/plugin-dialog`、`markdown-it`、CodeMirror 系（`codemirror`、`@codemirror/lang-markdown`、`@codemirror/language-data` 等，纯 ESM 零运行时依赖）；cordis/cosmokit 走 vendor，源码级扫描天然覆盖。

文档连锁（现有门禁自动盯住）：architecture.md 组成区重写、数据流更新、type-equiv 围栏换 `FileNode`；commands.md 生成区重生成；code-map 重跑、vendor 按单条聚合条目登记（记上游 commit，不逐文件入树）；AGENTS.md 惯例新增"插件只经宿主服务触达系统能力"、命令清单同步；受影响常驻文档双语三件套最小修补 + 重录。

### 测试策略

每层只测自己的逻辑，Tauri/webview 边界 mock，真实交互走手工验收。Rust（cargo test）：`read_tree` fixture 树断言（嵌套、混合扩展名、点文件、空目录、大小写排序）、`write_text_file` round-trip 与错误路径、kind 分派扩展、窗口注册表纯逻辑。前端（vitest）：装载器（默认清单生成、行解析、禁用跳过、未知 id fail-loud、注入缺失审计点名——假插件 + 假服务）、宿主服务薄封装（mock invoke，锁参数透传与错误透传）、workspace 状态机、doc-markdown 模式切换与脏标记纯逻辑。门禁自测试：每个新 verify 脚本配真阳/假阳 fixture。手工验收清单（`pnpm tauri dev`）：新建窗口与多窗口并存、每窗口独立开文件夹、关窗脏文档确认、树展开/折叠/点开 md、编辑高亮、预览切换、保存后跨窗口树刷新、视频播放不回退。实现按 TDD 红-绿循环走。

## Alternatives considered

- **最小静态（cordis 作 npm 依赖 + 手写 ctx.plugin 链）**：机器最少，但 Phase 2 要回头改入口补装载器；"内置插件只走宿主 API"无机械约束必然腐化；rc 线每次升级都是依赖审计 + API 迁移。省下的几百行会在 Phase 2 连本带利还回。
- **完整移植 DSH 组装层（loader/include/patch 层/profile）**：最大保真，但 patch 层、profile、HMR 是开发工具型 CLI 的机器，终端用户桌面应用几乎无受众，刻意模仿式违反 YAGNI。
- **外置插件走 npm/pnpm 运行时安装（DSH 原样）**：要求用户机器有 Node ≥22 + pnpm + 网络，三条直撞铁律；浮动版本破坏行为一致；postinstall 任意代码执行无审核。
- **嵌入 Node sidecar 供插件复用**：机制可行（Tauri sidecar），且随产物分发不违反修订后铁律；但 +70–100MB/平台、无沙箱的任意代码执行（DSH 的 landlock 沙箱仅 Linux，macOS/Windows 等价物是深坑）、双运行时维护。Node 能干的事 95% 可由 webview JS + 宿主 API、WASM、Rust 侧服务覆盖，唯余价值是复用 npm 现成 Node-only 包。安全否决，门留作 Phase 3+ 可插拔服务。
- **纯本地导入（无 registry 下载）**：最稳但放弃包名安装的分发便利；registry 直拉以"npm 当仓库用、不当运行时用"同时拿到便利与零运行时。
- **markdown 编辑器 textarea 起步、后换 CodeMirror**：省的工作量有限，textarea 版本注定废弃、接口抽象层是纯沉没成本；选 CodeMirror 6 一步到位（纯 ESM、零运行时依赖、构建期可打包，过得了依赖审计门禁）。

## Consequences

- **宿主 API 纪律是第一天成本**：内置插件从 Phase 1 起只走 `ctx.*`，这是 Phase 2 外置插件不踩暗礁的前提，无法事后补课。
- **vendor 维护债**：cordis 升级 = 手动 diff + 本地补丁显式登记（对照 DSH vendoring 纪律：收编清单 + 上游 commit 可追溯）；换来 rc 漂移免疫与依赖面归零。
- **已知欠账**：外部程序改文件的实时监听缓建（Phase 1 只广播自己写入 + 手动刷新兜底，notify 是 Phase 2 候选）；`assetProtocol.scope: ["**"]` 收紧是 Phase 2 开放外置插件的前置项；Phase 2 动工前需一次 CSP/自定义协议装载通道的技术验证（blob URL 兜底，风险低但要排期）。
- **行为一致条款微调**：同一版本 + 同一插件集才保证一致；外置插件引入用户侧差异是设计内行为，由 apiVersion 拒载机制兜底。
- **命令面变更**：`list_library` 退役（被 `read_tree` 取代），命令目录与 type-equivalence 围栏随之更新，属正常门禁流程。
- **Phase 2 的豁免在规则层已预登**：联网仅发生在"安装外置插件"动作，运行全程离线不变；本 Note 落地 implemented 时同步 environment-independence.md 的登记行。
