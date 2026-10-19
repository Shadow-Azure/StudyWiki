# 内置 agent 契约

[English](agent.en.md) | 中文

> 类型：参考 | 另见 [contract.md](contract.md)、[../architecture.md](../architecture.md)。

## 服务面

`agent-core` 无 UI，注入三宿主面后发布 `ctx.agent`：列表、打开、删除、清理。会话含 `title`、`mode`、`model`、`running`、`rootMismatch`、`messages`/`lines`、`send`/`abort`/`setMode`/`setModel`/`respond` 与订阅。`app-agent` 只挂右栏；`inject` 声明依赖，不是权限。

## 工具契约

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `read` | `path`; `offset?`; `limit?` | 读授权 UTF-8；默认 2000 行、200 KB、行号前缀；二进制/视频/xlsx 拒收 |
| `grep` | `pattern`; `path?`; `glob?`; `ignoreCase?`; `literal?`; `context?`; `limit?` | ripgrep sidecar；path 默认根；默认 100 命中、20 MB/30 秒预算 |
| `write` | `path`; `content` | 新建/覆盖库根文本；审批后原子写并广播 |
| `edit` | `path`; `old_string`; `new_string`; `replace_all?` | 精确替换；零/多匹配未设替换报错；审批对照后原子写 |
| `transcribe` | `path`; `language?`; `model?` | 上传库根音视频到 kind=asr endpoint；一次审批覆盖上传落盘；产物 `.study-wiki/raw/<源去扩展名>/transcript.md`，时间戳段或 `timestamps: none` |

超限截断并标注。越界读/搜先审批，通过后登记所选文件/目录读 grant；库根外写改任何模式都失败。

`transcribe` 按回合挂载：仅当存在带模型的 kind=asr endpoint；中途删光 ASR 配置后下回合消失，历史调用报"未配置 ASR"。

## 审批两模式

审批模式持久化为 `agentApprovalMode`（缺省 ask）；会话内切换只写会话日志。审批覆盖授权内写改、越界读搜与转录上传；`transcribe` 单列一族，卡片明示文件、大小、endpoint 与模型、产物路径，上传绑定同一目标。`ask` 等人；`auto` 用会话模型独立无历史 guardian 审查，90 秒共享超时、最多 3 次；JSON 包裹可提取解析，解析失败与 408/429/5xx 在共享 deadline 内退避，有效拒绝不重试；到期 abort 底层请求并等取消传播，超时/最终失败拒绝。中止记悬挂项 `unavailable`，裁决与理由进日志。

## 会话格式

路径 `~/.study-wiki/sessions/<library-key>/<id>.jsonl`；`library-key` 由库根路径 sanitize 加稳定 hash 生成，首行 v1 header 带 `v`、`id`、`rootPath`、`title`、`createdAt`。旧库内会话在列出时迁移。后续每行一条完成事件，半截不落盘，崩溃尾丢弃：

| 行型 | 载荷 |
| --- | --- |
| `message` | user / assistant / tool 消息 |
| `approval` | 族、tool、path、decider、decision、reason |
| `mode` | `ask` / `auto` |
| `compaction` | 摘要、覆盖数、时间 |

日志保留全文，compaction 只改模型视图。usage 超 80000（可配置）时下回合换摘要。恢复只重放；root 不一致提示，悬空审批不复活。

## AGENTS.md 约定

system prompt 每回合现组：根 `AGENTS.md`、活动文件与模式句；笔记落点由库内 `AGENTS.md` 约定。
