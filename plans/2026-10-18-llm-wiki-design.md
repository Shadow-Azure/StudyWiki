# llm-wiki 知识层（m2-04 / #31）设计

日期：2026-10-18 · 状态：待评审 · 分支：`codex/m2-04-llm-wiki-design`

## 背景与场景

llm-wiki 是构建在 agent（m2-03 已完成：cordis 双插件、四工具、审批门、JSONL 会话）上的**编译式知识层**，方法论来源是 Karpathy 的 llm-wiki（raw 不可变 + LLM 维护的 wiki + schema 契约，ingest/query/lint 三操作），对标「知识编译」替代 RAG：连接工作在摄入时做一次并沉淀，对话时直达已编译结果。

主使用场景（设计锚点）：

1. 用户打开一个源（markdown 文件 / 视频）。
2. 首次调用 AI 分析，沉淀到 llm-wiki（文本源 m2 闭环；视频源 m2 识别状态并提示「需要先分析」，转录能力 m3 接入）。
3. 观看/阅读中与 AI 对话，问题**时间戳感知**：「当前这段在讲什么」= 当前播放时间戳 → 主题↔时间戳对照 → 定位已编译内容区段 → 取上下文作答，不重新处理源。
4. 源变更/移动被识别：变更 → 标过期提示重分析；移动 → 重映射产物，不重分析。

## 目标与验收

- `.study-wiki/llm-wiki/` 固定路径 + 机器索引 `.study-wiki/index.yaml`（源 → 产物映射 + md5 + 时间戳 + 状态）。
- ingest 更新 index 与相关页并追加 log；query 先读 index；lint 查矛盾/孤儿/缺口。
- 源状态机（未分析/已分析/过期/已移动）由宿主确定性判定，agent 据注入上下文提示用户「需要先分析」。
- m2 范围：文本源闭环；视频全契约预留（raw/ 布局、topics.md 主题-时间戳对照、m3 填充路径明确），零返工。

## 总体架构：schema 归插件

新增**内置插件 `src/plugins/app-wiki/`**（纯服务、无 UI），`inject: ['agent', 'files', 'workspace']`，提供 `ctx.wiki` 服务。三个关键决策：

1. **schema（行为契约）归插件所有**，不在库内放 `.study-wiki/llm-wiki/AGENTS.md`。schema 以插件内常量文本存在，随应用版本发布——环境无关性硬约束要求「同版本 + 同插件集行为一致」，库内 schema 副本会漂移。库内只物化 wiki **产物**（index/log/overview/sources/concepts/entities），不复制契约。用户与 LLM 共同演进 schema 的定制通道记欠账（未来可加库级 override 合并）。
2. **agent-core 增 prompt 贡献缝**：`AgentService` 增 `registerPromptSection(id, provider)`，provider 每回合异步返回字符串或 null；`buildSystemPrompt` 输入增 `extraSections`，loop 组装时按注册序拼接在库约定（AGENTS.md）之后。app-wiki 注册「wiki 段」。这是对 m2-03「agent 侧零改动」约定的唯一修订——动的不是工具与 loop 语义，而是 system prompt 组装点，m2-03 落地记录中「wiki index 留给 m2-04」即指此缝。
3. **ingest/query/lint 保持对话驱动**：用户 natural language 发起，agent 用现有 read/grep/write/edit 四工具执行 wiki 维护（m2-03 通用工具面哲学不变）。wiki 插件不做新工具、不接管 loop。程序性写（骨架初始化、移动重映射）经 files 服务直接落盘，属宿主行为，不走 agent 审批。

## 存储契约

```
<库根>/
└── .study-wiki/
    ├── index.yaml               # 机器索引（纯 yaml）：真值，确定性维护，程序独占读写
    ├── raw/                     # 派生产物层（m3 起填充；m2 仅建目录）
    │   └── <源相对路径去扩展名>/
    │       ├── transcript.md        # 带时间戳转录（m3-01）
    │       ├── topics.md            # 主题 ↔ 时间戳区间对照（★ 时间戳直达）
    │       ├── assets/              # 关键帧/配图（m3-02）
    │       └── AI-chat-note.md      # 对话沉淀（m4-02）
    └── llm-wiki/                # wiki 层（LLM 全权维护；Obsidian 可直接开）
        ├── index.md  log.md  overview.md
        ├── sources/   # 每源一页：摘要 + 主题-时间戳索引 + [[wikilink]]
        ├── concepts/  entities/
        └── AGENTS.md  ← 不建（schema 在插件内）
```

