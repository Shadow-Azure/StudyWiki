# Agent UI v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 v2 定稿重构 app-agent 面板：回合过程默认折叠、审批接管 composer（详情浮层在上方）、header 单行化 + 历史/模型浮层、错误 toast。

**Architecture:** 全部改动收敛在 `src/plugins/app-agent`（`render.ts` 提供纯 DOM 渲染单元，`index.ts` 持有状态机与事件接线）与 `src/styles.css`；不改 `agent-core` 服务接口与数据持久化。审批从“transcript 插卡”改为“composer 状态机”（normal → approval → decided → normal），工具事件写入回合过程组并在 turn-end 折叠。

**Tech Stack:** TypeScript + 无框架 DOM + Vite + Vitest(jsdom)；项目现有 token 化 CSS。

**Spec:** `plans/2026-10-07-agent-ui-dsh.md`

## Global Constraints

- 不引入 UI 框架；依赖零新增；禁 CDN/运行时加载。
- `src/plugins/` 禁 import `@tauri-apps/*`（verify:layering 机械校验）。
- TS 导出必须带文档注释。
- 非平凡变更挂 `.agents/flow/` issue；提交信息中文 + `(#N)`；同 PR 含 Agent Note。
- 改 `src/` 后跑 `pnpm gen:code-map`。

## Review Focus

1. **审批到达时用户正在输入**：草稿必须保留并在决策后恢复，不得清空。
2. **多个审批排队**：一次只显示一个，处理完自动切下一个，respond 的 request id 不错位。
3. **Esc 语义**：浮层开 → 只关浮层；浮层关 → 拒绝当前审批；普通态 → 不劫持输入。
4. **turn-end 折叠不吞焦点**：焦点在过程组内时不自动收起。
5. **历史会话渲染**：历史中的工具行同样进过程组，审批决策显示为一行记录而非大卡。

---

### Task 1: 过程组与决策行渲染单元

**Files:**
- Modify: `src/plugins/app-agent/render.ts`
- Test: `tests/app-agent-render.test.ts`

**Interfaces:**
- Produces:
  - `createProcessGroup(): { root: HTMLElement; body: HTMLElement; addStep(step: HTMLElement): void; settle(summary: string, durationMs: number): void; setRunning(text: string): void }`
  - `renderDecisionLine(kind: "allow"|"deny", label: string, decider: string): HTMLElement`

- [x] **Step 1: 写失败测试**（追加到 `app-agent-render.test.ts`）

```ts
describe("process group", () => {
  it("运行中显示当前动作，settle 后折叠并可展开", () => {
    const g = createProcessGroup();
    g.setRunning("正在读取 01.md");
    expect(g.root.className).toContain("agent-process");
    expect(g.root.textContent).toContain("正在读取 01.md");
    g.addStep(renderToolCard({ id: "c1", name: "read", argumentsText: "{}" }));
    g.settle("已读取 1 个文件", 1200);
    expect(g.root.classList.contains("open")).toBe(false);
    expect(g.root.textContent).toContain("已读取 1 个文件");
    expect(g.root.textContent).toContain("1.2s");
    g.root.querySelector<HTMLElement>(".agent-process-summary")!.click();
    expect(g.root.classList.contains("open")).toBe(true);
    expect(g.body.children.length).toBe(1);
  });

  it("决策行只读且带决策者", () => {
    const el = renderDecisionLine("allow", "已批准写入 summary.md", "用户");
    expect(el.className).toBe("agent-decision-line");
    expect(el.textContent).toContain("已批准写入 summary.md");
    expect(el.querySelector("button")).toBeNull();
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest tests/app-agent-render.test.ts`
Expected: FAIL（createProcessGroup 未定义）

- [x] **Step 3: 实现**（`render.ts` 新增，全部带文档注释）

