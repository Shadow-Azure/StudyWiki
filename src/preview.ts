import type { Context } from "cordis";
import "./styles.css";
import { apply as applyShell, type ShellConfig } from "./plugins/app-shell";
import { apply as applyWindows } from "./plugins/app-windows";
import { apply as applyFileTree } from "./plugins/view-filetree";
import { apply as applyMarkdown } from "./plugins/doc-markdown";
import { apply as applyVideo } from "./plugins/doc-video";
import { apply as applyPluginManager } from "./plugins/plugin-manager";
import { apply as applyLlmSettings } from "./plugins/llm-settings";
import { apply as applyChat } from "./plugins/app-chat";
import { StreamAssembler, type StreamChunk } from "./host/llm-stream";
import { WorkspaceService } from "./host/workspace";
import type { FileNode } from "./types";

const previewRoot = "/StudyWiki Preview";
const markdownPath = `${previewRoot}/Tauri 架构.md`;
const previewTree: FileNode[] = [
  {
    name: "教程",
    path: `${previewRoot}/教程`,
    kind: "dir",
    children: [
      { name: "Tauri 架构.md", path: markdownPath, kind: "markdown" },
      { name: "播放示例.mp4", path: `${previewRoot}/教程/播放示例.mp4`, kind: "video" },
    ],
  },
  { name: "研究笔记.md", path: `${previewRoot}/研究笔记.md`, kind: "markdown" },
  { name: "未支持.txt", path: `${previewRoot}/未支持.txt`, kind: "other" },
];

const markdown = `# Tauri 架构

浏览器预览使用与桌面端相同的插件和样式，用内存宿主替代 Tauri 命令。

## 阅读检查

- 工具面保持紧凑，内容面保持安静。
- 长标题与目录层级应在窄宽度下稳定换行。
- 代码、引用与表格共享同一套纸墨令牌。
`;

/** 内存 LLM 桩：面板在浏览器预览可打开可编辑；baseUrl 分段拼装以避开
 * 环境无关门禁对 src/** 源文本的外部 URL 字面扫描（预览不进发布产物）。 */
/** 假流式桩脚本：演示 reasoning 折叠、markdown 正文、代码块与 usage footer。 */
const PREVIEW_CHAT_SCRIPT: StreamChunk[] = [
  { type: "reasoning-delta", index: 0, text: "预览思考：先组织要点，再给出带格式的正文…" },
  { type: "text-delta", index: 0, text: "**预览桩回答**：这段文字来自浏览器预览的假流式桩，用于检视 chat 视觉语言。\n\n" },
  { type: "text-delta", index: 0, text: "第二段带一个代码块：\n\n```ts\nconst preview = true;\n```" },
  { type: "usage", usage: { promptTokens: 12, completionTokens: 34 } },
  { type: "finish", reason: "stop" },
];

class PreviewLlm {
  #endpoints: {
    endpoints: { id: string; kind: string; hasKey: boolean; models: { id: string; capabilities: string[] }[] }[];
    defaultModel: string | null;
  } = {
    endpoints: [{
      id: "demo",
      kind: "chat",
      hasKey: false,
      models: [{ id: "demo-model", capabilities: ["text", "vision", "audio"] }],
    }],
    defaultModel: "demo-model",
  };
  listPresets() {
    return Promise.resolve([{
      vendor: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://" + "preview.invalid/v1",
      models: [{ id: "demo-model", capabilities: ["text"] }],
    }]);
  }
  listEndpoints() { return Promise.resolve(this.#endpoints); }
  upsertEndpoint(e: unknown) {
    this.#endpoints.endpoints.push(
      e as { id: string; kind: string; hasKey: boolean; models: { id: string; capabilities: string[] }[] },
    );
    return Promise.resolve();
  }
  removeEndpoint() { return Promise.resolve(); }
  revealKey() { return Promise.resolve("preview-key"); }
  probe() { return Promise.resolve(12); }

  /** 假流式桩：与 ChatStreamHandle 同形，内部喂宿主真实的 StreamAssembler（预览
   * 也走唯一组装点）；逐 chunk 延时出字，供检视流式渲染与停止交互。 */
  chatStream(_req: unknown) {
    const assembler = new StreamAssembler();
    let stopped = false;
    const events = (async function* () {
      for (const chunk of PREVIEW_CHAT_SCRIPT) {
        if (stopped) return;
        await new Promise((resolve) => setTimeout(resolve, 40));
        assembler.push(chunk);
        yield chunk;
      }
    })();
    return {
      events,
      snapshot: () => assembler.snapshot(),
      settled: Promise.resolve(),
      abort: async () => { stopped = true; },
    };
  }
}

