# llm-wiki 知识层（m2-04 / #31）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 issue #31 llm-wiki 知识层：内置插件 `app-wiki` 持有 schema，agent 对话驱动 ingest/query/lint，`.study-wiki/` 固定路径契约 + 源状态机 + `probe_source_file` 探测命令，视频全契约预留。

**Architecture:** schema 归插件（prompt 贡献缝注入），wiki 文件全由 agent 经现有四工具落盘（`write_text_file` 自动建父目录支撑深路径），机器索引 `.study-wiki/index.yaml` 是程序维护的派生物（探测时按产物存在性物化，手写受限 yaml 子集解析，损坏即重建），状态判定序 path→sha256 反查（unknown/fresh/stale/moved），moved 只重指索引不重命名实体目录。

**Tech Stack:** Tauri 2（Rust + 已 pinned `sha2`）、TypeScript + cordis（内置插件）、vitest、cargo test。零新 npm 依赖、零新 Rust crate。

**Spec:** `plans/2026-10-18-llm-wiki-design.md`（本计划争论自该 spec；执行者两文并读）

## Global Constraints

- 插件禁 import `@tauri-apps/*`（`pnpm verify:layering` 机械校验）。
- 零新 npm 依赖；零新 Rust crate（SHA-256 复用 `Cargo.toml` 已有 `sha2 = "0.10"`）。
- TS 导出与 Tauri 命令必须带文档注释（commands.md 生成区原料）。
- 常驻文档中英成对三件套；issue #31 三件套 + Agent Note 同 PR；提交信息含 `(#31)`。
- 完全离线：无运行时下载、无网络访问、无环境变量分支。
- 新增 Rust 命令必须注册 invoke_handler 并过 `pnpm verify:commands`（生成区重建）。
- vitest 假 ctx 全链路测（不启 app）；cargo 单测用 `fixture_tree` 风格的临时目录。

## Review Focus

- 活动文件在库外 / rootMismatch / welcome 态（root = null）：wiki 段必须降级为 null，回合不受影响（Task 7 测）。
- `.study-wiki/index.yaml` 被用户手改损坏：parse 返回 null，reconcile 从产物证据重建，已分析产物一行不丢（Task 4、Task 7 测）。
- 大文件哈希多块一致与 known 快路径：`probe_source_file` 传已知 `size+mtimeMs` 命中时必须跳过哈希（视频 GB 级文件每回合重哈希不可接受）（Task 1 cargo 测）。
- 三附录并存 token 预算：库根 AGENTS.md + wiki 段同时注入时，schema ≤ 6000 字符、index 头 ≤ 4 KiB（Task 6、Task 7 测）。
- `.study-wiki/` 被整体删除：readTree 抛错被接住，段降级、refresh 幂等重建，不崩回合（Task 7 测）。

---

### Task 1: Rust `probe_source_file` 命令 + TS facade

**Files:**
- Create: `src-tauri/src/probe.rs`
- Modify: `src-tauri/src/lib.rs`（`mod probe;` + `invoke_handler` 注册）
- Modify: `src/host/files.ts`（`ProbeSample` 类型 + `probeSourceFile` 方法）

**Interfaces:**
- Consumes: `ensure_authorized_read`（`lib.rs`，读域校验，与 `read_text_file` 同款）、`config::app_studywiki_dir`。
- Produces:
  - Rust：`pub struct ProbeSample { pub size: u64, pub mtime_ms: i64, pub sha256: String }`（`#[serde(rename_all = "camelCase")]`，TS 见 `mtimeMs`）；`pub struct ProbeError { pub code: String, pub message: String }`；命令 `probe_source_file(window, app, state, path: String, known: Option<ProbeSample>) -> Result<ProbeSample, ProbeError>`。
  - TS：`export interface ProbeSample { size: number; mtimeMs: number; sha256: string; }`（`src/host/files.ts`）；`FilesService.probeSourceFile(path: string, known?: ProbeSample): Promise<ProbeSample>`。

- [ ] **Step 1: 写失败的 cargo 测试**

`src-tauri/src/probe.rs` 内 `#[cfg(test)] mod tests`：

```rust
use super::*;

#[test]
fn hashes_known_content() {
    let dir = std::env::temp_dir().join(format!("sw-probe-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join("a.md");
    std::fs::write(&p, b"hello study-wiki").unwrap();
    // metadata 路径：不依赖窗口授权的部分抽成纯函数 probe_file(path, known)。
    let r = probe_file(&p, None).unwrap();
    assert_eq!(r.size, 16);
    // SHA-256("hello study-wiki") 前缀，全值由实现算出后回填断言：
    assert_eq!(r.sha256.len(), 64);
    assert!(r.mtime_ms > 0);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn known_fast_path_skips_hash() {
    // 构造 > 64 KiB 文件：known 命中（size+mtimeMs 一致）时 sha256 原样返回。
    let dir = std::env::temp_dir().join(format!("sw-probe-fast-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join("big.bin");
    std::fs::write(&p, vec![7u8; 200_000]).unwrap();
    let full = probe_file(&p, None).unwrap();
    let fast = probe_file(&p, Some(full.clone())).unwrap();
    assert_eq!(fast.sha256, full.sha256);
    // known 失配（改内容后同 size 做不到则改 size）→ 重算：篡改 known.size。
    let stale = probe_file(&p, Some(ProbeSample { size: 1, ..full.clone() })).unwrap();
    assert_eq!(stale.sha256, full.sha256);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn rejects_parent_dir_components() {
    let e = probe_file(Path::new("/tmp/../etc/passwd"), None).unwrap_err();
    assert_eq!(e.code, "PROBE_INVALID_PATH");
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test probe`
Expected: 编译失败（`probe_file` 未定义）。

- [ ] **Step 3: 实现 `probe.rs`**

```rust
//! 源文件探测：流式 SHA-256 + 大小 + mtime；known 命中（size + mtimeMs 一致）
//! 时跳过哈希（视频大文件每回合重哈希不可接受）。错误带稳定 code，message 仅诊断。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;

const CHUNK: usize = 64 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSample {
    pub size: u64,
    pub mtime_ms: i64,
    pub sha256: String,
}

#[derive(Debug, Serialize)]
pub struct ProbeError {
    pub code: String,
    pub message: String,
}

fn err(code: &str, message: String) -> ProbeError {
    ProbeError { code: code.into(), message }
}

/// 探测文件：返回大小、mtime（Unix 毫秒）与流式 SHA-256。known 提供且
/// size/mtime 与磁盘一致时原样返回 known.sha256（快路径，不重读内容）。
pub fn probe_file(path: &Path, known: Option<ProbeSample>) -> Result<ProbeSample, ProbeError> {
    if path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(err("PROBE_INVALID_PATH", format!("路径不得含 .. 组件：{}", path.display())));
    }
    let meta = std::fs::metadata(path)
        .map_err(|e| err("PROBE_NOT_FOUND", format!("metadata {}: {e}", path.display())))?;
    let size = meta.len();
    let mtime_ms = meta
        .modified()
        .map_err(|e| err("PROBE_STAT", format!("mtime {}: {e}", path.display())))?
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    if let Some(k) = known {
        if k.size == size && k.mtime_ms == mtime_ms {
            return Ok(ProbeSample { size, mtime_ms, sha256: k.sha256 });
        }
    }
    let mut hasher = Sha256::new();
    let mut file = std::fs::File::open(path)
        .map_err(|e| err("PROBE_READ", format!("open {}: {e}", path.display())))?;
    use std::io::Read;
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = file.read(&mut buf).map_err(|e| err("PROBE_READ", format!("read {}: {e}", path.display())))?;
        if n == 0 { break; }
        hasher.update(&buf[..n]);
    }
    Ok(ProbeSample { size, mtime_ms, sha256: format!("{:x}", hasher.finalize()) })
}
```

`lib.rs` 注册命令（镜像 `read_text_file` 的授权链）：