```ts
/** One collapsible turn process group; steps stay in DOM but the body hides after settle. */
export function createProcessGroup(): ProcessGroup {
  const root = document.createElement("div");
  root.className = "agent-process";
  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "agent-process-summary";
  const chev = document.createElement("span");
  chev.className = "agent-process-chevron";
  chev.textContent = "▸";
  const state = document.createElement("span");
  state.className = "agent-process-state";
  state.textContent = "●";
  const text = document.createElement("span");
  text.className = "agent-process-text";
  const time = document.createElement("span");
  time.className = "agent-process-time";
  summary.append(chev, state, text, time);
  summary.addEventListener("click", () => root.classList.toggle("open"));
  const body = document.createElement("div");
  body.className = "agent-process-body";
  body.hidden = true;
  root.append(summary, body);
  return {
    root, body,
    addStep(step) { body.append(step); },
    setRunning(value) { text.textContent = value; root.classList.add("running"); },
    settle(label, ms) {
      text.textContent = label;
      time.textContent = `${(ms / 1000).toFixed(1)}s`;
      root.classList.remove("running");
      root.classList.add("done");
      if (!root.contains(document.activeElement)) root.classList.remove("open");
    },
  };
}

/** Compact one-line approval decision record used after the composer returns to normal. */
export function renderDecisionLine(decision: "allow" | "deny", label: string, decider: string): HTMLElement { /* … */ }
```

`root.classList.toggle("open")` 同步 `body.hidden`（用 class + CSS `display:none` 二选一，保持与项目现有 details 风格一致即可）。

- [x] **Step 4: 跑测试通过**

Run: `pnpm exec vitest tests/app-agent-render.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/plugins/app-agent/render.ts tests/app-agent-render.test.ts
git commit -m "agent-ui：回合过程组与决策行渲染单元 (#N)"
```

---

### Task 2: 事件流接入过程组

