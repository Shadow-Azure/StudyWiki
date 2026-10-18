import { describe, expect, it } from "vitest";
import { createWikiService } from "../src/plugins/app-wiki/service";
import * as appWiki from "../src/plugins/app-wiki";
import { MODULE_TABLE } from "../src/loader/table";
import type { FilesService, ProbeSample } from "../src/host/files";
import type { WorkspaceFacade } from "../src/host/workspace";
import type { FileNode } from "../src/types";
import { WIKI_SCHEMA } from "../src/plugins/app-wiki/schema";
import { serializeMachineIndex } from "../src/plugins/app-wiki/state";

function fakeWikiHost(opts: {
  root?: string | null;
  files?: Record<string, string>;
  activePath?: string | null;
  probe?: (path: string) => ProbeSample | null;
}) {
  const files = new Map(Object.entries(opts.files ?? {}));
  const probeImpl = opts.probe ?? (() => ({ size: 10, mtimeMs: 1000, sha256: "aa".repeat(32) }));
  const filesSvc = {
    readText: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error("ENOENT");
      return value;
    },
    writeText: async (path: string, contents: string) => {
      files.set(path, contents);
    },
    readTree: async (root: string) => buildTree(root, [...files.keys()]),
    probeSourceFile: async (path: string) => {
      const sample = probeImpl(path);
      if (sample === null) throw new Error("ENOENT");
      return sample;
    },
  } as unknown as FilesService;
  const listeners = new Set<(file: unknown) => void>();
  const workspace = {
    get root() {
      return opts.root ?? "/lib";
    },
    get activeFile() {
      return opts.activePath ? { name: "x", path: opts.activePath, kind: "markdown" } : null;
    },
    events: {
      on: (_channel: string, listener: (file: unknown) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      emit: (file: unknown) => [...listeners].forEach((listener) => listener(file)),
    },
    openFile: async () => true,
    guardSwitch: () => () => {},
  } as unknown as WorkspaceFacade;
  return { filesSvc, workspace, files };
}

function buildTree(root: string, paths: string[]): FileNode[] {
  const prefix = `${root}/`;
  const children = paths.filter((path) => path.startsWith(prefix));
  const nodes: FileNode[] = [];
  for (const path of children) {
    const rest = path.slice(prefix.length);
    const [name, ...tail] = rest.split("/");
    if (tail.length > 0) {
      if (!nodes.some((node) => node.name === name)) {
        nodes.push({
          name,
          path: `${root}/${name}`,
          kind: "dir",
          children: buildTree(`${root}/${name}`, paths),
        });
      }
      continue;
    }
    nodes.push({
      name,
      path,
      kind: name.endsWith(".md") ? "markdown" : "other",
    });
  }
  return nodes;
}

const WIKI_INDEX = "/lib/.study-wiki/llm-wiki/index.md";
const MACHINE_INDEX = "/lib/.study-wiki/index.yaml";

