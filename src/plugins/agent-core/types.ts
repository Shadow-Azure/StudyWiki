import type { ContentPart } from "../../host/llm";

/** 写操作批准模式：`ask` 先请求人批准，`auto` 由 guardian 规则代批。 */
export type ApprovalMode = "ask" | "auto";

/** 一次模型工具调用的稳定标识、工具名与未解析参数文本。 */
export interface AgentToolCall {
  /** Provider 返回的调用标识，供 tool 消息回指。 */
  id: string;
  /** 已注册工具名。 */
  name: string;
  /** 原样保留的 JSON 参数文本，解析由工具执行层负责。 */
  argumentsText: string;
}

/** 一次模型回复的 token 用量。 */
export interface TokenUsage {
  /** 输入上下文消耗。 */
  promptTokens: number;
  /** 模型输出消耗。 */
  completionTokens: number;
}

/** Agent 会话中的三种消息形态；用户内容可携带宿主多模态部件。 */
export type AgentMessage =
  | { role: "user"; content: string | ContentPart[] }
  | {
      role: "assistant";
      reasoning: string;
      text: string;
      toolCalls: AgentToolCall[];
      usage?: TokenUsage;
      finishReason?: string;
    }
  | {
      role: "tool";
      callId: string;
      name: string;
      content: string;
      isError?: boolean;
    };

/** JSONL 会话头；`v: 1` 是当前解析器接受的唯一格式版本。 */
export interface SessionHeader {
  /** 格式版本。 */
  v: 1;
  /** 会话稳定标识。 */
  id: string;
  /** 打开会话时的库根绝对路径。 */
  rootPath: string;
  /** 会话显示标题。 */
  title: string;
  /** 创建时间 ISO 字符串。 */
  createdAt: string;
}

/** 会话日志中的一行事件；header 之外均为只追加的过程记录。 */
export type SessionLine =
  | { type: "header"; header: SessionHeader }
  | { type: "message"; message: AgentMessage }
  | {
      type: "approval";
      id: string;
      /** 审批请求族，恢复历史决定卡时保留写/编辑/越界读语义。 */
      kind: "write" | "edit" | "read-outside";
      tool: string;
      path: string;
      decider: "human" | "guardian";
      decision: "allow" | "deny" | "unavailable";
      reason?: string;
    }
  | { type: "mode"; mode: ApprovalMode }
  | { type: "compaction"; summary: string; covered: number; createdAt: string };
