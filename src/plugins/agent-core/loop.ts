import type { ChatMessage, ToolDeclaration } from "../../host/llm";
import type { ChatStreamHandle, PartialAssistant } from "../../host/llm-stream";
import type { AgentMessage, AgentToolCall, SessionLine } from "./types";

/** 回合过程中对调用方暴露的增量事件；快照与落账消息分离传递。 */
export type AgentEvent =
  | { type: "turn-start" }
  | { type: "snapshot"; snapshot: PartialAssistant }
  | { type: "tool-start"; call: AgentToolCall }
  | { type: "tool-end"; call: AgentToolCall; content: string; isError: boolean }
  | { type: "message"; message: AgentMessage }
  | { type: "turn-end" }
  | { type: "aborted" }
  | { type: "error"; message: string };

/** 回合状态机的注入缝：推理流、工具执行、系统提示与持久化都由宿主装配。 */
export interface LoopDeps {
  /** 发起一次流式模型请求；模型路由与工具能力门禁归 LLM 宿主服务。 */
  chatStream: (req: {
    model?: string;
    messages: ChatMessage[];
    tools?: ToolDeclaration[];
  }) => Promise<ChatStreamHandle>;
  /** 执行单个模型工具调用；抛错会转为错误工具结果回灌。 */
  runTool: (call: AgentToolCall) => Promise<{ content: string; isError?: boolean }>;
  /** 每回合现组的系统提示；只进入模型 wire，不进入历史或会话日志。 */
  systemPrompt: () => string;
  /** 本回合暴露给模型的工具声明。 */
  tools: ToolDeclaration[];
  /** LLM 服务使用的模型路由键。 */
  model?: string;
  /** 只追加落账；user 由调用方先落，本状态机只负责 assistant/tool。 */
  persist: (line: SessionLine) => void;
  /** UI 与流程事件出口；实现方自行节流与清理。 */
  emit: (e: AgentEvent) => void;
}

type ToolResult = Awaited<ReturnType<LoopDeps["runTool"]>>;

/** Agent 历史转模型 wire 形状；reasoning/usage/finishReason 是本地元数据不回传。
 * @param history Ordered, read-only conversation history.
 * @returns New wire messages without mutating or including local metadata.
 */
export function toChatMessages(history: AgentMessage[]): ChatMessage[] {
  return history.map((message): ChatMessage => {
    if (message.role === "assistant") {
      return {
        role: message.role,
        content: message.text,
        // Internal calls keep the raw-text name `argumentsText`; the Chat
        // Completions wire contract names the same value `arguments`.
        toolCalls: message.toolCalls.map(({ id, name, argumentsText }) => ({
          id,
          name,
          arguments: argumentsText,
        })),
      };
    }
    if (message.role === "tool") {
      return {
        role: "tool",
        content: message.content,
        toolCallId: message.callId,
      };
    }
    return { role: message.role, content: message.content };
  });
}

/** 运行一个完整 agent 回合；无迭代上限，直到自然回答、中止或流错误。
 * @param history Existing conversation history; the caller has already persisted user input.
 * @param deps Injected chat, tool, prompt, persistence, and event seams.
 * @param signal Cooperative abort signal checked around chat and tool boundaries.
 * @returns Only messages newly persisted by this turn; half snapshots are never included.
 */
export async function runTurn(
  history: AgentMessage[],
  deps: LoopDeps,
  signal: AbortSignal,
): Promise<AgentMessage[]> {
  const appended: AgentMessage[] = [];
  let completedAssistant: AgentMessage | undefined;
  deps.emit({ type: "turn-start" });

  const stop = (): AgentMessage[] => {
    if (completedAssistant?.role === "assistant") {
      const completedCalls = new Set(
        appended
          .filter((message): message is Extract<AgentMessage, { role: "tool" }> => message.role === "tool")
          .map((message) => message.callId),
      );
      for (const call of completedAssistant.toolCalls) {
        if (completedCalls.has(call.id)) continue;
        const tool: AgentMessage = {
          role: "tool",
          callId: call.id,
          name: call.name,
          content: "已取消",
          isError: true,
        };
        deps.persist({ type: "message", message: tool });
        appended.push(tool);
      }
    }
    deps.emit({ type: "aborted" });
    return appended;
  };
  const fail = (e: unknown): AgentMessage[] => {
    deps.emit({ type: "error", message: errorMessage(e) });
    return appended;
  };

  for (;;) {
    if (signal.aborted) return stop();

    let handle: ChatStreamHandle;
    try {
      handle = await deps.chatStream({
        model: deps.model,
        messages: [
          { role: "system", content: deps.systemPrompt() },
          ...toChatMessages([...history, ...appended]),
        ],
        tools: deps.tools,
      });
    } catch (e) {
      return fail(e);
    }
    let snapshot: PartialAssistant;
    let cancelRequested = false;
    const cancel = async (): Promise<void> => {
      if (cancelRequested) return;
      cancelRequested = true;
      try {
        await handle.abort();
      } catch {
        // Abort delivery is best-effort; the loop still ends as aborted.
      }
    };
    if (signal.aborted) {
      await cancel();
      return stop();
    }
    const onAbort = () => void cancel();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      for await (const _chunk of handle.events) {
        snapshot = handle.snapshot();
        deps.emit({ type: "snapshot", snapshot });
        if (signal.aborted) {
          await cancel();
          return stop();
        }
      }
      if (signal.aborted) {
        await cancel();
        return stop();
      }
      await handle.settled;
      snapshot = handle.snapshot();
      if (signal.aborted || cancelRequested) return stop();
    } catch (e) {
      return fail(e);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }

    if (!snapshot.finishReason) return stop();
    const assistant: AgentMessage = {
      role: "assistant",
      reasoning: snapshot.reasoning,
      text: snapshot.text,
      toolCalls: snapshot.toolCalls.map(({ id, name, argumentsText }) => ({
        id,
        name,
        argumentsText,
      })),
      usage: snapshot.usage,
      finishReason: snapshot.finishReason,
    };
    completedAssistant = assistant;
    deps.persist({ type: "message", message: assistant });
    appended.push(assistant);
    deps.emit({ type: "message", message: assistant });

    if (assistant.toolCalls.length === 0) {
      deps.emit({ type: "turn-end" });
      return appended;
    }

    for (const call of assistant.toolCalls) {
      if (signal.aborted) return stop();
      deps.emit({ type: "tool-start", call });
      let result: ToolResult;
      try {
        result = await deps.runTool(call);
      } catch (e) {
        result = { content: String(e), isError: true };
      }
      const tool: AgentMessage = {
        role: "tool",
        callId: call.id,
        name: call.name,
        content: result.content,
        isError: result.isError === true ? true : undefined,
      };
      deps.persist({ type: "message", message: tool });
      appended.push(tool);
      deps.emit({
        type: "tool-end",
        call,
        content: tool.content,
        isError: tool.isError === true,
      });
      deps.emit({ type: "message", message: tool });
    }
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return JSON.stringify(e);
}
