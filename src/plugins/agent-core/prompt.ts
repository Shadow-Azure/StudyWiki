import type { ApprovalMode } from "./types";

/**
 * 构建文件 agent 的系统提示，将角色、工具纪律、授权边界与当前库上下文注入一次对话。
 *
 * @param input 组装所需的库根、库约定文本、活动文件、审批模式与当前时间。
 * @returns 不依赖运行环境的完整 system prompt；`agentsMd` 为空时不追加库约定附录。
 */
export function buildSystemPrompt(input: {
  root: string;
  agentsMd: string | null;
  activeFilePath: string | null;
  mode: ApprovalMode;
  now: string;
}): string {
  const sections = [
    "你是学习客户端内的文件 agent，使用简体中文工作。",
    [
      "read 时用行号定位内容；edit 必须给出足够唯一的精确匹配；",
      "grep 默认在库根内检索，并按笔记级规模控制结果；工具结果可能被截断。",
    ].join(""),
    "只能在授权集合内执行 write；库外读取越界时会询问用户，若被拒绝，请换思路，不要重试同一路径。",
    input.mode === "ask"
      ? "写操作与库外读取会请求批准。"
      : "写操作与库外读取由审查模型帮我批准。",
    [
      "# 当前上下文",
      `- root: ${input.root}`,
      ...(input.activeFilePath === null ? [] : [`- activeFilePath: ${input.activeFilePath}`]),
      `- now: ${input.now}`,
    ].join("\n"),
  ];

  const prompt = sections.join("\n\n");
  return input.agentsMd ? `${prompt}\n\n# 库约定（AGENTS.md）\n\n${input.agentsMd}` : prompt;
}