**Files:**
- Modify: `src/plugins/app-agent/index.ts`
- Test: `tests/app-agent.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `createProcessGroup`。
- Produces: panel 内部状态 `processGroup: ProcessGroup | null`；`tool-start/tool-end` 写入组，`turn-start` 建组，`turn-end` settle。

- [x] **Step 1: 写失败测试**

```ts
it("工具事件进过程组，turn-end 后默认折叠", async () => {
  const { ctx, el, sessionEvents } = fakeCtx([]);
  apply(ctx as never);
  await new Promise((r) => setTimeout(r, 0));
  sessionEvents.emit("e", { type: "turn-start" });
  sessionEvents.emit("e", { type: "tool-start", call: { id: "t1", name: "read", argumentsText: "{}" } });
  sessionEvents.emit("e", { type: "tool-end", call: { id: "t1", name: "read", argumentsText: "{}" }, content: "ok" });
  sessionEvents.emit("e", { type: "turn-end" });
  const group = el.querySelector<HTMLElement>(".agent-process")!;
  expect(group).not.toBeNull();
  expect(group.classList.contains("open")).toBe(false);
  expect(group.textContent).toContain("已完成");
});
```

- [x] **Step 2: 确认失败** — Run: `pnpm exec vitest tests/app-agent.test.ts`

- [x] **Step 3: 实现** — `handleEvent` 改为：
  - `turn-start`: `processGroup = createProcessGroup(); transcript.append(processGroup.root);`
  - `tool-start/tool-end`: `processGroup?.addStep(renderToolCard(...)); processGroup?.setRunning("正在" + 动作名);`
  - `turn-end`: `processGroup?.settle(\`已完成 ${count} 个动作\`, Date.now() - startedAt); processGroup = null;`
  - `renderHistory`: 连续 tool 行合并进一个组（遇 message/approval 断开），组 settle 为“已执行 N 个工具动作”。

- [x] **Step 4: 测试通过 + 既有测试全绿** — `pnpm exec vitest tests/app-agent.test.ts`

- [x] **Step 5: Commit** — `git commit -m "agent-ui：工具事件接入回合过程组 (#N)"`

---

### Task 3: 审批接管 composer + 详情浮层

**Files:**
- Modify: `src/plugins/app-agent/index.ts`, `src/plugins/app-agent/render.ts`
- Test: `tests/app-agent.test.ts`

**Interfaces:**
- Produces: `showApproval` 不再向 transcript append 卡，改为 `enterApprovalMode(request)`；composer DOM 结构 `.chat-composer[data-state="normal|approval|decided"]`。

- [x] **Step 1: 写失败测试**（覆盖 Review Focus 1–3）

```ts
it("审批接管 composer；详情浮层；批准后恢复草稿", async () => {
  const { ctx, el, calls, approvalEvents } = fakeCtx([]);
  apply(ctx as never);
  await new Promise((r) => setTimeout(r, 0));
  const input = el.querySelector<HTMLTextAreaElement>(".chat-input")!;
  input.value = "我的草稿";
  approvalEvents.emit("r", { id: "a1", kind: "write", tool: "write", path: "/lib/n.md", summary: "写", newText: "# 新" } as never);
  const composer = el.querySelector<HTMLElement>(".chat-composer")!;
  expect(composer.dataset.state).toBe("approval");
  expect(el.querySelector(".agent-approval-card")).toBeNull(); // transcript 无大卡
  el.querySelector<HTMLButtonElement>("[data-detail-toggle]")!.click();
  expect(el.querySelector<HTMLElement>(".agent-approval-detail")!.classList.contains("open")).toBe(true);
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); // 只关浮层
  expect(el.querySelector<HTMLElement>(".agent-approval-detail")!.classList.contains("open")).toBe(false);
  el.querySelector<HTMLButtonElement>("[data-approve]")!.click();
  expect(calls[0]).toEqual(["respond", "a1", { decision: "allow" }]);
  expect(composer.dataset.state).toBe("decided");
  expect(input.value).toBe("我的草稿"); // 草稿恢复
});

it("第二个审批排队，处理完自动显示", async () => { /* 同构 emit 两个 approval，断言一次只显示 id=a1，批准后 data-approval-id 变 a2 */ });
```

- [x] **Step 2: 确认失败**

- [x] **Step 3: 实现**
  - 状态：`pendingApprovals: ApprovalRequest[]`、`activeApproval`、`savedDraft: string`。
  - `enterApprovalMode(req)`: 保存 `input.value` → 清空 → composer `data-state="approval"` → 渲染摘要行 + `[data-detail-toggle]` + `[data-approve]`/`[data-deny]`；详情浮层 `.agent-approval-detail`（含 path/diff/规则说明）。
  - `respond` 后：插入 `renderDecisionLine` 到 transcript 当前过程组后，composer `data-state="decided"`，一拍后回 normal 并恢复草稿；`pendingApprovals.shift()` 到下一个。
  - 快捷键：全局 keydown——浮层开 Esc 只关浮层；approval 态 Esc=deny、⌘⏎=approve；normal 态不劫持。

- [x] **Step 4: 测试通过** — `pnpm exec vitest tests/app-agent.test.ts`

- [x] **Step 5: Commit** — `git commit -m "agent-ui：审批接管输入区并增加详情浮层 (#N)"`

---

### Task 4: header 单行化 + 历史/模型浮层 + composer 座位

**Files:**
- Modify: `src/plugins/app-agent/index.ts`
- Test: `tests/app-agent.test.ts`

- [x] **Step 1: 失败测试**

```ts
it("header 单行；历史浮层可搜索并切换会话", async () => {
  const { ctx, el, openCalls } = fakeCtx([{ id: "s2", title: "昨天的会话" }]);
  apply(ctx as never);
  await new Promise((r) => setTimeout(r, 0));
  expect(el.querySelectorAll(".agent-head-row > *").length).toBeLessThanOrEqual(5);
  el.querySelector<HTMLButtonElement>("[data-history-toggle]")!.click();
  const search = el.querySelector<HTMLInputElement>("[data-history-search]")!;
  search.value = "昨天";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  const items = el.querySelectorAll("[data-session-option]");
  expect(items.length).toBe(1);
  (items[0] as HTMLElement).click();
  expect(openCalls.at(-1)).toMatchObject({ id: "s2" });
});

it("模型 pill 菜单按厂商分组", async () => { /* fakeCtx 两组 models，断言菜单含两个 group 标题 */ });
```

- [x] **Step 2: 确认失败**

- [x] **Step 3: 实现**
  - header: 标题 + 状态点 + `[data-new-session]` + `[data-history-toggle]` + `[data-more]`；移除头部 session/model/default-mode 控件。
  - 历史 popover：搜索框 + 列表（当前高亮）+ 新建；外点/Esc 关。
  - 模型 pill（composer 内）+ 分组菜单；选择调 `setModel`。
  - 模式分段保留 composer；默认模式移入 `[data-more]` 菜单。
  - 附件按钮改 hint 样式（title 保持“粘贴或拖入”）。

- [x] **Step 4: 测试通过**

- [x] **Step 5: Commit** — `git commit -m "agent-ui：会话历史与模型选择浮层 (#N)"`

---

### Task 5: 错误 toast + 状态行 + 样式定稿

**Files:**
- Modify: `src/plugins/app-agent/index.ts`, `src/styles.css`
- Test: `tests/app-agent.test.ts`

- [x] **Step 1: 失败测试**

```ts
it("错误显示为可关闭 toast", async () => {
  const { ctx, el, sessionEvents } = fakeCtx([]);
  apply(ctx as never);
  await new Promise((r) => setTimeout(r, 0));
  sessionEvents.emit("e", { type: "error", message: "网络断了" });
  const toast = el.querySelector<HTMLElement>(".agent-toast")!;
  expect(toast.textContent).toContain("网络断了");
  toast.querySelector<HTMLButtonElement>("[data-toast-close]")!.click();
  expect(el.querySelector(".agent-toast")).toBeNull();
});
```

- [x] **Step 2: 确认失败**

- [x] **Step 3: 实现** — `appendError` 改 toast（关闭 × + 5s 自动移除，viem 中 `vi.useFakeTimers` 可测自动消失）；composer 下缘状态行（模型/运行态）；`styles.css` 增加 `.agent-process*`、`.chat-composer[data-state=approval]`、`.agent-approval-detail`、`.agent-history-pop`、`.agent-model-pop`、`.agent-toast`（全部用现有 token，视觉对齐 v2 预览）。

- [x] **Step 4: 测试通过 + 手动视检** — `pnpm tauri dev` 走一遍发送/审批。

- [x] **Step 5: Commit** — `git commit -m "agent-ui：错误 toast 与 v2 视觉定稿 (#N)"`

---

### Task 6: 流程件、文档与门禁

**Files:**
- Create: `.agents/flow/issues/<generated>.md`（`pnpm flow:new-issue -- agent-ui-v2`）
- Create: `.agents/notes/implemented/feature/2026-10-07-agent-ui-v2.md`
- Regenerate: `docs/architecture.md` code-map（`pnpm gen:code-map`）

- [x] **Step 1:** `pnpm flow:new-issue -- agent-ui-v2`，按骨架填目标/验收。
- [x] **Step 2:** 写 Agent Note（决策：dsh 回合折叠 + codex/claude 审批接管 composer；放弃项：transcript 大审批卡、头部配置堆叠）。
- [x] **Step 3:** `pnpm gen:code-map`。
- [x] **Step 4:** `pnpm test && pnpm verify:layering && pnpm route:gates`（按 route 输出补跑）。
- [x] **Step 5:** 中文提交含 `(#N)`，正文说明动机。

## Self-Review

- Spec 覆盖：回合折叠(T1/T2)、审批 composer+浮层+快捷键+排队+草稿(T3)、header/历史/模型(T4)、toast/状态行/视觉(T5)、流程件(T6) — 全覆盖。
- 无 TBD/占位；接口名（`createProcessGroup/renderDecisionLine/enterApprovalMode`）前后一致。
- Review Focus 五项均有对应测试步骤。
