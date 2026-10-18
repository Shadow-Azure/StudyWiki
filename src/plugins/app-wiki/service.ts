import type { FilesService, ProbeSample } from "../../host/files";
import type { WorkspaceFacade } from "../../host/workspace";
import type { PromptSectionInput } from "../agent-core/service";
import { WIKI_SCHEMA } from "./schema";
import {
  classifySource,
  createProbeCache,
  kindFromPath,
  parseMachineIndex,
  reconcileIndex,
  serializeMachineIndex,
  type ArtifactEvidence,
  type MachineIndex,
  type SourceRecord,
  type SourceState,
} from "./state";

const SOURCES_DIR = ".study-wiki/llm-wiki/sources";
const INDEX_MD = ".study-wiki/llm-wiki/index.md";
const INDEX_YAML = ".study-wiki/index.yaml";
const HEAD_LINE_BUDGET = 80;
const HEAD_CHAR_BUDGET = 4096;
const TRUNCATION_SUFFIX = "…（截断）";

/** wiki 知识层服务：源状态判定与 prompt 贡献段。 */
export interface WikiService {
  /** 某库相对路径源的分析状态（内部先物化索引再判定）。 */
  sourceState(relPath: string): Promise<SourceState>;
  /** prompt 贡献段：wiki 未初始化且无库内活动文件时返回 null。 */
  contextSection(input: PromptSectionInput): Promise<string | null>;
  /** 失效 probe 缓存与根记忆（换库根/活动文件切换时由事件触发）。 */
  invalidate(): void;
}

/** 组装 wiki 服务。
 * @param deps 文件通道与窗口工作区投影。
 * @returns 可注入 cordis 的 wiki 服务实例。
 */