```rust
/// agent wiki 源探测：读域授权校验后返回大小/mtime/SHA-256；known 命中跳过哈希。
#[tauri::command]
fn probe_source_file<R: tauri::Runtime>(
    window: tauri::Window<R>,
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, std::sync::Mutex<windows::WindowRegistry>>,
    path: String,
    known: Option<crate::probe::ProbeSample>,
) -> Result<crate::probe::ProbeSample, crate::probe::ProbeError> {
    let config_root = config::app_studywiki_dir(&app)?;
    ensure_authorized_read(&state, window.label(), &path, &config_root)
        .map_err(|e| crate::probe::ProbeError { code: "PROBE_UNAUTHORIZED".into(), message: e })?;
    crate::probe::probe_file(std::path::Path::new(&path), known)
}
```

并在 `mod` 区与 `invoke_handler` 列表（`probe_source_file` 按字母序就近插入）注册。

TS facade（`src/host/files.ts`，`authorizeReadPath` 方法后追加，方法带文档注释）：

```ts
/** 源文件探测样本（`probe_source_file` 命令返回）。 */
export interface ProbeSample {
  /** 文件大小（字节）。 */
  size: number;
  /** 修改时间（Unix 毫秒）。 */
  mtimeMs: number;
  /** 流式 SHA-256（小写 hex）。 */
  sha256: string;
}

/** 探测源文件的大小/mtime/SHA-256；known 命中（size+mtimeMs 一致）时跳过哈希。
 * @param path 绝对路径；库外路径与 `..` 组件被拒绝。
 * @param known 上次探测样本（缓存快路径）。
 * @returns 最新探测样本。 */
probeSourceFile(path: string, known?: ProbeSample): Promise<ProbeSample> {
  return this.#deps.invoke("probe_source_file", { path, known }) as Promise<ProbeSample>;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src-tauri && cargo test`
Expected: probe 三例 + 既有全部用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/probe.rs src-tauri/src/lib.rs src/host/files.ts
git commit -m "feat: probe_source_file 源探测命令与 facade（#31）"
```

### Task 2: `std_write` 自动建父目录

**Files:**
- Modify: `src-tauri/src/lib.rs:108-110`（`std_write`）

**Interfaces:**
- Consumes: 无。
- Produces: `std_write` 语义升级——父目录不存在时自动创建（`write_text_file` 与配置写共用；agent 据此可向 `.study-wiki/llm-wiki/...` 深路径写页）。

- [ ] **Step 1: 写失败的 cargo 测试**

`lib.rs` 既有 `#[cfg(test)] mod tests` 内追加：

```rust
#[test]
fn std_write_creates_missing_parent_dirs() {
    let dir = std::env::temp_dir().join(format!("sw-stdwrite-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let p = dir.join("a/b/c/page.md");
    std_write(&p, "body").unwrap();
    assert_eq!(std::fs::read_to_string(&p).unwrap(), "body");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn std_write_errors_when_parent_component_is_file() {
    let dir = std::env::temp_dir().join(format!("sw-stdwrite-bad-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("blocker"), b"x").unwrap();
    let p = dir.join("blocker/page.md");
    assert!(std_write(&p, "body").is_err());
    std::fs::remove_dir_all(&dir).unwrap();
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test std_write`
Expected: FAIL（父目录不存在写失败）。

- [ ] **Step 3: 实现**

```rust
fn std_write(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
    }
    fs::write(path, contents).map_err(|e| format!("write {}: {e}", path.display()))
}
```

注意：`write_text_file` 命令的 `ensure_authorized` 在 `std_write` 之前执行，`..`/库外边界不变；本改动只补目录创建。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src-tauri && cargo test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: write_text_file 自动建父目录（#31）"
```

### Task 3: agent-core prompt 贡献缝

**Files:**
- Modify: `src/plugins/agent-core/service.ts`（`AgentService` 接口 + 注册表 + `send()` 组装点）
- Modify: `src/plugins/agent-core/prompt.ts`（`buildSystemPrompt` 增 `extraSections`）
- Test: `tests/agent-prompt.test.ts`、`tests/agent-service.test.ts`

**Interfaces:**
- Consumes: 无（首个纯 TS 任务）。
- Produces:
  - `export interface PromptSectionInput { root: string; activeFilePath: string | null; }`（service.ts）
  - `export type PromptSectionProvider = (input: PromptSectionInput) => Promise<string | null>;`（service.ts）
  - `AgentService.registerPromptSection(id: string, provider: PromptSectionProvider): () => void;`——id 重复覆盖，返回注销函数。
  - `buildSystemPrompt(input)` 增 `extraSections?: readonly string[]`：非空段按数组序以 `\n\n` 追加在「库约定（AGENTS.md）」附录之后。
  - Task 7 依赖：app-wiki 经 `ctx.agent.registerPromptSection("wiki", provider)` 挂段。

- [ ] **Step 1: 写失败的测试**

`tests/agent-prompt.test.ts` 追加：

```ts
it("extraSections 追加在库约定之后且按序拼接", () => {
  const p = buildSystemPrompt({
    ...base,
    agentsMd: "# 库约定",
    extraSections: ["# wiki 段\n状态行", "# 第二段"],
  });
  expect(p.indexOf("# 库约定")).toBeLessThan(p.indexOf("# wiki 段"));
  expect(p.indexOf("# wiki 段")).toBeLessThan(p.indexOf("# 第二段"));
});

it("extraSections 缺省或全空白不留占位", () => {
  expect(buildSystemPrompt(base)).not.toContain("wiki");
  expect(buildSystemPrompt({ ...base, extraSections: [] })).toBe(buildSystemPrompt(base));
  expect(buildSystemPrompt({ ...base, extraSections: ["", "  "] })).toBe(buildSystemPrompt(base));
});
```

`tests/agent-service.test.ts` 追加（镜像文件内既有 `fakeHost` + `scriptedChatStream` 模式；捕获 `request.systemPrompt()`，参考 `agent-loop.test.ts` 的 chatStream 请求捕获写法）：

```ts
it("registerPromptSection 注入、排序与注销", async () => {
  const { svc } = fakeHost({ "/home/.study-wiki/sessions/lib-root/s1.jsonl": encodeHeader() });
  const agent = createAgentService({
    llm: { chatStream: capturePromptStream(captured) /* 见下 */ },
    files: svc,
    workspace: { root: "/lib", activeFile: null, events: fakeEmitter(), openFile: async () => true, guardSwitch: () => () => {} },
  });
  const calls: string[] = [];
  const offA = agent.registerPromptSection("a", async () => { calls.push("a"); return "# A 段"; });
  agent.registerPromptSection("b", async () => null); // null 段被跳过
  agent.registerPromptSection("c", async () => "# C 段");
  const session = await agent.openSession("s1");
  await session.send("hi");
  expect(calls).toEqual(["a"]);
  expect(captured.system!).toContain("# A 段");
  expect(captured.system!).toContain("# C 段");
  expect(captured.system!).not.toContain("b");
  offA();
  await session.send("again");
  expect(captured.system!).not.toContain("# A 段");
});
```

（`capturePromptStream`/`fakeEmitter`/`encodeHeader` 若文件内已有同名工具直接复用；没有则在测试文件顶部按既有 fake 模式补三个小工具，不得改产品代码迁就测试。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/agent-prompt.test.ts tests/agent-service.test.ts`
Expected: FAIL——`extraSections` 不存在 / `registerPromptSection` 不是函数。

- [ ] **Step 3: 实现**

`service.ts`：模块级加类型与注册表（`createAgentService` 内）：

```ts
/** prompt 贡献段输入：当前库根与活动文件（绝对路径或 null）。 */
export interface PromptSectionInput {
  /** 当前会话库根。 */
  root: string;
  /** 活动文件绝对路径；无活动文件为 null。 */
  activeFilePath: string | null;
}

/** prompt 贡献段提供者：每回合调用；返回 markdown 段，null 表示本回合不注入。 */
export type PromptSectionProvider = (input: PromptSectionInput) => Promise<string | null>;
```

`AgentService` 接口加方法（带文档注释）：

```ts
/** 注册一个 system prompt 贡献段（拼在库约定附录之后）；id 重复覆盖。返回注销函数。 */
registerPromptSection(id: string, provider: PromptSectionProvider): () => void;
```

