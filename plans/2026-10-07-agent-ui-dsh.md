# StudyWiki Agent 面板交互优化方案（v2 定稿）

日期：2026-10-07
范围：`src/plugins/app-agent`（DOM 结构 + 样式 + 交互），不动 `agent-core` 数据面与 shell 三栏骨架。
交互预览：`plans/agent-ui-preview-v2.html`（第三栏为审批交互定稿：composer 接管 + 上方详情浮层）。

## 1. 现状问题（实际运行观测）

用 MiniMax `minimax-m2.7` 实测“读三篇笔记并写 summary.md”，得到以下问题：

1. **头部配置堆叠**：标题、会话 select、新建、请求批准/帮我批准、新会话默认模式下拉、模型下拉全部挤在面板头部两行，认知负担大；“当前会话模式”与“新会话默认模式”两个相似控件并列，语义难区分。
2. **过程噪声淹没结论**：`grep`、`read`、`write` 工具卡全部平铺在 transcript，用户需要滚动很长才能看到助手最终回答；卡片完成后仍保持大块高度。
3. **审批视觉弱、位置漂移**：审批卡出现在工具卡之后，待决策时不够醒目；决策完成后仍占据大片空间。
4. **模型选择信息弱**：只有裸 id 下拉，无厂商分组；且放在头部，切换成本高。
5. **附件按钮死区**：常驻禁用的 📎 按钮占位但无入口价值。
6. **错误条常驻**：`chat-notice` 无法关闭，也不区分致命/临时。
7. **会话管理薄弱**：只有一个 select，无法搜索、重命名、删除。
8. **空态体验**：未开库时右栏仍显示完整 composer，引导信息以错误样式呈现。

## 2. 参考交互提炼

### 2.1 dsh（~/2026/deepseek-harness）

- `ui-layout`：三栏 AppFrame + 可收起详情列；StudyWiki 已有右栏，本方案不动 shell，专注右栏内部信息架构。
- `ui-chat`：**回合级过程折叠**——过程行按相对顺序插入；回合完成后自动折叠，仅保留结论；手动展开记录在会话 scope。
- `ui-tool`：工具调用统一走注册表渲染；通用卡默认收敛。
- `ui-approval`：审批**接管 composer**，以醒目卡片收集决策；决策后回落为记录。
- `ui-model-selection`：模型选择放 **composer 的 model seat**，按 provider 分组。
- `ui-attachment`：附件 draft rail 放 composer 下方。
- `ui-sidebar`：新建会话、历史浏览、Settings 职责分离。

### 2.2 codex-main（~/2026/codex-main）

`tui/src/bottom_pane/approval_overlay.rs`：审批是底部 pane 的**动作选择视图**——动作特定选项 + 快捷键（批准/拒绝/Esc 取消）；只呈现选择并路由决策，不做安全判断。两个关键契约移植到 StudyWiki：

1. 选择永远发回显式决策事件（对应 `session.respond(request.id, outcome)`）。
2. Esc 永远映射为拒绝/取消，不会被自定义键位劫持成“继续执行”。

### 2.3 claude-code-sourcemap（~/2026/claude-code-sourcemap）

`permissions/PermissionPrompt.tsx` + `permissions/PermissionDialog.tsx`：

- PermissionPrompt 接管底部输入区：问题“是否继续？”+ 选项列表；Tab 可展开反馈输入。
- PermissionDialog 承载标题/副标题/diff 等详情，浮在输入提示上方。
- 移植点：**决策按钮在 composer 底部行**（与发送同一位置）；**详情浮层锚定在 composer 上方**；批准时可附带一句反馈（P2）。

**核心原则**：过程可查但默认不展开；未展开时只给结论；审批接管输入区而不是往 transcript 里塞大卡；控制项归属使用场景。

## 3. 目标信息架构

### 3.1 面板结构（自上而下）

```
┌────────────────────────────────────────┐
│ 会话标题 · 状态点      [＋] [历史] [⋯] │   ← 单行 header，无配置堆叠
├────────────────────────────────────────┤
│ 用户消息                                │
│ 助手 Markdown 回复                      │
│ ▸ 已分析 3 个文件 · 检索 1 次  1.1s    │   ← 过程摘要条，默认折叠
│ ▸ 已批准写入 summary.md · 用户         │   ← 决策记录行
│ 助手新回复（流式）                      │
├────────────────────────────────────────┤
│ [当前文件 chip…]                       │   ← 上下文 chips（可选）
│ ┌──────────────────────────────────┐   │
│ │ 普通态：textarea                   │   │
│ │ 审批态：⚠ 请求摘要 + 目标 + 规模    │   │   ← composer 被审批接管
│ │ [查看详情▾] [模型pill] [批准][拒绝] │   │
│ └──────────────────────────────────┘   │
│          ▲ 详情浮层（diff/路径/规则）    │   ← 弹在 composer 上方
└────────────────────────────────────────┘
```