describe("wiki contextSection", () => {
  it("welcome 态（root null）→ null", async () => {
    const { filesSvc, workspace } = fakeWikiHost({ root: null });
    const wiki = createWikiService({ files: filesSvc, workspace });
    expect(await wiki.contextSection({ root: "", activeFilePath: null })).toBeNull();
  });

  it("库内活动文本源未分析 → 段含 schema 与「尚未分析」提示", async () => {
    const { filesSvc, workspace } = fakeWikiHost({ activePath: "/lib/notes/a.md" });
    const wiki = createWikiService({ files: filesSvc, workspace });
    const section = await wiki.contextSection({ root: "/lib", activeFilePath: "/lib/notes/a.md" });
    expect(section).toContain(WIKI_SCHEMA.slice(0, 40));
    expect(section).toContain("尚未分析");
    expect((await wiki.sourceState("notes/a.md")).state).toBe("unknown");
  });

  it("库内活动视频未分析 → 提示转录能力后续里程碑提供", async () => {
    const { filesSvc, workspace } = fakeWikiHost({ activePath: "/lib/lecture.mp4" });
    const wiki = createWikiService({ files: filesSvc, workspace });
    const section = await wiki.contextSection({ root: "/lib", activeFilePath: "/lib/lecture.mp4" });
    expect(section).toContain("尚未分析");
    expect(section).toContain("转录能力后续里程碑提供");
  });

  it("已分析（产物页存在）→ fresh 且注入 index 头", async () => {
    const { filesSvc, workspace, files } = fakeWikiHost({
      activePath: "/lib/notes/a.md",
      files: {
        [WIKI_INDEX]: "# 目录\n- [[a]]\n",
        "/lib/.study-wiki/llm-wiki/sources/notes/a.md": "---\ntype: source\n---\n# A",
      },
      probe: () => ({ size: 10, mtimeMs: 1000, sha256: "aa".repeat(32) }),
    });
    const wiki = createWikiService({ files: filesSvc, workspace });
    const section = await wiki.contextSection({ root: "/lib", activeFilePath: "/lib/notes/a.md" });
    expect(section).toContain("已分析");
    expect(section).toContain("目录");
    expect(files.get(MACHINE_INDEX)).toContain('"notes/a.md"');
    expect(files.get(MACHINE_INDEX)).toContain(
      'page: ".study-wiki/llm-wiki/sources/notes/a.md"',
    );
    expect((await wiki.sourceState("notes/a.md")).state).toBe("fresh");
  });

  it("源内容变化 → stale 并提示重新 ingest", async () => {
    const oldRecord = {
      path: "notes/a.md",
      kind: "text" as const,
      sha256: "aa".repeat(32),
      size: 10,
      analyzedAt: "1970-01-01T00:00:01.000Z",
      artifact: ".study-wiki/raw/old",
    };
    const { filesSvc, workspace } = fakeWikiHost({
      activePath: "/lib/notes/a.md",
      files: {
        [MACHINE_INDEX]: serializeMachineIndex({ version: 1, sources: [oldRecord] }),
        "/lib/.study-wiki/llm-wiki/sources/notes/a.md": "---\ntype: source\n---\n# A",
      },
      probe: (path) =>
        path.endsWith(".study-wiki/llm-wiki/sources/notes/a.md")
          ? { size: 4, mtimeMs: 1000, sha256: "aa".repeat(32) }
          : { size: 12, mtimeMs: 2000, sha256: "bb".repeat(32) },
    });
    const wiki = createWikiService({ files: filesSvc, workspace });
    const section = await wiki.contextSection({ root: "/lib", activeFilePath: "/lib/notes/a.md" });
    expect(section).toContain("重新 ingest");
    expect((await wiki.sourceState("notes/a.md")).state).toBe("stale");
  });

  it("源迁址 → 重指索引行且 artifact 与 analyzedAt 不动", async () => {
    const oldRecord = {
      path: "notes/old.md",
      kind: "text" as const,
      sha256: "aa".repeat(32),
      size: 9,
      analyzedAt: "1970-01-01T00:00:02.000Z",
      artifact: ".study-wiki/raw/old",
    };
    const { filesSvc, workspace, files } = fakeWikiHost({
      activePath: "/lib/notes/new.md",
      files: {
        [MACHINE_INDEX]: serializeMachineIndex({ version: 1, sources: [oldRecord] }),
        "/lib/.study-wiki/llm-wiki/sources/notes/old.md": "---\ntype: source\n---\n# A",
      },
      probe: (path) =>
        path === "/lib/notes/old.md"
          ? null
          : path.endsWith(".study-wiki/llm-wiki/sources/notes/old.md")
            ? { size: 4, mtimeMs: 5000, sha256: "aa".repeat(32) }
            : { size: 9, mtimeMs: 3000, sha256: "aa".repeat(32) },
    });
    const wiki = createWikiService({ files: filesSvc, workspace });
    const section = await wiki.contextSection({ root: "/lib", activeFilePath: "/lib/notes/new.md" });
    expect(section).toContain("已分析");
    expect(files.get(MACHINE_INDEX)).toContain('"notes/new.md"');
    expect(files.get(MACHINE_INDEX)).toContain(`"${"aa".repeat(32)}"`);
    expect(files.get(MACHINE_INDEX)).toContain("1970-01-01T00:00:02.000Z");
    expect(files.get(MACHINE_INDEX)).not.toContain("1970-01-01T00:00:05.000Z");
    expect(files.get(MACHINE_INDEX)).toContain('".study-wiki/raw/old"');

    const second = await wiki.contextSection({
      root: "/lib",
      activeFilePath: "/lib/notes/new.md",
    });
    expect(second).toContain("已分析");
    expect(files.get(MACHINE_INDEX)).toContain('path: "notes/new.md"');
    expect(files.get(MACHINE_INDEX)).not.toContain('path: "notes/old.md"');
    expect(files.get(MACHINE_INDEX)).toContain(`"${"aa".repeat(32)}"`);
    expect(files.get(MACHINE_INDEX)).toContain("size: 9");
    expect(files.get(MACHINE_INDEX)).toContain('".study-wiki/raw/old"');
    expect(files.get(MACHINE_INDEX)).toContain("1970-01-01T00:00:02.000Z");
    expect(files.get(MACHINE_INDEX)).not.toContain("1970-01-01T00:00:05.000Z");
    expect(files.get(MACHINE_INDEX)).toContain(
      'page: ".study-wiki/llm-wiki/sources/notes/old.md"',
    );
    expect((await wiki.sourceState("notes/new.md")).state).toBe("fresh");
  });

  it("索引损坏 → 从证据重建，fresh 不丢", async () => {
    const { filesSvc, workspace, files } = fakeWikiHost({
      activePath: "/lib/notes/a.md",
      files: {
        [MACHINE_INDEX]: "garbage: [\n",
        "/lib/.study-wiki/llm-wiki/sources/notes/a.md": "---\ntype: source\n---\n# A",
      },
    });
    const wiki = createWikiService({ files: filesSvc, workspace });
    await wiki.contextSection({ root: "/lib", activeFilePath: "/lib/notes/a.md" });
    expect(files.get(MACHINE_INDEX)).toContain("notes/a.md");
    expect((await wiki.sourceState("notes/a.md")).state).toBe("fresh");
  });

  it("库外活动文件 → 状态行降级但 wiki 上下文保留", async () => {
    const { filesSvc, workspace } = fakeWikiHost({
      activePath: "/elsewhere/a.md",
      files: { [WIKI_INDEX]: "# 目录\n" },
    });
    const wiki = createWikiService({ files: filesSvc, workspace });
    const section = await wiki.contextSection({ root: "/lib", activeFilePath: "/elsewhere/a.md" });
    expect(section).toContain("目录");
    expect(section.split("# llm-wiki index 头部")[0]).not.toContain("活动文件");
  });

  it("`.study-wiki` 整体删除且无活动文件 → null 且不抛出", async () => {
    const { filesSvc, workspace, files } = fakeWikiHost({ activePath: null });
    const wiki = createWikiService({ files: filesSvc, workspace });
    await expect(wiki.contextSection({ root: "/lib", activeFilePath: null })).resolves.toBeNull();
    expect(files.has(MACHINE_INDEX)).toBe(false);
  });

  it("index 头超预算截断（标记包裹，可独立量长）", async () => {
    const { filesSvc, workspace } = fakeWikiHost({
      activePath: "/lib/notes/a.md",
      files: {
        [WIKI_INDEX]: "# 目录\n" + Array.from({ length: 200 }, (_, index) => `- 第 ${index} 条`).join("\n"),
        "/lib/.study-wiki/llm-wiki/sources/notes/a.md": "---\ntype: source\n---\n# A",
      },
    });
    const wiki = createWikiService({ files: filesSvc, workspace });
    const section = (await wiki.contextSection({ root: "/lib", activeFilePath: "/lib/notes/a.md" }))!;
    const match = section.match(/# llm-wiki index 头部\n([\s\S]*?)\n\n# llm-wiki 维护契约/);
    expect(match).not.toBeNull();
    expect(match![1].length).toBeLessThanOrEqual(4096 + "…（截断）".length + 1);
  });
});

describe("app-wiki plugin registration", () => {
  it("提供 ctx.wiki、注册 prompt 段并在卸载时清理事件", async () => {
    const { filesSvc, workspace } = fakeWikiHost({ root: "/lib", activePath: null });
    const provided = new Map<string, unknown>();
    const sections = new Map<string, (input: { root: string; activeFilePath: string | null }) => Promise<string | null>>();
    let promptDisposed = false;
    let eventDisposals = 0;
    const originalOn = workspace.events.on;
    workspace.events.on = ((channel: string, listener: (file: unknown) => void) => {
      const off = originalOn.call(workspace.events, channel, listener);
      return () => {
        eventDisposals += 1;
        off();
      };
    }) as typeof workspace.events.on;
    const context = {
      reflect: { provide: (key: string, value: unknown) => provided.set(key, value) },
      agent: {
        registerPromptSection: (id: string, provider: (input: { root: string; activeFilePath: string | null }) => Promise<string | null>) => {
          sections.set(id, provider);
          return () => {
            promptDisposed = true;
            sections.delete(id);
          };
        },
      },
      files: filesSvc,
      workspace,
    } as never;
    const dispose = appWiki.apply(context);
    const wiki = provided.get("wiki") as { contextSection: unknown; invalidate: unknown };
    expect(typeof wiki.contextSection).toBe("function");
    expect(typeof wiki.invalidate).toBe("function");
    expect(MODULE_TABLE["app-wiki"]?.plugin).toBe(appWiki);
    expect(sections.has("wiki")).toBe(true);
    await expect(sections.get("wiki")!({ root: "/lib", activeFilePath: null })).resolves.toBeNull();
    dispose();
    expect(promptDisposed).toBe(true);
    expect(eventDisposals).toBe(2);
  });
});