`createAgentService` 内（`const sections = new Map<string, PromptSectionProvider>()`），service 对象实现：

```ts
registerPromptSection(id, provider) {
  sections.set(id, provider);
  return () => { if (sections.get(id) === provider) sections.delete(id); };
},
```

`send()` 内 `runTurn` 之前解析（放在 `readAgentsMd` 之后）：

```ts
const activeFilePath = deps.workspace.activeFile?.path ?? null;
const sectionInput: PromptSectionInput = { root: internal.currentRoot, activeFilePath };
const extraSections: string[] = [];
for (const provider of sections.values()) {
  const section = await provider(sectionInput);
  if (section !== null && section.trim()) extraSections.push(section);
}
```

`buildSystemPrompt({ ..., extraSections })` 传入（`systemPrompt: () => buildSystemPrompt({...})` 处加字段）。

`prompt.ts`：

```ts
export function buildSystemPrompt(input: {
  root: string;
  agentsMd: string | null;
  activeFilePath: string | null;
  mode: ApprovalMode;
  now: string;
  /** 贡献段（如 wiki 契约）；按序追加在库约定附录之后，null/空白段调用方已滤除。 */
  extraSections?: readonly string[];
}): string {
  // ……既有 sections 组装不变……
  let prompt = sections.join("\n\n");
  if (input.agentsMd) prompt += `\n\n# 库约定（AGENTS.md）\n\n${input.agentsMd}`;
  const extras = (input.extraSections ?? []).filter((s) => s.trim());
  if (extras.length) prompt += `\n\n${extras.join("\n\n")}`;
  return prompt;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/agent-prompt.test.ts tests/agent-service.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/plugins/agent-core/service.ts src/plugins/agent-core/prompt.ts tests/agent-prompt.test.ts tests/agent-service.test.ts
git commit -m "feat: agent system prompt 贡献缝（#31）"
```

### Task 4: app-wiki 受限 yaml 子集解析

**Files:**
- Create: `src/plugins/app-wiki/index-yaml.ts`
- Test: `tests/app-wiki-index-yaml.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `export type SourceKind = "text" | "video";`
  - `export interface SourceRecord { path: string; kind: SourceKind; sha256: string; size: number; analyzedAt: string; artifact: string | null; }`
  - `export interface MachineIndex { version: 1; sources: SourceRecord[]; }`
  - `export function parseMachineIndex(text: string): MachineIndex | null;`——严格受限子集，任何不符合 → null（调用方视为损坏重建）。
  - `export function serializeMachineIndex(index: MachineIndex): string;`——`parse(serialize(x))` 恒等。
  - Task 5 消费全部类型。

- [ ] **Step 1: 写失败的测试**

`tests/app-wiki-index-yaml.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { parseMachineIndex, serializeMachineIndex, type MachineIndex } from "../src/plugins/app-wiki/index-yaml";

const sample: MachineIndex = {
  version: 1,
  sources: [
    { path: "courses/rust/ownership.md", kind: "text", sha256: "ab".repeat(32), size: 123, analyzedAt: "2026-10-18T12:00:00+08:00", artifact: null },
    { path: "courses/rust/borrow.mp4", kind: "video", sha256: "cd".repeat(32), size: 9_000_000, analyzedAt: "2026-10-18T13:00:00+08:00", artifact: ".study-wiki/raw/courses/rust/borrow" },
  ],
};

describe("machine index yaml 子集", () => {
  it("serialize/parse 恒等", () => {
    expect(parseMachineIndex(serializeMachineIndex(sample))).toEqual(sample);
  });

  it("字段齐全的单源最小文件", () => {
    const text = [
      "version: 1",
      "sources:",
      '  - path: "a.md"',
      "    kind: text",
      '    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"',
      "    size: 0",
      '    analyzedAt: "2026-10-18T00:00:00+08:00"',
      "    artifact: null",
      "",
    ].join("\n");
    expect(parseMachineIndex(text)).toEqual({
      version: 1,
      sources: [{ path: "a.md", kind: "text", sha256: "e3b0…b855", size: 0, analyzedAt: "2026-10-18T00:00:00+08:00", artifact: null }],
    });
  });

  it.each([
    ["version 缺失", 'sources:\n  - path: "a"\n'],
    ["version 非 1", "version: 2\nsources: []\n"],
    ["未知顶层键", "version: 1\nbogus: 1\nsources: []\n"],
    ["列表缩进错", 'version: 1\nsources:\n - path: "a"\n'],
    ["未知字段键", 'version: 1\nsources:\n  - path: "a"\nwat: 1\n'],
    ["未引号字符串", "version: 1\nsources:\n  - path: a.md\n"],
    ["kind 越界", 'version: 1\nsources:\n  - path: "a"\n    kind: doc\n'],
    ["size 非整数", 'version: 1\nsources:\n  - path: "a"\n    size: 1.5\n'],
  ])("损坏输入 → null：%s", (_name, text) => {
    expect(parseMachineIndex(text)).toBeNull();
  });

  it("空 sources 合法", () => {
    expect(parseMachineIndex("version: 1\nsources: []\n")).toEqual({ version: 1, sources: [] });
    expect(parseMachineIndex("version: 1\nsources:\n")).toEqual({ version: 1, sources: [] });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/app-wiki-index-yaml.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `index-yaml.ts`**

```ts
/** 机器索引 `.study-wiki/index.yaml` 的受限 yaml 子集解析/序列化。
 * 设计约束：不引 yaml 依赖；本插件独占读写；解析失败一律返回 null（调用方
 * 视为损坏、从产物证据重建）。受限子集：顶层 `version: <int>` 与 `sources:`
 * 列表（或 `sources: []`）；列表项为 `  - key: value` 起头 + `    key: value`
 * 续行的扁平标量；字符串必须双引号（支持 \" 与 \\ 转义），size 为十进制
 * 整数，artifact 允许 `null`；键集固定为 FIELDS，重复或缺失即 null。 */

export type SourceKind = "text" | "video";

/** 一条源记录：源 → 产物映射 + 内容哈希 + 分析时间。 */
export interface SourceRecord {
  /** 库相对路径。 */
  path: string;
  /** 源类型：文本或视频（决定 ingest 路径）。 */
  kind: SourceKind;
  /** 源内容 SHA-256（小写 hex）。 */
  sha256: string;
  /** 文件大小（字节）。 */
  size: number;
  /** 最近一次分析完成时间（ISO）。 */
  analyzedAt: string;
  /** 产物目录（库相对路径）；文本源为 null（产物即源本身）。 */
  artifact: string | null;
}

/** 机器索引顶层结构。 */
export interface MachineIndex {
  version: 1;
  sources: SourceRecord[];
}

const FIELDS = ["path", "kind", "sha256", "size", "analyzedAt", "artifact"] as const;
type Field = (typeof FIELDS)[number];
const ITEM_RE = /^  - ([a-zA-Z]+): (.*)$/;
const CONT_RE = /^    ([a-zA-Z]+): (.*)$/;