- **raw/ 存在 ⇔ 源产生派生物**。文本源（md）产物即源本身，不落 raw；视频源的 transcript/topics 由 m3 填充，m2 遇到视频源时 raw/ 下无产物即「未分析」的物证。
- **机器索引 `.study-wiki/index.yaml`**（纯数据文件，非文档；m2-04 先落最小契约，m3-03 落地记录中「映射 + md5 + 时间戳」与本契约合并，m3-03 后续聚焦 raw/ 产物填充与字段扩展）。**解析不引 yaml 依赖**：索引由本插件独占读写，采用受限子集（顶层 `version` + `sources` 列表的扁平标量字段）手写解析器；读取校验失败视为损坏，从产物重新派生重建：

```yaml
# study-wiki index
version: 1
sources:
  - path: "courses/rust/ownership.md"   # 库相对路径
    kind: text                          # text | video | ...
    md5: "…"
    size: 12345
    analyzed_at: "2026-10-18T12:00:00+08:00"
    status: fresh                       # fresh | stale
    artifact: null                      # raw/<源>/ 相对路径；文本源为 null
```

- **wiki 页 frontmatter 契约**（schema 强制）：`title / type(source|concept|entity) / source（库相对路径，source 页必填）/ created / updated / confidence(high|medium|low) / related`。`[[wikilink]]` 交叉引用；`log.md` 只追加。
- **sources 页必含「主题 ↔ 时间戳/位置对照」节**：文本源用标题锚点 + 行号区间，视频源用时间戳区间（数据来自 m3 的 topics.md）。这是 m4-01 时间戳问答与「当前片段主题」的地基。

## 源状态机与探测命令

状态：`unknown`（索引无记录或 raw 无产物）→ `fresh` → 源变更（md5 不一致）→ `stale`；路径消失且 md5 在别路径命中 → `moved`。

- **Rust 新命令 `probe_source_file(path)`**（m2-04 落地）：流式计算 md5，返回 `{ size, mtimeMs, md5 }`；库外路径拒绝（错误词表沿用授权语义）。新增 pinned `md5` crate（构建期打包、零运行时下载，登记 dep-allowlist；`std::hash::DefaultHasher` 不保证跨版本稳定，不可用）。
- **机器索引的物化规则：索引行不是人工/agent 写入的，而是 wiki 服务探测时的**派生物**——产物存在（`raw/<源>/` 有内容 ∨ `llm-wiki/sources/<源>.md` 存在）即补写或刷新该行（`analyzed_at` 取产物最新 mtime）；产物不存在即 `unknown`，索引无行。这保证 ingest 流程只维护 wiki 产物，登记永不漏配。

判定逻辑在 TS**（`app-wiki` 纯函数）：解析机器索引、比对 probe 结果、给出状态与建议动作。TS 侧按 `path + mtimeMs + size` 缓存 md5，活动文件未变更时不重复哈希——视频大文件每回合重哈希不可接受。
- **moved 处理**：重命名 raw/ 产物目录 + 改写索引行，不重分析（程序行为，无审批）。
- 状态经 wiki 段注入：activeFile 为 `unknown/stale` 时 agent 明确提示「需要先分析」（文本源可直接发起 ingest；视频源说明转录能力后续里程碑提供）；`fresh` 时注入 wiki 侧摘要指针（llm-wiki/index.md 头部有界截断——前 80 行或 4 KiB 取小——+ sources 页路径）。

## app-wiki 插件模块

- `schema.ts`：schema 常量文本（见下节）+ 版本号。
- `state.ts`：机器索引解析、probe 缓存、状态机纯函数（vitest 主战场）。
- `service.ts`：`ctx.wiki` 服务——`sourceState(path)`、`wikiContextSection()`（prompt provider 实现：状态行 + index 头部 + schema 全文，均有界）、骨架初始化（`.study-wiki/{raw,llm-wiki/{sources,concepts,entities}}` + index/log/overview 初始页 + 机器索引建文件）。
- `index.ts`：cordis 插件入口；注册 prompt 贡献；监听 `workspace.events` 的 `file-opened`/`root-changed` 失效 probe 缓存。
- 分层纪律：禁 `@tauri-apps/*`，只经宿主 files 服务触盘；无新 npm 依赖。

## schema 内容要点（插件内，注入有界 ≤ 约 2k tokens）

