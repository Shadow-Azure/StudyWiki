# Agent Note: 模型供给落地：配置契约、Rust 薄能力层与 ~/.studywiki 用户配置根

Status: implemented

[English](2026-10-01-ai-inference-supply.en.md) | 中文

## Problem

[AI 推理供给 ADR](../../proposed/architecture/2026-09-19-ai-inference-supply.md) 已定论「用户显式配置的远程 endpoint + OpenAI 兼容协议 + 产品不内置密钥」，但只是方向：配置存哪、什么 schema、HTTP 谁发、插件怎么触达、密钥什么立场，全部没有契约。m2-01（issue #28）要求把这层落成可实现的底座，否则 m2-02/m2-03 的 agent 宿主与基础 agent 无米下锅。

## Decision

### 分层：Rust 薄能力层 + 前端宿主服务 + 内置配置插件

| 层 | 职责 | 不做什么 |
|---|---|---|
| Rust（薄能力层） | settings.json 持久化与一次性迁移、HTTP egress（webview 有 CORS，前端发不了厂商 API）、0600 权限、错误归一 | 会话、路由、重试、任何 agent 逻辑 |
| 前端宿主服务 `ctx.llm`（第七服务） | 模型路由（`chat({model})` 解析归属 endpoint）、脱敏列表、inject 白名单 | 直接持 key、直接发网络请求 |
| 内置 `llm-settings` 插件 | 纯 UI：厂商预设实例化、填 key、探测 | 业务逻辑 |

调用形态：插件调 `ctx.llm.chat({model, messages})` → 前端路由出 `(endpointId, model)` → invoke Rust `llm_chat` → 复用既有 `ureq`（rustls）发 HTTPS → 归一错误后原路返回。非流式一趟 IPC；流式在 m2-02 用 Tauri `ipc::Channel` 增量加入，调用形状不变。

论据（与 dsh 对照）：dsh 的 agent/llm/tools 全在 TS 侧（`ctx.llm` / `ctx.tools` / `ctx.agents` 三正交服务，agent-loop 也只是插件），native 只做能力隔离（landlock-run）；m2-02 issue scope 已排除 `src-tauri/**`；插件契约是单文件零依赖 JS。

### 用户配置根 `~/.studywiki/`