export function createWikiService(deps: {
  files: FilesService;
  workspace: WorkspaceFacade;
}): WikiService {
  const cache = createProbeCache();
  const knownSamples = new Map<string, ProbeSample>();
  let lastRoot: string | null = null;

  async function probeAbs(path: string): Promise<ProbeSample | null> {
    try {
      const fresh = await deps.files.probeSourceFile(path, knownSamples.get(path));
      const sample = cache.get(path, fresh);
      knownSamples.set(path, sample);
      return sample;
    } catch {
      knownSamples.delete(path);
      return null;
    }
  }

  async function collectEvidence(root: string): Promise<ArtifactEvidence[]> {
    const evidence = new Map<string, number>();
    let nodes;
    try {
      nodes = await deps.files.readTree(`${root}/${SOURCES_DIR}`);
    } catch {
      return [];
    }
    for (const node of nodes) {
      if (!node.path.endsWith(".md")) continue;
      const rel = node.path.slice(`${root}/${SOURCES_DIR}/`.length, -".md".length);
      const source = await resolveSourceFromPage(node.path, rel);
      const sample = await probeAbs(node.path);
      if (sample === null) continue;
      evidence.set(source, Math.max(evidence.get(source) ?? 0, sample.mtimeMs));
    }
    return [...evidence.entries()].map(([source, mtimeMs]) => ({
      source,
      newestArtifactMtimeMs: mtimeMs,
    }));
  }

  async function refresh(root: string): Promise<void> {
    if (lastRoot !== root) {
      cache.invalidate();
      knownSamples.clear();
      lastRoot = root;
    }
    const evidence = await collectEvidence(root);
    const prevText = await deps.files.readText(`${root}/${INDEX_YAML}`).catch(() => null);
    const prev = prevText === null ? null : parseMachineIndex(prevText);
    const probed = new Map<string, ProbeSample>();
    for (const item of evidence) {
      const sample = await probeAbs(`${root}/${item.source}`);
      const previous = prev?.sources.find((record) => record.path === item.source);
      if (sample !== null && (previous === undefined || previous.sha256 === sample.sha256)) {
        probed.set(item.source, sample);
      }
    }
    const next = {
      version: 1,
      sources: reconcileIndex(prev, evidence, probed).sources.map((record) => {
        const previous = prev?.sources.find((item) => item.path === record.path);
        return previous !== undefined && !probed.has(record.path)
          ? { ...record, analyzedAt: previous.analyzedAt }
          : record;
      }),
    } satisfies MachineIndex;
    const serialized = serializeMachineIndex(next);
    if (serialized !== prevText) {
      await deps.files.writeText(`${root}/${INDEX_YAML}`, serialized);
    }
  }

  async function contextSection(input: PromptSectionInput): Promise<string | null> {
    const root = deps.workspace.root;
    if (root === null) return null;
    await refresh(root);
    const indexText = await deps.files.readText(`${root}/${INDEX_YAML}`).catch(() => null);
    const index = indexText === null ? null : parseMachineIndex(indexText);
    const initialized = await deps.files
      .readText(`${root}/${INDEX_MD}`)
      .then(() => true)
      .catch(() => false);

    const rel = toRel(root, input.activeFilePath);
    const parts: string[] = [];
    if (rel !== null) {
      const sample = await probeAbs(`${root}/${rel}`);
      if (sample !== null) {
        const state = classifySource(index, rel, sample);
        if (state.state === "moved") {
          const record: SourceRecord = {
            ...state.record,
            path: rel,
            size: state.sample.size,
            sha256: state.sample.sha256,
          };
          const rewritten: MachineIndex = {
            version: 1,
            sources: index!.sources.map((item) => (item === state.record ? record : item)),
          };
          await deps.files.writeText(`${root}/${INDEX_YAML}`, serializeMachineIndex(rewritten));
          parts.push(stateLine({ state: "fresh", record }, rel));
        } else {
          parts.push(stateLine(state, rel));
        }
      } else {
        parts.push(stateLine({ state: "unknown" }, rel));
      }
    }
    if (initialized) {
      const head = await boundedHead(root);
      if (head !== null) parts.push(head);
    } else if (rel === null) {
      return null;
    }
    parts.push(WIKI_SCHEMA);
    return parts.join("\n\n");
  }

  async function boundedHead(root: string): Promise<string | null> {
    const text = await deps.files.readText(`${root}/${INDEX_MD}`).catch(() => null);
    if (text === null) return null;
    const lines = text.split("\n");
    const lineLimited = lines.slice(0, HEAD_LINE_BUDGET).join("\n");
    const truncatedByLines = lines.length > HEAD_LINE_BUDGET;
    if (lineLimited.length <= HEAD_CHAR_BUDGET) {
      return `# llm-wiki index 头部\n${lineLimited}${truncatedByLines ? TRUNCATION_SUFFIX : ""}`;
    }
    return `# llm-wiki index 头部\n${lineLimited.slice(0, HEAD_CHAR_BUDGET)}${TRUNCATION_SUFFIX}`;
  }

  async function resolveSourceFromPage(path: string, rel: string): Promise<string> {
    const text = await deps.files.readText(path).catch(() => null);
    if (text !== null) {
      const source = readFrontmatterSource(text);
      if (source !== null) return source;
    }
    return `${rel}.md`;
  }

  return {
    async sourceState(relPath) {
      const root = deps.workspace.root;
      if (root === null) return { state: "unknown" };
      await refresh(root);
      const text = await deps.files.readText(`${root}/${INDEX_YAML}`).catch(() => null);
      const index = text === null ? null : parseMachineIndex(text);
      const sample = await probeAbs(`${root}/${relPath}`);
      return sample === null ? { state: "unknown" } : classifySource(index, relPath, sample);
    },
    contextSection,
    invalidate() {
      cache.invalidate();
      knownSamples.clear();
      lastRoot = null;
    },
  };
}

function toRel(root: string, path: string | null): string | null {
  if (path === null || !path.startsWith(`${root}/`)) return null;
  const rel = path.slice(root.length + 1);
  return rel.length === 0 ? null : rel;
}

function stateLine(state: SourceState, rel: string): string {
  if (state.state === "fresh") {
    return `活动文件已分析：${sourcesPagePath(state.record.path)}`;
  }
  if (state.state === "stale") {
    return `活动文件已变更，请重新 ingest：${rel}`;
  }
  if (kindFromPath(rel) === "video") {
    return `活动文件尚未分析；转录能力后续里程碑提供：${rel}`;
  }
  return `活动文件尚未分析：${rel}`;
}

function sourcesPagePath(source: string): string {
  const withoutExtension = source.replace(/\.[^./\\]+$/u, "");
  return `${SOURCES_DIR}/${withoutExtension}.md`;
}

function readFrontmatterSource(text: string): string | null {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;
  for (const line of text.slice(4, end).split("\n")) {
    const match = line.match(/^source:\s*(.*?)\s*$/u);
    if (match === null) continue;
    return unquoteFrontmatterValue(match[1]);
  }
  return null;
}

function unquoteFrontmatterValue(value: string): string {
  const quoted =
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")));
  if (quoted) {
    return value.slice(1, -1);
  }
  return value;
}