### 3.2 交互规则

1. **回合折叠**
   - 回合开始创建 process group，工具调用按事件顺序插入，默认高度一条摘要行（28px 级）。
   - 运行中摘要显示当前动作 + spinner；`turn-end` 后自动折叠为“已完成 N 个动作 · 耗时 Xs”，点击展开时间线。
   - 手动展开状态记在会话 scope；新回合默认折叠；焦点在组内时不自动收起。
2. **审批接管 composer（v2 核心）**
   - 收到 approval：composer 从“输入态”切换为“审批态”，红色描边 + 警示 wash；transcript 不再插入大块审批卡。
   - 输入区显示一行摘要：`⚠ Agent 请求写入 1 个文件 / summary.md · 322 B · 批准后将继续执行`。
   - 底部行左侧“查看详情 ▾”toggle；右侧模型 pill 降权显示；最右“批准 ⌘⏎”（主按钮）+“拒绝 Esc”（ghost），与正常态“发送”同位置。
   - **详情浮层**弹在 composer 上方：目标绝对路径、变更统计（+N 行）、工具签名、diff 预览、规则说明（“本次批准仅此一次；默认模式在模型设置改”）。Esc/外点关闭，不遮挡 transcript 滚动。
   - 决策后原地降级为一行“已批准/已拒绝写入 … · 决策者：用户”，并恢复输入态；transcript 只留过程摘要与决策记录行。
   - 多个审批排队时一次显示一个，处理完自动切下一个；composer 正在输入时仍强制接管（决策优先级高于草稿，草稿保留在内存，决策后恢复）。
   - 快捷键：`⌘⏎` 批准、`Esc` 关浮层（浮层开时）/拒绝（浮层关时）。
3. **composer 座位（普通态）**
   - 左：附件（支持粘贴/拖拽；禁用态改为 hint 而非死区按钮）。
   - 中：模型 pill（按 provider 分组 + 能力标记）。
   - 右：审批模式分段（请求批准/帮我批准）+ 发送/停止。
   - 新会话默认模式移到 `⋯` 菜单或模型设置。
4. **会话历史**
   - header 历史按钮打开浮层：搜索、当前高亮、新建置顶、单条更多菜单（P3 加重命名/删除）。Esc/外点关闭。
5. **反馈分级**
   - 致命错误：composer 内联（阻止继续时）。
   - 临时错误：右下可关闭 toast，5s 自动消失。
   - 状态：composer 下缘状态行（模型、token、耗时）。

## 4. 视觉设计

- 复用现有 token：`--paper/--raise/--chrome/--hairline/--azurite/--cinnabar`，不引入 UI 框架。
- 过程摘要条：28px 高，hairline-soft 边框，chevron + 状态点 + 动作计数 + 耗时；展开为时间线（图标/工具名/目标/结果/耗时）。
- 审批态 composer：`--cinnabar` 描边 + wash；批准按钮红色主按钮，拒绝 ghost；决策后边框恢复，内部变一行记录。
- 详情浮层：`--raise` 底 + `--shadow`，头部红点 + 标题 + 关闭；主体为键值行 + mono 路径 + diff 块（`--code-bg`）。
- 用户气泡右侧 azurite-wash；助手回复全宽左对齐不套气泡。
- 附件 chips 移入 composer 上缘；错误 toast 右下角固定带 ×。

## 5. 实施切分

**P1（本 PR）**
- `app-agent/index.ts`：header 单行化 + 历史 popover + composer 状态机（normal/approval/decided）+ 模型 pill 菜单 + 错误 toast。
- `app-agent/render.ts`：`renderProcessGroup`（回合折叠）、决策记录行；移除 transcript 大审批卡路径。
- `styles.css`：上述全部样式。
- 行为保留：会话切换、模型设置、附件、流式渲染、审批 API 调用不变。

**P2**
- 流式状态行（token/耗时）；批准附反馈输入（Claude 风格 Tab 展开）；diff 完整渲染；审批快捷键细化。

**P3**
- 会话搜索/重命名/删除；历史分页。

## 6. 验证

- `pnpm test`
- `pnpm verify:layering`
- `pnpm route:gates`
- 手动场景：空库、无模型、流式中、待审批（浮层开关）、批准、拒绝、错误、历史切换、附件粘贴。

## 7. 参考索引

- dsh：`packages/client/ui-{layout,chat,tool,approval,model-selection,attachment,sidebar}/README.md`
- codex：`codex-rs/tui/src/bottom_pane/approval_overlay.rs`
- claude：`src/components/permissions/{PermissionPrompt,PermissionDialog}.tsx`