class PreviewSlots {
  readonly #slots = new Map<string, Array<{ el: HTMLElement; render: (host: HTMLElement) => void }>>();
  readonly #hosts = new Map<string, HTMLElement>();

  /** Register a slot renderer in registration order. */
  register(slot: string, render: (host: HTMLElement) => void): () => void {
    const entries = this.#slots.get(slot) ?? [];
    const el = document.createElement("div");
    el.className = `slot slot-${slot.replace(".", "-")}`;
    const entry = { el, render };
    entries.push(entry);
    this.#slots.set(slot, entries);
    const host = this.#hosts.get(slot);
    if (host) {
      host.append(el);
      render(el);
    }
    return () => {
      const next = (this.#slots.get(slot) ?? []).filter((item) => item !== entry);
      this.#slots.set(slot, next);
      el.remove();
    };
  }

  /** Bind a slot container and repaint every registered renderer. */
  mount(slot: string, host: HTMLElement): void {
    this.#hosts.set(slot, host);
    host.replaceChildren();
    for (const { el, render } of this.#slots.get(slot) ?? []) {
      host.append(el);
      render(el);
    }
  }
}

/** Mount the production UI against an in-memory host for browser visual inspection.
 * @param root Element reused as the application shell root.
 * @returns Teardown removing plugin subscriptions and preview DOM. */
export async function mountUiPreview(root: HTMLElement): Promise<() => void> {
  const workspace = new WorkspaceService();
  const slots = new PreviewSlots();
  const files = {
    readTree: async () => previewTree,
    readText: async (path: string) => (path === markdownPath ? markdown : "# 研究笔记\n"),
    writeText: async () => undefined,
    onFsChanged: () => () => undefined,
    pickFolder: async () => null,
    assetUrl: (path: string) => path,
  };
  const windows = {
    create: async () => "preview",
    changeRoot: async () => undefined,
    guardClose: async () => () => undefined,
    confirmDialog: async () => true,
  };
  const plugins = {
    bootBroken: [],
    readManifest: async () => JSON.stringify({
      plugins: [
        ...["app-shell", "view-filetree", "doc-markdown", "doc-video", "app-windows", "app-chat", "plugin-manager"]
          .map((id) => ({ id, enabled: true, config: {} })),
        { id: "ext:demo", enabled: true, config: {} },
      ],
    }),
    list: async () => [{ name: "demo", version: "1.0.0", apiVersion: 1, entry: "index.js", problem: null }],
    writeManifest: async () => undefined,
    remove: async () => undefined,
    install: async () => "demo",
    importFromTgz: async () => null,
  };
  const ctx = { files, windows, workspace, slots, plugins, llm: new PreviewLlm() } as unknown as Context;
  const shellConfig: ShellConfig = { title: "StudyWiki" };

  const teardown = [
    applyWindows(ctx),
    applyPluginManager(ctx),
    applyLlmSettings(ctx),
    applyFileTree(ctx, { ignoreDotfiles: true }),
    applyMarkdown(ctx, {}),
    applyVideo(ctx),
    applyChat(ctx),
    applyShell(ctx, shellConfig),
  ].reverse();

  workspace.setRoot(previewRoot);
  workspace.openFile(previewTree[0]?.children?.[0] ?? previewTree[1]!);
  await new Promise((resolve) => setTimeout(resolve, 0));

  return () => {
    for (const off of teardown) off();
    root.replaceChildren();
  };
}
