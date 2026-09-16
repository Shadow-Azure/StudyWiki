import type { Context } from "cordis";
import "./styles.css";
import { apply as applyShell, type ShellConfig } from "./plugins/app-shell";
import { apply as applyWindows } from "./plugins/app-windows";
import { apply as applyFileTree } from "./plugins/view-filetree";
import { apply as applyMarkdown } from "./plugins/doc-markdown";
import { apply as applyVideo } from "./plugins/doc-video";
import { apply as applyPluginManager } from "./plugins/plugin-manager";
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
        ...["app-shell", "view-filetree", "doc-markdown", "doc-video", "app-windows", "plugin-manager"]
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
  const ctx = { files, windows, workspace, slots, plugins } as unknown as Context;
  const shellConfig: ShellConfig = { title: "StudyWiki" };

  const teardown = [
    applyWindows(ctx),
    applyPluginManager(ctx),
    applyFileTree(ctx, { ignoreDotfiles: true }),
    applyMarkdown(ctx, {}),
    applyVideo(ctx),
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