1. 角色：wiki 维护者；「你读它，LLM 写它」；用户可读库内全部 wiki 产物。
2. 结构约定：上节存储契约 + frontmatter 模板 + `[[wikilink]]` + log 只追加。
3. **ingest 流程**（对文本源）：读源 → 与用户确认要点（可选）→ 建/更新 sources 页（含主题对照）→ 更新 concepts/entities 相关页 → 更新 llm-wiki/index.md → log.md 追加。机器索引**无需 agent 登记**：索引是派生物——wiki 服务探测时发现产物存在而索引缺行/失配时自动补写（程序行为，见「源状态机」节）。
4. **query 流程**：先读 llm-wiki/index.md 定位相关页 → 读页（时间戳问题先查主题对照节）→ 作答带 [[wikilink]] 引用 → 有价值的结论主动提议归档。
5. **lint 流程**：查页面间矛盾、孤儿页（无入链）、被多次提及却无独立页的概念、被新来源取代的过时结论、与机器索引不一致的登记项；建议下一步。
6. 视频预留：遇到视频源只报告状态，不伪造 transcript/topics；m3 起 raw/ 产物存在时按同一 ingest 流程编纂。

## 审批模型与欠账

- 写审批沿用 m2-03：wiki 产物在库根授权集内，ask 模式逐写审批卡，auto 模式 guardian 批。**欠账**：ingest 批量写入汇总审批卡（agent-core 审批增强）。
- **lint v1 全 LLM** 依 schema 执行；机械 lint（孤儿/死链/索引不一致确定性检查）记欠账。
- schema 库级定制通道（override 合并）记欠账。
- 向量检索不做：环境无关性约束 + 中文场景 grep 优先的混合检索实践（字面匹配对领域术语更稳），现有 grep/read 已够 m2 规模。

## 测试与门禁

- vitest（假 ctx）：状态机纯函数（unknown/fresh/stale/moved 全迁移）、md5 缓存命中/失效、wikiContextSection 有界截断与状态注入句、骨架初始化幂等、prompt 贡献缝注册与拼接序。
- cargo：`probe_source_file` 流式 md5 正确性、库外路径拒绝、大文件（> 缓存块）一致性；TS 侧钉 pinned md5 crate 版本。
- 机械面：commands.md / code-map 生成区重建；`verify:layering`、`verify:env-independence`（新 crate 登记）、`verify:dep-audit`、`verify:flow`；doc-budgets 登记新常驻文档；issue #31 三件套与 Agent Note（`proposed → implemented`）同 PR。

## Alternatives considered

- **机器索引用 markdown + yaml 围栏**（m3-03 原文）：索引是程序专属的派生缓存，文档包装无收益且易被误编辑；改纯数据文件。`index.json` 与 `index.yaml` 二选一，拍板 yaml（与 #34 原文表述距离更小、人读更友好），解析用手写受限子集 + 损坏重建，不引依赖。

- **schema 放库内文件**（Karpathy 原版 / 上轮方案）：库副本随使用漂移，且环境无关性要求同版本行为一致；用户拍板归插件，否。
- **专用 wiki 工具（wiki_ingest/query/lint 参数化）**：ingest 的开放性写作难参数化，推翻 m2-03 通用工具面共识；否。
- **独立 wiki 插件 + 任务队列 + 向量索引**（nashsu 工程化路线）：过度工程，向量索引撞环境无关硬约束；否。
- **程序性骨架初始化走 agent 审批**：初始化是宿主行为非模型决策，审批无意义且拖慢首用；否。
- **DefaultHasher 代 md5 crate**：跨版本不稳定，破坏索引持久化；否。

## 影响

- m2-02 落地记录「wiki index 留给 m2-04」在本 issue 闭合（prompt 贡献缝 + wikiContextSection）。
- m3-03（raw 落盘与索引）与本契约合并：机器索引 m2-04 先落（`.study-wiki/index.md` 更名 `.study-wiki/index.yaml`，issue #34 验收文案同 PR 微调），m3-03 聚焦 raw/ 产物与字段扩展。
- m4-01（时间戳问答）/ m4-02（chat-note 回填）消费本契约：topics.md 主题对照、sources 页 frontmatter、log.md。
- issue #31 scope 预计扩 `src-tauri/**`（probe 命令）、`package.json`/`pnpm-lock.yaml`（md5 crate 不涉前端）、`scripts/dep-allowlist.json`、commands/code-map 生成区等，实施时更新三件套。