统一用户配置目录：Tauri `app.path().home_dir()` + `.studywiki`（零新 Cargo 依赖），三端同形（Windows 为 `C:\Users\<name>\.studywiki\`），无环境变量分支，对标 `~/.claude` / `~/.codex` 的可发现性。现有 `app_config_dir()` 下的 `plugins.json` 与 `plugins/` 一并迁入；`plugin_dir` / `read_manifest` / `write_manifest` 三处切到新模块 `config.rs` 的 `studywiki_dir()`。启动一次性迁移：老目录有条目且新目录缺席则 move；两边都有以新目录为准，老条目保留不删（迁移幂等可重入）。

### 配置契约 `~/.studywiki/settings.json`

```jsonc
{
  "version": 1,
  "endpoints": [
    {
      "id": "deepseek",                     // 唯一，用户可改
      "name": "DeepSeek",                   // 显示名
      "kind": "chat",                       // chat | asr；LLM/VLM 共用 chat
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "sk-…",                     // 明文，文件 0600
      "models": [
        { "id": "deepseek-v4-pro",   "capabilities": ["text", "vision"] },
        { "id": "deepseek-v4-flash", "capabilities": ["text"] }
      ]
    }
  ],
  "defaultModel": "deepseek-v4-flash"       // 未指定 model 时的兜底
}
```

- 模型路由（前端宿主服务内）：`ctx.llm` 按 `model` id 解析归属 endpoint，再把 `(endpointId, model)` 交给 Rust；同 id 多归属 → `MODEL_AMBIGUOUS`；无归属 → `MODEL_UNKNOWN`；未传 model 用 `defaultModel`，缺席 → `MODEL_UNSPECIFIED`。
- `capabilities` 含 `vision` 即 VLM；`kind: "asr"` 走 `/v1/audio/transcriptions` 契约，本期只落 schema 与探测，工具本体在 m3-01。
- 写文件 tmp + rename 原子写，权限 0600；解析失败 fail-loud，不静默覆盖用户文件。

### Rust 命令面（新模块 `config.rs` + `llm.rs`，复用既有 ureq rustls，零新 Cargo 依赖）

| 命令 | 语义 |
|---|---|
| `llm_list_presets` | 返回厂商预设表；baseUrl 只存在于 Rust 侧（`verify-env-independence` 机械门禁禁 `src/**` 外部 URL） |
| `llm_list_endpoints` | 返回脱敏配置（`apiKey` → `hasKey` + 掩码预览），任何路径拿不到完整 key |
| `llm_upsert_endpoint` / `llm_remove_endpoint` | 原子写 settings.json |
| `llm_probe(endpoint_id)` | OpenAI 兼容 `GET /models` 轻量探测，成功返回延迟 ms |
| `llm_chat({endpointId, model, messages, …})` | 非流式 chat/completions，纯传输 |

归一错误码（全链路共享词表）：Rust 传输层 `UNREACHABLE` / `UNAUTHORIZED` / `TIMEOUT` / `RATE_LIMITED` / `BAD_RESPONSE` / `ENDPOINT_UNKNOWN`；upsert 校验 `INVALID_CONFIG`；前端路由层 `MODEL_UNKNOWN` / `MODEL_AMBIGUOUS` / `MODEL_UNSPECIFIED`。插件只处理同一套码。

### 前端宿主服务与内置插件

`src/host/llm.ts`（deps 可注入）挂 `ctx.llm`，facade：`list / upsert / remove / probe / chat`；外置插件 inject 白名单只放 `list / probe / chat`，写操作仅内置插件可用。内置 `llm-settings` 插件：顶栏入口 + 面板；厂商预设表（构建期静态模板，不锁死，经 `llm_list_presets` 提供）——智谱 GLM（`https://open.bigmodel.cn/api/paas/v4`，glm-5.3 / glm-5.3-flash）、DeepSeek（`https://api.deepseek.com/v1`，deepseek-v4-pro / deepseek-v4-flash）、Kimi（`https://api.moonshot.cn/v1`，kimi-k3）、MiniMax（`https://api.minimaxi.com/v1`，minimax-m3）、自定义 OpenAI 兼容；选预设自动带 baseUrl + 模型清单（可增删改），用户只必填 apiKey；每模型可标 `vision`；保存后可一键探测。

### 模型配置 UI 与厂商投影

列表态使用卡片化滚动布局，顶部提供「全部 / 智谱 / DeepSeek / Kimi / MiniMax / 自定义」厂商摘要 chips，可按归属厂商筛选；卡片显示厂商徽标、id、baseUrl、模型数量、密钥状态与探测结果。表单态把厂商预设放到顶部，切换预设即时填充 baseUrl 与模型清单；字段区、模型区和底部操作条按 mockup 网格化布局。为此 Rust 脱敏 endpoint 投影新增 `vendor`（按 baseUrl 匹配预设，未匹配为 `custom`），前端只用于展示与筛选，不参与配置写入。

### 密钥立场

settings.json 明文直存，与 Claude Code（`~/.claude/settings.json` env 明文 token）、Codex（`~/.codex/auth.json`）、dsh（`apiKey` 字面值一等公民）同水位。加固：文件 0600；命令面只进不出（list 脱敏）；外置插件白名单不含写命令。仓库不存密钥的约束不受影响（用户目录）。

### 门禁与文档

`docs/environment-independence.md` 豁免表登记「AI 推理经用户显式配置的远程 endpoint」并链 ADR；ADR note（即上文 Problem 所链）转 implemented。`docs/architecture.md` 更新组成树、数据流、关键决策（`~/.studywiki`、密钥明文 + 0600、Rust 薄能力层）。常驻文档中英三件套配对重录；`pnpm gen:commands` 重建命令目录；门禁 `verify:env-independence` / `verify:dep-audit` / `verify:layering` / `verify:docs` 全绿。

### GUI 冒烟与测试固化

冒烟以本地 mock HTTP server + debug bundle 人工走查：零配置调用返回归一错误码（不弹窗）、预设表单实例化、保存后列表行带 🔑 徽标、探测显示延迟（82ms）、错误 baseUrl 探测显示 `UNAUTHORIZED: HTTP 401`；settings.json 落盘 0600 且字段 camelCase。该旅程固化为 `tests/llm-settings.test.ts` 两个面板集成用例（真实面板 DOM + 脚本化 `ctx.llm`，端点 wire 形状与 Rust 脱敏投影一致）；Rust 侧探测/chat 路径另有 mock HTTP server 单测（`cargo test` 50/50）。

### 范围裁剪

`llm_chat` 非流式（流式归 m2-02）；ASR 只落契约与探测（工具归 m3-01）；不做多协议适配器层、故障转移、用量统计。

## Alternatives considered

- **Rust 侧做 agent 宿主**：动态库插件破坏单文件 JS 契约并引入 ABI/签名地狱；内嵌 JS 引擎等于再造运行时、撞环境无关性红线并催生两套插件系统。均否（dsh 亦同：agent 全在 TS，native 只做能力隔离）。
- **前端直接 fetch 厂商 API**：webview CORS 卡死，排除；tauri-plugin-http 是其代理版，流式与错误语义不如自持 ureq。
- **OS 钥匙串存 key（keyring crate）**：安全水位更高，但用户拍板与 Claude Code / Codex / dsh 的明文配置文件机制保持一致，降低迁移与调试成本；保留 0600 + 命令面只进不出作为加固。
- **保留 `app_config_dir()` 存配置**：macOS 上藏在 `~/Library/Application Support` 深处，用户找不到、改不了，否。
- **多协议适配器层（抄 dsh `LlmAdapter`）**：ADR 锁定 OpenAI 兼容单协议，GLM/DeepSeek/Kimi/MiniMax 均提供兼容端点，适配退化为配置差异，YAGNI。

## Consequences

- m2-02/m2-03 的 agent 循环将是前端插件，经 `ctx.llm` 发起推理；流式到来时只改 Rust `llm_chat` 返回路径（Channel），调用形状不变。
- `~/.studywiki/` 成为所有未来用户级配置（主题、快捷键等）的固定 home；迁移逻辑只服务老版本一次，之后幂等空转。
- key 明文文件被整机拷走即泄露，与对标工具同水位；若未来上调安全水位，钥匙串方案可作为后续 note 重开。
- ASR endpoint 的 `kind: "asr"` 配置本期即可写入 settings.json 并探测，但无消费方，直到 m3-01。
