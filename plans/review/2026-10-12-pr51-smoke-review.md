# PR #51 后续客户端 smoke 检视

状态：已完成 | 记录日期：2026-10-12 | 关联分支：`codex/agent-ui-v2`、commit `38f2789` | [HTML 报告](../smoke-test/2026-10-12-pr54-review-smoke-report.html)

## 1. 结论速览

PR #54 的四个界面修改点 smoke 均已验证：宽态批准模式显示“请求批准 / 帮我批准”，窄态降级为图标浮窗；审批详情指向 `Agent 面板 ⋯ → 默认设置`；模型浮层优先消费 `Esc`，不会误拒 pending 审批；真实 MiniMax 请求、写入审批、批准落盘和拒绝收尾都成功。

本次 smoke 另外发现两个发布/交互问题：DMG 安装包可以直接生成，但从 DMG 复制后的 bundle 未通过 `codesign --verify`，Launch Services 的 `open` 也报可执行文件缺失；pending 审批接管 composer 后，状态行仍显示“可随时停止”，但界面上没有可点击的停止按钮。

## 2. 测试环境与过程

1. 从 commit `38f2789` 执行 `pnpm tauri build`；首次 `.app` 生成成功但 DMG 脚本在沙箱内失败，提权后重跑 `pnpm tauri build --bundles dmg`，产物为 `src-tauri/target/release/bundle/dmg/StudyWiki_0.1.0_aarch64.dmg`。
2. 将 DMG 挂载后把 `StudyWiki.app` 复制到 `/Applications/StudyWiki.app`，包内二进制包含本次前端产物哈希 `index-jFjIt5e2.js` 和 `index-B588RTxm.css`，说明测试的是当前 commit 的 release 资源。
3. 启动应用后打开 `/private/tmp/studywiki-pr-smoke` 一次性学习库，其中只有 `README.md`；测试过程中不读取、不修改用户学习库。
4. MiniMax 测试密钥先写入 `/private/tmp` 下 0600 临时环境文件，再由启动进程继承该环境；通过模型设置把密钥写入本机 endpoint 配置。截图和 accessibility 输出均避免展示明文密钥，测试结束后临时环境文件和工作区已删除。

## 3. PR #54 修改点验证

| 测试点 | 操作与证据 | 结果 |
|---|---|---|
| 宽态分段控件 | Agent 栏为 490px 时 accessibility 树出现“请求批准 / 帮我批准”，没有图标浮窗 | ✅ |
| 窄态图标浮窗 | Agent 栏降到 320px（composer 可用宽度小于阈值）后分段消失，出现“写操作批准模式”图标；打开浮窗仍有两个完整选项，切到“帮我批准”后图标语义同步为“帮我批准” | ✅ |
| 审批详情文案 | 真实请求写入 `smoke-note.md`，展开“查看详情”后文案包含 `Agent 面板 ⋯ → 默认设置`，且不再包含“模型设置”；diff 预览显示 `PR54 smoke` | ✅ |
| 浮层 Escape 所有权 | pending 审批期间打开模型配置，`Esc` 只关闭模型浮层；审批的“批准 / 拒绝”仍存在，历史中没有“已拒绝”记录 | ✅ |
| 真实 MiniMax 写入闭环 | MiniMax 返回 write 工具调用；用户批准后 UI 显示“已批准 write”，文件树出现 `smoke-note.md`，回合显示“已完成 1 个动作 33.0s” | ✅ |

补充验证：另起一条 `stop-note.md` 写入请求进入 pending；随后拒绝请求，UI 恢复 composer，历史写入“已拒绝 write”，回合正常完成，且磁盘上未生成 `stop-note.md`。

## 4. Smoke 发现的问题

### 4.1 pending 审批接管后“停止”不可达

发生场景循序渐进地说：①你让 Agent 写一个文件，composer 被红色审批台接管；②状态行仍写着“回合运行中 · 可随时停止”；③但 composer 下排只出现“查看详情 / 批准 / 拒绝”，原来的“发送/停止”座位消失；④如果模型已经发起一个错误目标，或你不想等审批决定，屏幕上没有可点的“停止”；⑤这就像门口贴着“紧急出口在此”，但门被审批台挡住了。该问题不否定 aborted 清理逻辑本身，而是用户在 pending 审批态缺少触发 stop 的入口。