function unquote(raw: string): string | null {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return null;
  const inner = raw.slice(1, -1);
  if (/[^\\]"/.test(inner.replace(/\\./g, ""))) return null;
  return inner.replace(/\\(\\|")/g, "$1");
}

function parseValue(field: Field, raw: string): string | number | null | undefined {
  if (field === "artifact" && raw === "null") return null;
  if (field === "size") {
    if (!/^\d+$/.test(raw)) return undefined;
    return Number(raw);
  }
  if (field === "kind") return raw === "text" || raw === "video" ? raw : undefined;
  return unquote(raw); // path / sha256 / analyzedAt：未引号 → undefined
}

export function parseMachineIndex(text: string): MachineIndex | null {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return null;
  const version = lines[0].match(/^version: (\d+)$/);
  if (!version || Number(version[1]) !== 1) return null;
  const rest = lines.slice(1);
  if (rest.length === 0) return { version: 1, sources: [] };
  if (rest[0] === "sources: []") return rest.length === 1 ? { version: 1, sources: [] } : null;
  if (rest[0] !== "sources:") return null;

  const sources: SourceRecord[] = [];
  let current: Partial<Record<Field, string | number | null>> | null = null;
  const seen = new Set<Field>();
  const flush = (): boolean => {
    if (current === null) return true;
    if (seen.size !== FIELDS.length) return false;
    sources.push(current as unknown as SourceRecord);
    return true;
  };
  for (const line of rest.slice(1)) {
    const item = line.match(ITEM_RE);
    if (item) {
      if (!flush()) return null;
      current = {};
      seen.clear();
      var m: RegExpMatchArray | null = item;
    } else {
      m = line.match(CONT_RE);
      if (!m || current === null) return null;
    }
    const key = m![1] as Field;
    if (!FIELDS.includes(key) || seen.has(key)) return null;
    const value = parseValue(key, m![2]);
    if (value === undefined) return null;
    seen.add(key);
    current![key] = value;
  }
  if (!flush()) return null;
  return { version: 1, sources };
}

export function serializeMachineIndex(index: MachineIndex): string;`——`parse(serialize(x))` 恒等。
  - Task 5 消费全部类型。

- [ ] **Step 1: 写失败的测试**

`tests/app-wiki-index-yaml.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { parseMachineIndex, serializeMachineIndex, type MachineIndex } from "../src/plugins/app-wiki/index-yaml";

const sample: MachineIndex = {
  version: 1,
  sources: [
    { path: "courses/rust/ownership.md", kind: "text", sha256: "ab".repeat(32), size: 123, analyzedAt: "2026-10-18T12:00:00+08:00", artifact: null },
    { path: "courses/rust/borrow.mp4", kind: "video", sha256: "cd".repeat(32), size: 9_000_000, analyzedAt: "2026-10-18T13:00:00+08:00", artifact: ".study-wiki/raw/courses/rust/borrow" },
  ],
};

describe("machine index yaml 子集", () => {
  it("serialize/parse 恒等", () => {
    expect(parseMachineIndex(serializeMachineIndex(sample))).toEqual(sample);
  });

  it("字段齐全的单源最小文件", () => {
    const text = [
      "version: 1",
      "sources:",
      '  - path: "a.md"',
      "    kind: text",
      '    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"',
      "    size: 0",
      '    analyzedAt: "2026-10-18T00:00:00+08:00"',
      "    artifact: null",
      "",
    ].join("\n");
    expect(parseMachineIndex(text)).toEqual({
      version: 1,
      sources: [{ path: "a.md", kind: "text", sha256: "e3b0…b855", size: 0, analyzedAt: "2026-10-18T00:00:00+08:00", artifact: null }],
    });
  });

  it.each([
    ["version 缺失", 'sources:\n  - path: "a"\n'],
    ["version 非 1", "version: 2\nsources: []\n"],
    ["未知顶层键", "version: 1\nbogus: 1\nsources: []\n"],
    ["列表缩进错", 'version: 1\nsources:\n - path: "a"\n'],
    ["未知字段键", 'version: 1\nsources:\n  - path: "a"\nwat: 1\n'],
    ["未引号字符串", "version: 1\nsources:\n  - path: a.md\n"],
    ["kind 越界", 'version: 1\nsources:\n  - path: "a"\n    kind: doc\n'],
    ["size 非整数", 'version: 1\nsources:\n  - path: "a"\n    size: 1.5\n'],
  ])("损坏输入 → null：%s", (_name, text) => {
    expect(parseMachineIndex(text)).toBeNull();
  });

  it("空 sources 合法", () => {
    expect(parseMachineIndex("version: 1\nsources: []\n")).toEqual({ version: 1, sources: [] });
    expect(parseMachineIndex("version: 1\nsources:\n")).toEqual({ version: 1, sources: [] });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/app-wiki-index-yaml.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `index-yaml.ts`**

```ts
/** 机器索引 `.study-wiki/index.yaml` 的受限 yaml 子集解析/序列化。
 * 设计约束：不引 yaml 依赖；本插件独占读写；解析失败一律返回 null（调用方
 * 视为损坏、从产物证据重建）。受法子集：顶层 `version: <int>` 与 `sources:`
 * 列表；列表项为 `- key: value` 起头 + 4 空格续行的扁平标量；字符串必须双引号
 * （内部 `\"` 转义），数字为整数，`artifact` 允许 `null`。 */

export type SourceKind = "text" | "video";

/** 一条源记录：源 → 产物映射 + 内容哈希 + 分析时间。 */
export interface SourceRecord {
  /** 库相对路径。 */
  path: string;
  /** 源类型：文本或视频（决定 ingest 路径）。 */
  kind: SourceKind;
  /** 源内容 SHA-256（小写 hex）。 */
  sha256: string;
  /** 文件大小（字节）。 */
  size: number;
  /** 最近一次分析完成时间（ISO）。 */
  analyzedAt: string;
  /** 产物目录（库相对路径）；文本源为 null（产物即源本身）。 */
  artifact: string | null;
}

/** 机器索引顶层结构。 */
export interface MachineIndex {
  version: 1;
  sources: SourceRecord[];
}

const FIELDS = ["path", "kind", "sha256", "size", "analyzedAt", "artifact"] as const;
type Field = (typeof FIELDS)[number];

export function parseMachineIndex(text: string): MachineIndex | null {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return null;
  const version = lines[0].match(/^version: (\d+)$/);
  if (!version || Number(version[1]) !== 1) return null;
  const rest = lines.slice(1);
  if (rest.length === 0) return { version: 1, sources: [] };
  if (rest[0] === "sources: []") return rest.length === 1 ? { version: 1, sources: [] } : null;
  if (rest[0] !== "sources:") return null;
  const sources: SourceRecord[] = [];
  let current: Partial<Record<Field, string>> | null = null;
  const flush = () => {
    if (current === null) return;
    const rec = {} as Record<Field, unknown>;
    for (const f of FIELDS) {
      if (!(f in current)) { sources.length = 0; sources.push({} as never); return; }
      rec[f] = current[f];
    }
    // 校验与定型在下方统一做；先收集原始串。
    (current as { __raw?: Record<Field, string> }).__raw = { ...(current as Record<Field, string>) };
  };
  // —— 实际实现建议两遍扫描：先切分条目，再逐条定型，遇错即 null ——
  void flush; void current;
  return parseSources(rest.slice(1));
}

function parseSources(lines: string[]): MachineIndex | null { /* 见下 */ return null; }
```

（上面骨架展示形状；最终单遍实现：逐行匹配 `^  - ([a-zA-Z]+): (.*)$` 开新条目、`^    ([a-zA-Z]+): (.*)$` 续行；键必须在 FIELDS 内且每键至多一次；条目齐全后定型：`path`/`sha256`/`analyzedAt` 双引号剥转义、`kind ∈ {text,video}`、`size` 十进制整数、`artifact` 双引号或 `null`。任何一步不符返回 null。）

```ts
export function serializeMachineIndex(index: MachineIndex): string {
  const q = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const lines = [`version: ${index.version}`, "sources:"];
  for (const s of index.sources) {
    lines.push(`  - path: ${q(s.path)}`);
    lines.push(`    kind: ${s.kind}`);
    lines.push(`    sha256: ${q(s.sha256)}`);
    lines.push(`    size: ${s.size}`);
    lines.push(`    analyzedAt: ${q(s.analyzedAt)}`);
    lines.push(`    artifact: ${s.artifact === null ? "null" : q(s.artifact)}`);
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/app-wiki-index-yaml.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/plugins/app-wiki/index-yaml.ts tests/app-wiki-index-yaml.test.ts
git commit -m "feat: 机器索引受限 yaml 子集编解码（#31）"
```

### Task 5: app-wiki 状态机 + probe 缓存 + reconcile

**Files:**
- Create: `src/plugins/app-wiki/state.ts`
- Test: `tests/app-wiki-state.test.ts`

**Interfaces:**
- Consumes: `ProbeSample`（`src/host/files.ts`）、Task 4 全部类型。
- Produces:
  - `export type SourceState = { state: "unknown" } | { state: "fresh"; record: SourceRecord } | { state: "stale"; record: SourceRecord; sample: ProbeSample } | { state: "moved"; record: SourceRecord; sample: ProbeSample };`
  - `export function classifySource(index: MachineIndex | null, relPath: string, sample: ProbeSample): SourceState;`——判定序：path 命中且 sha256 同 → fresh；path 命中 sha256 异 → stale；path 未命中、sha256 反查命中他路径 → moved；否则 unknown。
  - `export function createProbeCache(): { get(path: string, fresh: ProbeSample): ProbeSample; invalidate(): void; }`——内部 `Map<path, ProbeSample>`，`get` 以 `fresh.size+mtimeMs` 校验命中（命中返回缓存 sha256，否则存入并返回 fresh）。
  - `export interface ArtifactEvidence { source: string; newestArtifactMtimeMs: number; }`——`source` 为库相对源路径。
  - `export function reconcileIndex(prev: MachineIndex | null, evidence: ArtifactEvidence[], probed: Map<string, ProbeSample>): MachineIndex;`——行存在 ⇔ 证据存在；`analyzedAt` 取证据 newestArtifactMtimeMs（ISO）；probed 提供 sha256/size；moved（证据 source ≠ 旧行 path 且 probed sha256 同旧行）保留 artifact 只改 path。
  - Task 7 消费全部。

- [ ] **Step 1: 写失败的测试**

`tests/app-wiki-state.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { classifySource, createProbeCache, reconcileIndex, type MachineIndex } from "../src/plugins/app-wiki/state";
import type { ProbeSample } from "../src/host/files";

const rec = (path: string, sha256 = "aa".repeat(32), artifact: string | null = null) =>
  ({ path, kind: "text" as const, sha256, size: 10, analyzedAt: "2026-10-18T12:00:00+08:00", artifact });

const sample = (sha256 = "aa".repeat(32), mtimeMs = 1000): ProbeSample =>
  ({ size: 10, mtimeMs, sha256 });

describe("classifySource 判定序", () => {
  const index: MachineIndex = { version: 1, sources: [rec("a.md"), rec("old/b.md", "bb".repeat(32))] };

  it("path 命中且 sha256 一致 → fresh", () => {
    expect(classifySource(index, "a.md", sample())).toEqual({ state: "fresh", record: rec("a.md") });
  });

  it("path 命中 sha256 不一致 → stale", () => {
    const s = sample("cc".repeat(32));
    expect(classifySource(index, "a.md", s)).toEqual({ state: "stale", record: rec("a.md"), sample: s });
  });

  it("path 未命中、sha256 反查命中 → moved", () => {
    const s = sample("bb".repeat(32));
    expect(classifySource(index, "new/b.md", s)).toEqual({ state: "moved", record: rec("old/b.md", "bb".repeat(32)), sample: s });
  });

  it("均未命中 → unknown；索引 null 同", () => {
    expect(classifySource(index, "x.md", sample())).toEqual({ state: "unknown" });
    expect(classifySource(null, "x.md", sample())).toEqual({ state: "unknown" });
  });
});

describe("probeCache", () => {
  it("size+mtimeMs 命中返回缓存 sha256；失配更新", () => {
    const cache = createProbeCache();
    const first = cache.get("/lib/a.md", sample("aa".repeat(32), 1000));
    expect(first.sha256).toBe("aa".repeat(32));
    // 调用方（probe 命令快路径）已保证元数据一致，这里直接给同 mtime 新样本：
    expect(cache.get("/lib/a.md", { size: 10, mtimeMs: 1000, sha256: "ignored" }).sha256).toBe("aa".repeat(32));
    expect(cache.get("/lib/a.md", { size: 10, mtimeMs: 2000, sha256: "dd".repeat(32) }).sha256).toBe("dd".repeat(32));
    cache.invalidate();
    expect(cache.get("/lib/a.md", { size: 10, mtimeMs: 2000, sha256: "ee".repeat(32) }).sha256).toBe("ee".repeat(32));
  });
});

describe("reconcileIndex", () => {
  it("证据存在的源才有行；analyzedAt 取产物最新 mtime", () => {
    const iso = new Date(5000).toISOString();
    const out = reconcileIndex(null, [{ source: "a.md", newestArtifactMtimeMs: 5000 }],
      new Map([["a.md", sample()]]));
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0]).toMatchObject({ path: "a.md", sha256: "aa".repeat(32), analyzedAt: iso });
    expect(out.sources[0].artifact).toBeNull();
  });

  it("证据消失的行被丢弃（产物即真值）", () => {
    const prev: MachineIndex = { version: 1, sources: [rec("gone.md")] };
    expect(reconcileIndex(prev, [], new Map()).sources).toEqual([]);
  });

  it("moved：证据路径与旧行不同且 sha256 同 → 保留 artifact 只改 path", () => {
    const prev: MachineIndex = { version: 1, sources: [{ ...rec("old/b.md", "bb".repeat(32)), artifact: ".study-wiki/raw/old/b" }] };
    const out = reconcileIndex(prev, [{ source: "new/b.md", newestArtifactMtimeMs: 9000 }],
      new Map([["new/b.md", sample("bb".repeat(32))]]));
    expect(out.sources[0].path).toBe("new/b.md");
    expect(out.sources[0].artifact).toBe(".study-wiki/raw/old/b");
    expect(out.sources[0].sha256).toBe("bb".repeat(32));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/app-wiki-state.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `state.ts`**

```ts
/** 源状态机与机器索引 reconcile：纯函数，无 IO，vitest 主战场。 */
import type { ProbeSample } from "../../host/files";
import { parseMachineIndex, serializeMachineIndex, type MachineIndex, type SourceRecord } from "./index-yaml";
export { parseMachineIndex, serializeMachineIndex };
export type { MachineIndex, SourceRecord };

/** 源分析状态：unknown（无产物/无记录）、fresh、stale（源已变更）、moved（源迁址）。 */
export type SourceState =
  | { state: "unknown" }
  | { state: "fresh"; record: SourceRecord }
  | { state: "stale"; record: SourceRecord; sample: ProbeSample }
  | { state: "moved"; record: SourceRecord; sample: ProbeSample };

export function classifySource(index: MachineIndex | null, relPath: string, sample: ProbeSample): SourceState {
  const byPath = index?.sources.find((r) => r.path === relPath);
  if (byPath) {
    return byPath.sha256 === sample.sha256
      ? { state: "fresh", record: byPath }
      : { state: "stale", record: byPath, sample };
  }
  const byHash = index?.sources.find((r) => r.sha256 === sample.sha256);
  if (byHash) return { state: "moved", record: byHash, sample };
  return { state: "unknown" };
}

/** probe 缓存：path → 样本；get 以 size+mtimeMs 校验，命中省哈希（靠命令快路径）。 */
export function createProbeCache() {
  const map = new Map<string, ProbeSample>();
  return {
    /** 返回可信样本：fresh 元数据命中缓存时返回缓存 sha256，否则存 fresh 并返回。 */
    get(path: string, fresh: ProbeSample): ProbeSample {
      const hit = map.get(path);
      if (hit && hit.size === fresh.size && hit.mtimeMs === fresh.mtimeMs) return hit;
      map.set(path, fresh);
      return fresh;
    },
    /** 全量失效（换库根等场景）。 */
    invalidate() { map.clear(); },
  };
}

/** 产物证据：某源有已分析产物；newestArtifactMtimeMs 为产物最新 mtime（Unix 毫秒）。 */
export interface ArtifactEvidence {
  /** 库相对源路径。 */
  source: string;
  /** 产物最新 mtime（Unix 毫秒），转为 analyzedAt。 */
  newestArtifactMtimeMs: number;
}

/** 物化规则：行存在 ⇔ 证据存在；probed 缺哈希的行保留旧值；moved 保留 artifact 只改 path。 */
export function reconcileIndex(prev: MachineIndex | null, evidence: ArtifactEvidence[], probed: Map<string, ProbeSample>): MachineIndex {
  const sources: SourceRecord[] = evidence.map((ev) => {
    const old = prev?.sources.find((r) => r.path === ev.source) ?? prev?.sources.find((r) => probed.get(ev.source)?.sha256 === r.sha256);
    const p = probed.get(ev.source);
    const moved = old !== undefined && old.path !== ev.source;
    return {
      path: ev.source,
      kind: old?.kind ?? kindFromPath(ev.source),
      sha256: p?.sha256 ?? old?.sha256 ?? "",
      size: p?.size ?? old?.size ?? 0,
      analyzedAt: new Date(ev.newestArtifactMtimeMs).toISOString(),
      artifact: moved ? (old?.artifact ?? null) : (old?.artifact ?? null),
    };
  });
  return { version: 1, sources };
}

const VIDEO_EXT = new Set(["mp4", "mkv", "avi", "mov", "webm"]);

/** 按扩展名推断源类型：已知视频扩展名 → video，其余按 text（m2 文本闭环）。 */
export function kindFromPath(relPath: string): SourceRecord["kind"] {
  const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXT.has(ext) ? "video" : "text";
}
```

（注：`artifact` 两行相同是有意的——moved 与否 artifact 都继承旧行；probed 缺哈希且旧行也缺（不该发生）时留空串，调用方以证据为真值重建。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/app-wiki-state.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/plugins/app-wiki/state.ts tests/app-wiki-state.test.ts
git commit -m "feat: 源状态机判定序与机器索引 reconcile（#31）"
```

### Task 6: app-wiki schema 常量

**Files:**
- Create: `src/plugins/app-wiki/schema.ts`
- Test: `tests/app-wiki-schema.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: `export const WIKI_SCHEMA_VERSION = 1;`、`export const WIKI_SCHEMA: string;`——LLM 维护契约全文，注入 system prompt（Task 7），≤ 6000 字符。

- [ ] **Step 1: 写失败的测试**

`tests/app-wiki-schema.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { WIKI_SCHEMA, WIKI_SCHEMA_VERSION } from "../src/plugins/app-wiki/schema";

describe("wiki schema", () => {
  it("版本与体积预算", () => {
    expect(WIKI_SCHEMA_VERSION).toBe(1);
    expect(WIKI_SCHEMA.length).toBeLessThanOrEqual(6000);
  });

  it("覆盖三流程与关键纪律", () => {
    for (const kw of ["ingest", "query", "lint", "frontmatter", "主题对照", "[[wikilink]]", "log.md", "index.md", "不要手改", "视频源"]) {
      expect(WIKI_SCHEMA).toContain(kw);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/app-wiki-schema.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `schema.ts`（模板定稿，实施时可微调措辞但保持结构与预算）**

````ts
/** llm-wiki 维护契约（schema v1）：插件持有的行为契约，经 prompt 贡献缝注入。
 * 设计约束：改 schema 即改 LLM 行为，不改代码；≤ 6000 字符（token 预算）；库内不复制本文件。 */
export const WIKI_SCHEMA_VERSION = 1;

export const WIKI_SCHEMA = `# llm-wiki 维护契约（schema v1）

你是本学习库的 llm-wiki 维护者：你读 wiki，也写 wiki；用户只读（除非明确要求参与）。

## 结构约定
- 库根下 \`.study-wiki/llm-wiki/\` 是你全权维护的 wiki 层；\`.study-wiki/index.yaml\` 与 \`.study-wiki/raw/\` 是程序维护的，绝对不要手改。
- wiki 层布局：\`index.md\`（内容目录，每次操作后更新）、\`log.md\`（只追加的操作日志）、\`overview.md\`（全局综合判断）、\`sources/\`（每源一页）、\`concepts/\`、\`entities/\`。
- 每个 wiki 页必须有 YAML frontmatter：
  ---
  title: 页面标题
  type: source | concept | entity
  source: 源库相对路径（仅 source 页必填）
  created: YYYY-MM-DD
  updated: YYYY-MM-DD
  confidence: high | medium | low
  related: ["其他页路径或 [[wikilink]]"]
  ---
- 页间交叉引用用 [[wikilink]]；sources 页路径按 \`<源相对路径去扩展名>.md\` 嵌套镜像（如 \`sources/courses/rust/ownership.md\`）。

## sources 页必备两节
1. \`## 摘要\`：3-8 句精炼摘要。
2. \`## 主题对照\`：主题 ↔ 位置对照表。文本源用章节/行号区间；视频源（m3 起）用时间戳区间，数据来自 \`.study-wiki/raw/<源>/topics.md\`（存在时）。格式 \`| 主题 | 位置 |\`，位置如 \`L12-L48\` 或 \`00:03:20-00:07:45\`。

## ingest 流程（用户要求分析某源时）
1. 确认源状态（活动文件或用户指定路径）；程序提示会说明未分析/已过期。
2. 通读源（大文件分段 read）。
3. 与用户确认要点（用户赶时间可直接做，做完汇报）。
4. 建/更新 sources 页（含主题对照）。
5. 更新相关 concepts/entities 页（新页带完整 frontmatter）。
6. 更新 index.md（目录反映全部页面）；log.md 追加一行：时间、动作、涉及页。
7. 汇报：改了哪些页、新增哪些概念、有哪些矛盾存疑。

## query 流程（用户提问时）
1. 先读 \`llm-wiki/index.md\` 定位相关页；时间戳问题先查对应 sources 页的主题对照节。
2. 读相关页（必要时含 \`.study-wiki/raw/\` 下的 transcript/topics）。
3. 作答带 [[wikilink]] 引用；wiki 未覆盖时明说「wiki 未覆盖，基于原文回答」，事后提议 ingest。
4. 有价值的结论主动提议归档为新页/更新旧页，经用户确认再写。

## lint 流程（用户说 lint / 检查时）
1. 页面间矛盾（同一概念多处表述冲突）。
2. 孤儿页：无任何入链的页。
3. 被多页提及但没有独立页的概念（候选新概念）。
4. 被新来源取代的过时结论（结合 log.md 与 frontmatter 的 updated）。
5. index.md 与实际页面列表的不一致。
6. 输出问题清单 + 建议修复顺序；只修用户点头的项。

## 视频源（m3 前）
视频源暂无转录能力：只报告状态，不伪造内容；可建议用户先记笔记或等待转录里程碑。

## 纪律
- 写 wiki 页用 write/edit 工具，目标路径必须在 \`.study-wiki/llm-wiki/\` 内（write 会自动建目录）。
- 不修改 \`.study-wiki/index.yaml\`、\`.study-wiki/raw/\` 与库内原文。
- 不确定的信息标 confidence: low，不编造。
`;
````

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/app-wiki-schema.test.ts`
Expected: PASS（含体积预算）。

- [ ] **Step 5: Commit**

```bash
git add src/plugins/app-wiki/schema.ts tests/app-wiki-schema.test.ts
git commit -m "feat: llm-wiki schema v1 契约常量（#31）"
```

### Task 7: app-wiki service + 插件入口 + 注册

**Files:**
- Create: `src/plugins/app-wiki/service.ts`
- Create: `src/plugins/app-wiki/index.ts`
- Modify: `src/host/context.d.ts`（`wiki: WikiService` 声明）
- Modify: `src/loader/table.ts`（`app-wiki` 行）
- Test: `tests/app-wiki-service.test.ts`

**Interfaces:**
- Consumes: Task 1 `FilesService.probeSourceFile/readText/writeText/readTree`、Task 3 `PromptSectionProvider`（经 `ctx.agent.registerPromptSection`）、Task 4/5 全部、`WorkspaceFacade.root/activeFile/events`。
- Produces:
  - `export interface WikiService { sourceState(relPath: string): Promise<SourceState>; contextSection(input: PromptSectionInput): Promise<string | null>; }`（service.ts，方法带文档注释）
  - `export function createWikiService(deps: { files: FilesService; workspace: WorkspaceFacade }): WikiService;`
  - `export const name = "app-wiki"; export const inject = ["agent", "files", "workspace"]; export function apply(ctx: Context): () => void;`（index.ts，cordis 内置插件形态对齐 agent-core）
  - `ctx.wiki: WikiService`（context.d.ts 声明合并，注释注明内置插件 app-wiki 提供）。

- [ ] **Step 1: 写失败的测试**

`tests/app-wiki-service.test.ts`（假 files：内存 Map + 可编程 probeSourceFile；假 workspace：root/activeFile/events）：

```ts
import { describe, expect, it } from "vitest";
import { createWikiService } from "../src/plugins/app-wiki/service";
import type { FilesService, ProbeSample } from "../src/host/files";
import type { WorkspaceFacade } from "../src/host/workspace";
import { WIKI_SCHEMA } from "../src/plugins/app-wiki/schema";

function fakeWikiHost(opts: {
  root?: string | null;
  files?: Record<string, string>;
  activePath?: string | null;
  probe?: (path: string) => ProbeSample;
}) {
  const files = new Map(Object.entries(opts.files ?? {}));
  const probeImpl = opts.probe ?? (() => ({ size: 10, mtimeMs: 1000, sha256: "aa".repeat(32) }));
  const filesSvc = {
    readText: async (p: string) => { const v = files.get(p); if (v === undefined) throw new Error("ENOENT"); return v; },
    writeText: async (p: string, c: string) => { files.set(p, c); },
    readTree: async (root: string) => [...files.keys()].filter((p) => p.startsWith(root + "/")).map((p) => ({ name: p.split("/").pop()!, path: p, kind: "markdown" as const })),
    probeSourceFile: async (path: string) => probeImpl(path),
  } as unknown as FilesService;
  const listeners = new Set<(f: unknown) => void>();
  const workspace = {
    get root() { return opts.root ?? "/lib"; },
    get activeFile() { return opts.activePath ? { name: "x", path: opts.activePath, kind: "markdown" } : null; },
    events: { on: (_c: string, l: (f: unknown) => void) => { listeners.add(l); return () => listeners.delete(l); }, emit: (f: unknown) => [...listeners].forEach((l) => l(f)) },
    openFile: async () => true,
    guardSwitch: () => () => {},
  } as unknown as WorkspaceFacade;
  return { filesSvc, workspace, files };
}

const WIKI_INDEX = "/lib/.study-wiki/llm-wiki/index.md";

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
    // 首次探测物化索引
    expect((await wiki.sourceState("notes/a.md")).state).toBe("unknown");
  });

  it("已分析（产物页存在）→ fresh 且注入 index 头", async () => {
    const { filesSvc, workspace } = fakeWikiHost({
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
    expect((await wiki.sourceState("notes/a.md")).state).toBe("fresh");
  });

  it("索引损坏 → 从证据重建，fresh 不丢", async () => {
    const { filesSvc, workspace, files } = fakeWikiHost({
      activePath: "/lib/notes/a.md",
      files: {
        "/lib/.study-wiki/index.yaml": "garbage: [\n",
        "/lib/.study-wiki/llm-wiki/sources/notes/a.md": "---\ntype: source\n---\n# A",
      },
    });
    const wiki = createWikiService({ files: filesSvc, workspace });
    await wiki.contextSection({ root: "/lib", activeFilePath: "/lib/notes/a.md" });
    expect(files.get("/lib/.study-wiki/index.yaml")).toContain("notes/a.md");
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
    expect(section).not.toContain("活动文件");
  });

  it("index 头超预算截断（标记包裹，可独立量长）", async () => {
    const { filesSvc, workspace } = fakeWikiHost({
      activePath: "/lib/notes/a.md",
      files: {
        [WIKI_INDEX]: "# 目录\n" + Array.from({ length: 200 }, (_, i) => `- 第 ${i} 条`).join("\n"),
        "/lib/.study-wiki/llm-wiki/sources/notes/a.md": "---\ntype: source\n---\n# A",
      },
    });
    const wiki = createWikiService({ files: filesSvc, workspace });
    const section = (await wiki.contextSection({ root: "/lib", activeFilePath: "/lib/notes/a.md" }))!;
    const m = section.match(/# llm-wiki index 头部\n([\s\S]*?)\n\n# llm-wiki 维护契约/);
    expect(m).not.toBeNull();
    expect(m![1].length).toBeLessThanOrEqual(4096 + "…（截断）".length + 1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run tests/app-wiki-service.test.ts`
Expected: FAIL（service 不存在）。

- [ ] **Step 3: 实现 `service.ts` 与 `index.ts`**

`service.ts` 核心逻辑（展示关键决策代码；完整实现含文档注释）：

```ts
import type { FilesService } from "../../host/files";
import type { WorkspaceFacade } from "../../host/workspace";
import type { PromptSectionInput } from "../agent-core/service";
import { WIKI_SCHEMA } from "./schema";
import {
  classifySource, createProbeCache, reconcileIndex,
  parseMachineIndex, serializeMachineIndex,
  type ArtifactEvidence, type SourceState,
} from "./state";

const SOURCES_DIR = ".study-wiki/llm-wiki/sources";
const RAW_DIR = ".study-wiki/raw";
const INDEX_YAML = ".study-wiki/index.yaml";
const HEAD_LINE_BUDGET = 80;
const HEAD_CHAR_BUDGET = 4096;

/** wiki 知识层服务：源状态判定与 prompt 贡献段。 */
export interface WikiService {
  /** 某库相对路径源的分析状态（内部先物化索引再判定）。 */
  sourceState(relPath: string): Promise<SourceState>;
  /** prompt 贡献段：wiki 未初始化且无库内活动文件时返回 null。 */
  contextSection(input: PromptSectionInput): Promise<string | null>;
  /** 失效 probe 缓存与根记忆（换库根/活动文件切换时由事件触发）。 */
  invalidate(): void;
}

/** 组装 wiki 服务。 */
export function createWikiService(deps: { files: FilesService; workspace: WorkspaceFacade }): WikiService {
  const cache = createProbeCache();
  let lastRoot: string | null = null;

  async function probeAbs(abs: string) {
    const cached = /* 从 cache 取上次样本作 known */ peek(cache, abs);
    const fresh = await deps.files.probeSourceFile(abs, cached);
    return cache.get(abs, fresh);
  }

  /** 收集产物证据：sources 页（.md）。页是小文件，直接 probe 取 mtime 作
   * analyzedAt；raw/ 产物证据 m3 接入（视频转录落地时扩展本函数）。 */
  async function collectEvidence(root: string): Promise<ArtifactEvidence[]> {
    const evidence = new Map<string, number>();
    try {
      for (const node of await deps.files.readTree(`${root}/${SOURCES_DIR}`)) {
        if (!node.path.endsWith(".md")) continue;
        const rel = node.path.slice(`${root}/${SOURCES_DIR}/`.length, -".md".length);
        const source = await resolveSourceFromPage(root, node.path, rel);
        const sample = await probeAbs(node.path); // 小文件，哈希成本可忽略
        evidence.set(source, Math.max(evidence.get(source) ?? 0, sample.mtimeMs));
      }
    } catch { /* sources 目录不存在 → 无证据 */ }
    return [...evidence.entries()].map(([source, mtime]) => ({ source, newestArtifactMtimeMs: mtime }));
  }

  async function refresh(root: string): Promise<void> {
    if (lastRoot !== root) { cache.invalidate(); lastRoot = root; }
    const evidence = await collectEvidence(root);
    const probed = new Map<string, ProbeSample>();
    for (const ev of evidence) {
      probed.set(ev.source, await probeAbs(`${root}/${ev.source}`));
    }
    const prevText = await deps.files.readText(`${root}/${INDEX_YAML}`).catch(() => null);
    const prev = prevText === null ? null : parseMachineIndex(prevText);
    const next = reconcileIndex(prev, evidence, probed);
    const serialized = serializeMachineIndex(next);
    if (serialized !== prevText) await deps.files.writeText(`${root}/${INDEX_YAML}`, serialized);
  }

  async function contextSection(input: PromptSectionInput): Promise<string | null> {
    const root = deps.workspace.root;
    if (root === null) return null;
    await refresh(root);
    const indexText = await deps.files.readText(`${root}/${INDEX_YAML}`).catch(() => null);
    const index = indexText === null ? null : parseMachineIndex(indexText);
    const initialized = await deps.files.readText(`${root}/${SOURCES_DIR}/../index.md`).then(() => true, () => false);

    const rel = toRel(root, input.activeFilePath);
    const parts: string[] = [];
    if (rel !== null) {
      const st = classifySource(index, rel, await probeAbs(`${root}/${rel}`));
      parts.push(stateLine(st, rel));
      if (st.state === "moved") {
        // 重指：该行进 path/大小/哈希，artifact 与 analyzedAt 不动。
        const rewritten = index!.sources.map((r) => r.path === st.record.path
          ? { ...r, path: rel, sha256: st.sample.sha256, size: st.sample.size }
          : r);
        await deps.files.writeText(`${root}/${INDEX_YAML}`, serializeMachineIndex({ version: 1, sources: rewritten }));
      }
    }
    if (initialized) {
      const head = await boundedHead(root);
      if (head) parts.push(head);
    } else if (rel === null) {
      return null; // 未初始化且无活动文件：零成本
    }
    parts.push(WIKI_SCHEMA);
    return parts.join("\n\n");
  }

  return {
    sourceState: async (relPath) => {
      const root = deps.workspace.root;
      if (root === null) return { state: "unknown" };
      await refresh(root);
      const text = await deps.files.readText(`${root}/${INDEX_YAML}`).catch(() => null);
      const index = text === null ? null : parseMachineIndex(text);
      return classifySource(index, relPath, await probeAbs(`${root}/${relPath}`));
    },
    contextSection,
    invalidate() { cache.invalidate(); lastRoot = null; },
  };
}
```

（`peek` 从 cache 取上次样本作 known 传入 probe（快路径）；`toRel` 判前缀防库外（库外返回 null）；`stateLine` 输出中文状态行——fresh 给 sources 页路径、stale 提示重新 ingest、unknown 文本给「尚未分析」、unknown 视频给「转录能力后续里程碑」；`boundedHead` 取 index.md 前 80 行/4 KiB 小者，以 `# llm-wiki index 头部` 与 schema 标题作为分隔标记，超限加 `…（截断）`（Task 7 截断测试按标记正则量长）；`resolveSourceFromPage` 读页 frontmatter `source:` 字段，缺省 `rel + ".md"`（m2 文本闭环；视频页 m3 用显式 source 字段）。所有读盘失败按「不存在」处理，绝不抛出。）

`index.ts`（对齐 agent-core 形态）：

```ts
import type { Context } from "cordis";
import { createWikiService } from "./service";

/** Plugin id in the manifest and the static module table. */
export const name = "app-wiki";
/** Service keys awaited before apply runs. */
export const inject = ["agent", "files", "workspace"];

/** Publish the wiki knowledge layer as `ctx.wiki`; register the prompt section.
 * @param ctx Host context with the three injected services.
 * @returns Disposer used by cordis lifecycle teardown. */
export function apply(ctx: Context): () => void {
  const wiki = createWikiService({ files: ctx.files, workspace: ctx.workspace });
  ctx.reflect.provide("wiki", wiki);
  const unregister = ctx.agent.registerPromptSection("wiki", (input) => wiki.contextSection(input));
  const offRoot = ctx.workspace.events.on("root-changed", () => void wiki.invalidate?.());
  const offFile = ctx.workspace.events.on("file-opened", () => void wiki.invalidate?.());
  return () => { offRoot(); offFile(); unregister(); };
}
```

（缓存失效封装进 `WikiService.invalidate()` 公开方法，`sourceState/contextSection` 文档注明；`createProbeCache` 的 `invalidate` 暴露透传。）

`context.d.ts` 加：

```ts
import type { WikiService } from "../plugins/app-wiki/service";
// ……declare module 内：
/** wiki 知识层服务（内置插件 app-wiki 提供；外置插件 guard 白名单不含）。 */
wiki: WikiService;
```

`table.ts`：`import * as appWiki from "../plugins/app-wiki";` + 表内 `"app-wiki": { plugin: appWiki as PluginModule, defaults: {} },`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run tests/app-wiki-service.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/plugins/app-wiki/service.ts src/plugins/app-wiki/index.ts src/host/context.d.ts src/loader/table.ts tests/app-wiki-service.test.ts
git commit -m "feat: app-wiki 插件与 prompt 贡献段注册（#31）"
```

### Task 8: 机械面、文档与流程收尾

**Files:**
- Modify: `docs/architecture.md`（组成树 + llm-wiki 一节，词数预算 1100 内腾挪）
- Modify: `docs/architecture.en.md` + `docs/architecture.i18n.yaml`（三件套最小同步，`pnpm record:i18n -- docs/architecture.md`）
- Modify: `.agents/flow/issues/m2-04-llm-wiki.{md,en.md,i18n.yaml}`（status → in-progress、scope 补 `src-tauri/**`/`scripts/doc-budgets.manifest.json` 等、adr 挂 Note、验收补实测口径）
- Create: `.agents/notes/implemented/architecture/2026-10-18-llm-wiki.{md,en.md,i18n.yaml}`（Agent Note，bilingual 三件套）
- Modify: `scripts/doc-budgets.manifest.json`（若新增常驻文档则登记；本任务不新增则跳过）
- 生成区：`pnpm gen:commands`、`pnpm gen:code-map`

**Interfaces:**
- Consumes: Task 1-7 全部产物。
- Produces: 全绿门禁 + issue #31 三件套 + Note 三件套。

- [ ] **Step 1: 重建生成区**

Run: `pnpm gen:commands && pnpm gen:code-map`
Expected: `docs/commands.md` 出现 `probe_source_file`；code-map 出现 app-wiki。

- [ ] **Step 2: 写 Note 与 issue 更新**

Note（中文侧骨架，英文侧按 `docs/i18n/README.md` 契约最小同步后 `pnpm record:i18n -- <pair>` 重录）：Problem（编译式知识层落地：schema 归插件/贡献缝/派生索引/判定序）→ Decision（六到八条，对齐 spec 的「总体架构」「存储契约」「状态机」）→ Alternatives（引 spec）→ Consequences（m3-03/#34 合并与文案、欠账清单）。

- [ ] **Step 3: 跑全量门禁**

Run: `pnpm test && pnpm verify:layering && pnpm verify:env-independence && pnpm verify:dep-audit && pnpm verify:flow && pnpm verify:commands && pnpm lint:docs && pnpm verify:docs`
Expected: 全绿；任一红按输出修补后重跑（不改门禁本身）。

- [ ] **Step 4: 收尾提交**

```bash
git add -A
git commit -m "docs: llm-wiki 知识层文档/issue/Note 收尾（#31）"
```

## Self-Review 记录

- Spec 覆盖：三层架构/schema 归插件（T3/T6/T7）、存储契约（T4/T5/T7）、状态机与 probe 命令（T1/T5/T7）、prompt 贡献缝（T3/T7）、视频预留（T6 schema 节 + T5 kindFromPath）、moved 重指（T5/T7）、std_write 深路径（T2）、文档门禁（T8）。欠账项（批量审批卡/机械 lint/schema override）按 spec 不进本计划。
- 占位符扫描：无 TBD/TODO；Task 4 的 `parseSources` 占位已在 Step 3 内给出单遍实现要点。
- 类型一致：`ProbeSample` 唯一定义在 `src/host/files.ts`（T1），T5/T7 import 同一类型；`SourceState`/`MachineIndex`/`ArtifactEvidence` 定义在 T4/T5，`service.ts` 同名引用；`registerPromptSection` 签名 T3 定义、T7 消费一致。
- Review Focus 落点：库外/欢迎态 → T7 测；索引损坏 → T4/T7 测；哈希多块与 known 快路径 → T1 测；token 预算 → T6/T7 测；`.study-wiki` 删除 → T7 `collectEvidence` 的 catch + Step 1 测试矩阵补一例（执行时把「`.study-wiki` 整体删除 → null 段」用例补进 `tests/app-wiki-service.test.ts` 再实现）。
