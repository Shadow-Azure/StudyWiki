# 内置 agent 契约

[English](agent.en.md) | 中文

> 类型：参考 | 另见 [contract.md](contract.md)、[../architecture.md](../architecture.md)。

## 服务面

`agent-core` 无 UI，注入三宿主面后发布 `ctx.agent`：列表、打开、删除、清理。会话含 `title`、`mode`、`model`、`running`、`rootMismatch`、`messages`/`lines`、`send`/`abort`/`setMode`/`setModel`/`respond` 与订阅。`app-agent` 只挂右栏；外置 guard 不暴露 `agent`。

## 工具契约

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `read` | `path`; `offset?`; `limit?` | 读授权 UTF-8；默认 2000 行、200 KB、行号前缀；二进制/视频/xlsx 拒收 |
| `grep` | `pattern`; `path?`; `glob?`; `ignoreCase?`; `literal?`; `context?`; `limit?` | ripgrep sidecar；path 默认根；默认 100 命中、20 MB/30 秒预算 |
| `write` | `path`; `content` | 新建/覆盖库根文本；审批后原子写并广播 |
| `edit` | `path`; `old_string`; `new_string`; `replace_all?` | 精确替换；零/多匹配未设替换报错；审批对照后原子写 |

超限截断并标注。越界读/搜先审批，通过后登记所选文件/目录读 grant；库根外写改任何模式都失败。

## 审批两模式

新会话默认审批模式持久化在 settings 的 `agentApprovalMode`（缺省 ask）。会话内切换只写当前会话日志，不回写默认。审批覆盖授权内写改和越界读搜。`ask` 等人操作；`auto` 用会话模型做独立无历史 guardian 审查，30 秒共享超时；JSON 包在推理/说明文本中可提取解析，解析失败与 408/429/5xx 瞬态错误指数退避重试两次，有效拒绝不重试，最终失败拒绝。中止记悬挂项 `unavailable`，裁决与理由进日志。

## 会话格式

路径 `~/.study-wiki/sessions/<library-key>/<id>.jsonl`；`library-key` 由库根路径 sanitize 加稳定 hash 生成，首行 v1 header 带 `v`、`id`、`rootPath`、`title`、`createdAt`。旧库内会话在列出时迁移。后续每行一条完成事件，半截不落盘，崩溃尾丢弃；首行 v1 header 带 `v`、`id`、`rootPath`、`title`、`createdAt`。后续每行一条完成事件，半截不落盘，崩溃尾丢弃：

| 行型 | 载荷 |
| --- | --- |
| `message` | user / assistant / tool 消息 |
| `approval` | 族、tool、path、decider、decision、reason |
| `mode` | `ask` / `auto` |
| `compaction` | 摘要、覆盖数、时间 |

日志保留全文，compaction 只改模型视图。usage 超 80000（可配置）时下回合换摘要。恢复只重放；root 不一致提示，悬空审批不复活。

## AGENTS.md 约定

system prompt 每回合现组，注入根 `AGENTS.md`、活动文件与模式句。不预设笔记落点；m2-04 用库内 `AGENTS.md` 约束行为。