建议修复：审批接管布局应保留一个明确的“停止”动作，可以放在审批台底部与“查看详情”同排；点击后走既有 `stopSession`/`aborted` 清理路径。若短期不改布局，至少不能在 pending 审批态显示“可随时停止”，避免文案承诺不存在的控件。

### 4.2 DMG 安装包通过标准 `open` 启动失败

`StudyWiki_0.1.0_aarch64.dmg` 可以生成并挂载，复制到 `/Applications` 后包含可执行文件和前端资源；直接执行 `/Applications/StudyWiki.app/Contents/MacOS/study-wiki` 能启动完整 UI。但 `codesign --verify --deep --strict /Applications/StudyWiki.app` 报“code has no resources but signature indicates they must be present”，`codesign -dv` 显示 `Sealed Resources=none`；`open -a /Applications/StudyWiki.app` 还报 `kLSNoExecutableErr: The executable is missing`。这与 Tauri 构建时“identifier ends with `.app`”的警告、bundle 缺少 sealed resources 一起，说明发布包的 macOS bundle 身份/签名链路不稳。

通俗地说：二进制能跑，但 macOS 的“门牌登记系统”有时不认这个 app 包；用户双击 DMG 里的 app 或让系统打开它时可能失败。建议后续做一个小 PR：把 bundle identifier 从 `dev.studywiki.app` 改成不以 `.app` 结尾的稳定 identifier，检查 Tauri macOS bundler 的签名产物，并在发布门禁里增加“挂载 DMG → 复制到临时 Applications → `codesign --verify` → Launch Services 可打开”的机械校验。若当前策略是无签名分发，也应先让标准 Finder/Launch Services 路径稳定，再显式豁免签名校验。

## 5. 自动化覆盖分析

| Smoke 测试点 | 现有覆盖 | 可否用 UT/集成覆盖 | 建议 |
|---|---|---|---|
| 6.4 详情文案 | `tests/app-agent-render.test.ts` 已断言包含 `Agent 面板 ⋯ → 默认设置` 且排除“模型设置” | 可以，且 UT 已足够 | 不需要真实 LLM e2e；文案漂移用纯 render 测试更稳定。 |
| 6.5 宽/窄自适应 | `tests/app-agent.test.ts` 用 `ResizeObserver` stub 分别注入 420px/240px，断言分段、图标、浮窗和 `aria` 状态 | 可以，现有集成测试覆盖状态机 | 若后续把阈值改为纯 CSS container query，应补浏览器渲染 e2e；当前 JS 阈值由 DOM 集成测试覆盖足够。 |
| Escape 所有权 | `tests/active-layer.test.ts` 覆盖栈顶所有权；`tests/app-agent.test.ts` 覆盖浮层打开时审批不响应、关闭后排队恢复 | 可以，现有集成测试是关键回归网 | 不应依赖真实 LLM；DOM 集成测试能更早、更确定地暴露竞争。 |
| aborted 清审批 UI | `tests/app-agent.test.ts` 已覆盖单审批和排队审批中断 | 可以，服务事件 + DOM 状态集成测试最合适 | 真实 stop 的端到端烟测仍值得保留，但不作为每次 CI 的必跑项。 |
| 真实 MiniMax 工具调用 | UT/mock 服务覆盖协议、guardian、审批与 UI；release app 未有自动真实供应商测试 | 不建议常态 UT/e2e 依赖真实供应商 | 保留手动 smoke；如需自动覆盖，用本地 OpenAI-compatible mock 服务验证“流式 → tool_calls → 审批 → 写盘”的集成链路。 |
| pending 审批时可停止 | 现有测试只证明收到 aborted 后 UI 清理，未证明 pending 审批 UI 中始终存在可触达 stop 控件 | 可以，需要新增 DOM 集成测试 | 补测试：进入 pending 审批 + running 后断言存在可用 stop 控件；点击后断言 aborted 清理。若产品决定不支持，则断言状态行不显示“可随时停止”。 |
| DMG/Launch Services | 现有门禁检查环境无关性和 native links，未验证 DMG 安装后的签名与 `open` | 可以，打包集成脚本覆盖 | CI macOS lane 增加 DMG 挂载、复制、`codesign --verify`、`open`/Launch Services 查询的 smoke；先修复 identifier/签名，再决定豁免策略。 |
