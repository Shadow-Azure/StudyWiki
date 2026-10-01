import { LlmError } from "./llm";

/** 流式 chunk（与 Rust llm_stream.rs 同形：serde tag + kebab 变体名）。 */
export type StreamChunk =
  | { type: "text-delta"; index: number; text: string }
  | { type: "reasoning-delta"; index: number; text: string }
  | { type: "tool-call-delta"; index: number; id: string; name?: string; argumentsDelta: string }
  | { type: "usage"; usage: { promptTokens: number; completionTokens: number } }
  | { type: "finish"; reason: string }
  | { type: "error"; code: string; message: string };

/** 组装中的 assistant 快照（消费者只读快照，不碰裸 delta）。 */
export interface PartialAssistant {
  reasoning: string;
  text: string;
  toolCalls: { index: number; id: string; name: string; argumentsText: string }[];
  usage?: { promptTokens: number; completionTokens: number };
  finishReason?: string;
  error?: { code: string; message: string };
}

/** chunk → 快照唯一组装点：index 关联交错块；error/usage/finish 落元数据。 */
export class StreamAssembler {
  #reasoning = "";
  #text = "";
  #tools = new Map<number, { index: number; id: string; name: string; argumentsText: string }>();
  #usage?: PartialAssistant["usage"];
  #finish?: string;
  #error?: PartialAssistant["error"];

  /** 喂一个 chunk；error chunk 只记录不抛。 */
  push(chunk: StreamChunk): void {
    switch (chunk.type) {
      case "text-delta":
        this.#text += chunk.text;
        break;
      case "reasoning-delta":
        this.#reasoning += chunk.text;
        break;
      case "tool-call-delta": {
        const tool = this.#tools.get(chunk.index) ?? {
          index: chunk.index,
          id: "",
          name: "",
          argumentsText: "",
        };
        if (chunk.id) tool.id = chunk.id;
        if (chunk.name) tool.name = chunk.name;
        tool.argumentsText += chunk.argumentsDelta;
        this.#tools.set(chunk.index, tool);
        break;
      }
      case "usage":
        this.#usage = chunk.usage;
        break;
      case "finish":
        this.#finish = chunk.reason;
        break;
      case "error":
        this.#error = { code: chunk.code, message: chunk.message };
        break;
    }
  }

  /** 当前快照（toolCalls 按 index 升序）。 */
  snapshot(): PartialAssistant {
    return {
      reasoning: this.#reasoning,
      text: this.#text,
      toolCalls: [...this.#tools.values()].sort((a, b) => a.index - b.index),
      ...(this.#usage ? { usage: this.#usage } : {}),
      ...(this.#finish ? { finishReason: this.#finish } : {}),
      ...(this.#error ? { error: this.#error } : {}),
    };
  }
}

/** FIFO 异步队列：close 正常终结；fail 使迭代与 settled 抛 LlmError。 */
export class ChunkQueue implements AsyncIterable<StreamChunk> {
  #buf: StreamChunk[] = [];
  #waiters: ((result: IteratorResult<StreamChunk>) => void)[] = [];
  #done = false;
  #failure: LlmError | null = null;

  /** 投递一个 chunk（终结后忽略）。 */
  push(chunk: StreamChunk): void {
    if (this.#done) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value: chunk, done: false });
    else this.#buf.push(chunk);
  }

  /** 正常终结。 */
  close(): void {
    this.#done = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  /** 失败终结：settled 与在途/后续迭代一并拒绝。 */
  fail(error: LlmError): void {
    this.#failure = error;
    this.close();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<StreamChunk> {
    while (true) {
      const chunk = this.#buf.shift();
      if (chunk !== undefined) {
        yield chunk;
      } else if (this.#done) {
        if (this.#failure) throw this.#failure;
        return;
      } else {
        const result = await new Promise<IteratorResult<StreamChunk>>((resolve) => {
          this.#waiters.push(resolve);
        });
        if (result.done) {
          if (this.#failure) throw this.#failure;
          return;
        }
        yield result.value;
      }
    }
  }
}

/** 在途流句柄：events 逐 chunk；settled 在传输或 error chunk 后拒绝。 */
export interface ChatStreamHandle {
  readonly events: AsyncIterable<StreamChunk>;
  readonly settled: Promise<void>;
  abort(): Promise<void>;
}
