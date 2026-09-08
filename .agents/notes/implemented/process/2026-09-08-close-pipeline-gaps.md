# Agent Note: 弥合蓝本文档流水线差距（除站点投影）

Status: implemented

[English](2026-09-08-close-pipeline-gaps.en.md) | 中文

## Problem

对照蓝本十步流水线复盘（背景见 [2026-09-07-restore-docs-pipeline.md](2026-09-07-restore-docs-pipeline.md)），发现六处差距：门禁脚本自身零测试；三处注释引用不存在的归档门禁；导出注释无强制端（lib.rs 两条命令无 `///`，命令目录是裸签名）；本地 git 钩子为零；verify-md-links 声称外链归"发布投影"管辖但投影不存在；根目录无 CLAUDE.md symlink，agent 会话不自动装载常驻规则。站点投影（第 8 步）维持缓建。

## Decision

- 归档冻结门禁落地（verify-archived-agent-notes，doc-quick 叶）：archived/ 三件套整体冻结，每文件 sha256 记入 append-only manifest（与 git HEAD 对拍防删改）；`pnpm archive:note` 助手做移动、Status 改写、记 hash；冻结件退出配对/围栏编译/链接等活语料检查。
- 新门禁 verify-export-docs（doc-quick 叶）：src/ 顶层导出须带 JSDoc，函数须 `@param`/`@returns`（void 豁免）；`#[tauri::command]` 上方须紧邻 `///`。只钉"有"，内容质量归评审。lib.rs 两条命令补契约语义注释。
- 本地钩子刻意窄（蓝本同哲学）：pre-commit 只查暂存区尾随空白，pre-push 只跑 doc-quick；`pnpm install:hooks` 幂等安装。
- 门禁自测试：vitest 覆盖配对纯逻辑层、词数计数、封闭集合与 README 互检；CI 静态 lane 增 `pnpm test`。
- `CLAUDE.md` 作 `AGENTS.md` 的 symlink（蓝本同款），agent 会话自动装载常驻规则。
- verify-md-links 注释改为如实：外链不做机械检查，引入投影时收编。

## Alternatives considered

- fail-closed 占位（archived/ 出现内容即红）：实现最省，但机制无真实数据可验证；既然要写检查代码，直接落地完整冻结门禁，用一条真实归档件即可端到端验证（维护者拍板选完整实现）。
- 钩子跑 doc-sync 全量：本地反馈慢且与 CI 重复；窄钩子 + CI 穷尽是更优分工。
- 外链探活收编进 verify-md-links：无投影站时外链趋零，网络探活在 CI 里抖红；等投影落地一起做。
- 导出注释检查并进 gen-commands-catalog：生成器与契约门禁职责分离（蓝本 verify-export-jsdoc 与 gen-* 分立），合并会互相遮蔽。

## Consequences

- 写导出代码多了注释义务（契约语义，一行起步）；命令目录从此有内容。
- CI 多一个秒级 vitest 步骤；"改脚本须同步改 README"这类双宿主契约由测试背书。
- Windows clone 上 CLAUDE.md symlink 可能退化为纯文本（无害降级）。
- 归档成为正式流程：语义判断（是否归档）归人，机械部分全自动；改冻结件即解封，须 PR 显式说明。
- 站点投影仍缓建：外链检查、发布清单投影待其落地。
