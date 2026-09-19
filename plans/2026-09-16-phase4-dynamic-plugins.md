# Phase 4 动态化装载 + guard 收权 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 外置插件全即时化（重载/启停/安装/移除免重启，本窗生效他窗重启见）+ 持久化版本仓（快照/回滚）+ guard 白名单门面（只包外置）+ fiber 等待式运行期审计 + 动态化文档两件套。

**Architecture:** 版本仓是 `plugins/.history/` 下的 append-only 快照仓（活目录永远是唯一事实源，回滚 = 原子写回 + 热重载）；热路径全部收敛到新增的 `src/loader/activate.ts` 共享激活函数（guard 包装 → ctx.plugin → fiber 等待审计 → 快照），boot 的 ext: 行与面板四动作共用；guard 是 `src/loader/guard.ts` 的 Proxy 门面（dsh cordis-client-runner/guard.ts 移植），只包外置。

**Tech Stack:** Rust（sha2 已在依赖 / std::fs 原子替换复用）、TypeScript/vitest（cordis 真 Context 可测）、既有 blob 装载缝与 cordis fiber 生命周期。

**Spec:** `.agents/notes/proposed/architecture/2026-09-16-phase4-dynamic-plugins.md`（本计划从该 Note 论证；执行者两份都读。注意 Note 与本计划的一处细化差异：parked 态不设独立面板态，2s 审计超时即转失败行，原因文案点名"声明的服务未提供"。）

## Global Constraints

- 环境无关铁律（docs/environment-independence.md 唯一 home）：本阶段**零新增 npm/Rust 依赖**（sha2/base64/serde_json 已在）；全程零新增联网动作；豁免登记不动。
- 分层纪律：`src/plugins/**` 禁值导入 `@tauri-apps/*` 与 `../host`；动态 import 仍只有 `src/loader/external.ts` 一个缝（layering 白名单不动）。
- TS 导出与 Tauri 命令必须带文档注释（契约语义）；改命令后 `pnpm gen:commands` + `pnpm record:i18n -- docs/commands.md`。
- 常驻文档中英成对（三件套）：改任一侧最小修补另一侧并重录；新文档进 `scripts/doc-budgets.manifest.json` 登记预算。
- 提交信息中文 + 正文说明动机；**不加 Co-Authored-By trailer**；每任务单提交。
- 测试即契约：TDD 红-绿；任何既有用例的红先怀疑实现。Rust 测试 fixture 用 `std::env::temp_dir()` 线程隔离（沿用 plugins.rs 既有 `tmp_plugins_dir` 手法）。
- 前端测试用真 cordis Context（tests/cordis-smoke.test.ts 已证可行）；DOM 测试沿用 jsdom 既有手法。
- 面板既有约定：操作失败内联显示（errLine），不静默、不 unhandled rejection；每次操作后整体重渲染。

---

### Task 1: Rust 版本仓命令面 + 宿主服务三方法

**Files:**
- Modify: `src-tauri/src/plugins.rs`（版本仓三函数 + remove 连删历史 + 三命令 + 测试）
- Modify: `src-tauri/src/lib.rs:162-176`（invoke_handler 注册三命令）
- Modify: `src/host/plugins.ts`（PluginVersion 类型 + 三服务方法）
- Modify: `docs/commands.md` + `docs/commands.en.md` + `docs/commands.i18n.yaml`（gen:commands + record 重录）
- Test: `tests/host-plugins.test.ts`

**Interfaces:**
- Produces（Task 4 依赖，签名逐字）：
  - Rust 命令：`snapshot_plugin_version(name: string) -> Option<String>`（新代 id 或 null=内容未变）；`list_plugin_versions(name: string) -> Vec<VersionInfo>`（新到旧）；`restore_plugin_version(name: string, id: string) -> ()`（原子写回活目录）。
  - TS 类型：`PluginVersion { id: string; createdAt: number; version: string | null; apiVersion: number; hash: string; current: boolean }`。
  - PluginsService 方法：`snapshot(name: string): Promise<string | null>`；`listVersions(name: string): Promise<PluginVersion[]>`；`restoreVersion(name: string, id: string): Promise<void>`。
  - 行为变化：`remove_plugin` 连带删除 `.history/<name>`。

- [ ] **Step 1: 写失败测试（Rust，plugins.rs 测试模块追加）**

```rust
fn tmp_history(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("sw-hist-{}-{:?}", tag, std::thread::current().id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn snapshot_dedups_and_prunes() {
    let dir = tmp_history("snap");
    let pkg = package_json("demo", 1, "index.js");
    let extracted = extract_and_validate(&build_tgz(&[
        ("package/package.json", pkg.as_bytes()),
        ("package/index.js", b"export const name='demo'; export function apply(){}"),
    ]))
    .unwrap();
    place_plugin(&dir, &extracted).unwrap();
    // 首次快照产一代，id 含 hash 前缀；同内容再快照返回 None
    let id1 = snapshot_plugin(&dir, "demo").unwrap().expect("首次应产新代");
    assert!(snapshot_plugin(&dir, "demo").unwrap().is_none(), "同内容不增生");
    // 改代码 → 新代；逐代塞满超上限后裁最旧
    for i in 0..11 {
        std::fs::write(dir.join("demo/index.js"), format!("export const name='demo';export const v={i};export function apply(){{}}"))
            .unwrap();
        snapshot_plugin(&dir, "demo").unwrap();
    }
    let gens = list_generations(&dir, "demo").unwrap();
    assert_eq!(gens.len(), 10, "超出 MAX_GENERATIONS 裁最旧");
    assert!(gens[0].created_at >= gens[9].created_at, "新到旧排序");
    assert!(gens[0].current, "首行即活目录内容");
    assert!(!gens.iter().any(|g| g.id == id1), "最早一代已被裁掉");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn restore_writes_back_and_remove_deletes_history() {
    let dir = tmp_history("restore");
    let pkg = package_json("demo", 1, "index.js");
    let v1 = b"export const name='demo';export const v=1;export function apply(){}";
    let extracted = extract_and_validate(&build_tgz(&[
        ("package/package.json", pkg.as_bytes()),
        ("package/index.js", v1),
    ]))
    .unwrap();
    place_plugin(&dir, &extracted).unwrap();
    let id1 = snapshot_plugin(&dir, "demo").unwrap().unwrap();
    std::fs::write(dir.join("demo/index.js"), b"export const name='demo';export const v=2;export function apply(){}").unwrap();
    snapshot_plugin(&dir, "demo").unwrap();
    // 回滚到 v1：活目录内容回到 v1
    restore_generation(&dir, "demo", &id1).unwrap();
    assert_eq!(std::fs::read(dir.join("demo/index.js")).unwrap(), v1);
    // 非法 id 拒绝（防目录逃逸）
    assert!(restore_generation(&dir, "demo", "../..").is_err());
    assert!(restore_generation(&dir, "demo", "no-such-gen").is_err());
    // 移除连删历史
    remove_plugin_dir(&dir, "demo").unwrap();
    assert!(!dir.join(".history/demo").exists());
    std::fs::remove_dir_all(&dir).unwrap();
}
```

- [ ] **Step 2: 跑测试确认红**

Run: `cargo test --manifest-path src-tauri/Cargo.toml snapshot`
Expected: FAIL（`snapshot_plugin` 等不存在，编译错误）

- [ ] **Step 3: 实现版本仓（plugins.rs）**

在 `place_plugin` 之后追加（注释即契约，逐字写文档注释）：

```rust
use sha2::{Digest, Sha256};

/// 版本仓单代上限：超出裁最旧（单文件插件体积极小，10 代覆盖调试内环足够）。
const MAX_GENERATIONS: usize = 10;

/// 版本仓一代的 meta.json（创建时间/来源版本/apiVersion/入口名/内容指纹）。
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionMeta {
    pub hash: String,
    pub created_at: i64,
    pub version: Option<String>,
    pub api_version: i64,
    pub entry: String,
}

/// list_plugin_versions 的行：一代历史 + 是否当前活目录内容。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub id: String,
    pub created_at: i64,
    pub version: Option<String>,
    pub api_version: i64,
    pub hash: String,
    pub current: bool,
}

/// 版本仓根（plugins/.history/<name>）；scan_plugins 跳过 `.` 前缀目录，天然不入扫描。
fn history_root(dir: &Path, name: &str) -> PathBuf {
    dir.join(".history").join(name)
}

/// 活目录内容指纹与原件：package.json 原文 + 入口源码拼接的 sha256 十六进制。
fn hash_plugin(
    dir: &Path,
    name: &str,
) -> Result<(String, String, Vec<u8>, StudyWikiBlock, Option<String>), String> {
    safe_plugin_name(name)?;
    let plugin = dir.join(name);
    let raw = fs::read_to_string(plugin.join("package.json"))
        .map_err(|e| format!("读 {name}/package.json 失败：{e}"))?;
    let (_, version, block) = parse_package_json(&raw)?;
    let code = fs::read(plugin.join(&block.entry))
        .map_err(|e| format!("读 {name}/{} 失败：{e}", block.entry))?;
    let mut h = Sha256::new();
    h.update(raw.as_bytes());
    h.update(&code);
    let hash = h.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>();
    Ok((hash, raw, code, block, version))
}

/// 按 hash 查已存在的代 id（去重判据）。
fn find_generation_by_hash(hist: &Path, hash: &str) -> Option<String> {
    let items = fs::read_dir(hist).ok()?;
    for item in items.flatten() {
        let p = item.path();
        if !p.is_dir() {
            continue;
        }
        if let Ok(raw) = fs::read_to_string(p.join("meta.json")) {
            if let Ok(meta) = serde_json::from_str::<VersionMeta>(&raw) {
                if meta.hash == hash {
                    return Some(item.file_name().to_string_lossy().into_owned());
                }
            }
        }
    }
    None
}

/// 裁剪到 MAX_GENERATIONS：按代目录名时间戳前缀排序删最旧（meta 损坏的代最先裁）。
fn prune_generations(hist: &Path) -> Result<(), String> {
    let mut gens: Vec<String> = fs::read_dir(hist)
        .map_err(|e| format!("读版本仓失败：{e}"))?
        .flatten()
        .filter(|i| i.path().is_dir())
        .map(|i| i.file_name().to_string_lossy().into_owned())
        .collect();
    gens.sort();
    while gens.len() > MAX_GENERATIONS {
        let oldest = gens.remove(0);
        fs::remove_dir_all(hist.join(&oldest)).map_err(|e| format!("裁剪版本 {oldest} 失败：{e}"))?;
    }
    Ok(())
}

/// 成功激活后的版本快照（boot/热重载/安装即激活三路共用）：内容 hash 去重，
/// 超上限裁最旧。返回新代 id；内容未变（已在仓）返回 None。
pub fn snapshot_plugin(dir: &Path, name: &str) -> Result<Option<String>, String> {
    let (hash, raw, code, block, version) = hash_plugin(dir, name)?;
    let hist = history_root(dir, name);
    if find_generation_by_hash(&hist, &hash).is_some() {
        return Ok(None);
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;
    let id = format!("{ts}-{}", &hash[..12]);
    let gen = hist.join(&id);
    fs::create_dir_all(&gen).map_err(|e| format!("mkdir {}: {e}", gen.display()))?;
    fs::write(gen.join("package.json"), &raw).map_err(|e| format!("write package.json: {e}"))?;
    fs::write(gen.join(&block.entry), &code).map_err(|e| format!("write {}: {e}", block.entry))?;
    let meta = VersionMeta { hash, created_at: ts, version, api_version: block.api_version, entry: block.entry };
    let meta_json = serde_json::to_string(&meta).map_err(|e| e.to_string())?;
    fs::write(gen.join("meta.json"), meta_json).map_err(|e| format!("write meta.json: {e}"))?;
    prune_generations(&hist)?;
    Ok(Some(id))
}

/// 列版本仓历史（新到旧；current 标记活目录内容所在代）。活目录已删时全部 current=false。
/// meta 损坏的代跳过（历史是数据不是活代码，不配让面板打不开）。
pub fn list_generations(dir: &Path, name: &str) -> Result<Vec<VersionInfo>, String> {
    safe_plugin_name(name)?;
    let hist = history_root(dir, name);
    let current = hash_plugin(dir, name).ok().map(|(h, ..)| h);
    let mut out = Vec::new();
    if let Ok(items) = fs::read_dir(&hist) {
        for item in items.flatten() {
            let p = item.path();
            if !p.is_dir() {
                continue;
            }
            let Ok(raw) = fs::read_to_string(p.join("meta.json")) else { continue };
            let Ok(meta) = serde_json::from_str::<VersionMeta>(&raw) else { continue };
            out.push(VersionInfo {
                id: item.file_name().to_string_lossy().into_owned(),
                current: current.as_ref() == Some(&meta.hash),
                created_at: meta.created_at,
                version: meta.version,
                api_version: meta.api_version,
                hash: meta.hash,
            });
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

/// 回滚：把历史一代原子写回活目录（复用 place_plugin 的 staging 管线）。
/// id 只许时间戳-hash 形态（字母数字与连字符），防目录逃逸。
pub fn restore_generation(dir: &Path, name: &str, id: &str) -> Result<(), String> {
    safe_plugin_name(name)?;
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err(format!("非法版本 id：{id:?}"));
    }
    let gen = history_root(dir, name).join(id);
    let raw = fs::read_to_string(gen.join("package.json"))
        .map_err(|e| format!("读版本 {id} 的 package.json 失败：{e}"))?;
    let (_, _, block) = parse_package_json(&raw)?;
    let code = fs::read(gen.join(&block.entry))
        .map_err(|e| format!("读版本 {id} 的 {} 失败：{e}", block.entry))?;
    place_plugin(dir, &ExtractedPlugin { name: name.to_string(), block, code, raw_package_json: raw })
}
```

`remove_plugin_dir` 改为连删历史（文档注释同步更新为"纯删目录与版本历史（可测）：幂等"）：

```rust
pub fn remove_plugin_dir(dir: &Path, name: &str) -> Result<(), String> {
    safe_plugin_name(name)?;
    let target = dir.join(name);
    // 版本历史连删：同名重装不应复活旧历史。
    let _ = fs::remove_dir_all(history_root(dir, name));
    match fs::remove_dir_all(&target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除 {} 失败：{e}", target.display())),
    }
}
```

文件尾部追加三命令：

```rust
/// 版本快照（前端在每次激活成功后调用；内容未变返回 None）。版本仓只增不改，
/// 不自动激活任何东西——重启后的激活依据仍只有清单。
#[tauri::command]
pub fn snapshot_plugin_version(app: AppHandle, name: String) -> Result<Option<String>, String> {
    snapshot_plugin(&plugin_dir(&app)?, &name)
}

/// 列版本仓历史（新到旧；current 标记当前活目录内容）。面板版本列表的数据源。
#[tauri::command]
pub fn list_plugin_versions(app: AppHandle, name: String) -> Result<Vec<VersionInfo>, String> {
    list_generations(&plugin_dir(&app)?, &name)
}

/// 回滚到历史一代：原子写回活目录（激活归前端热重载路径，本命令只管落盘）。
#[tauri::command]
pub fn restore_plugin_version(app: AppHandle, name: String, id: String) -> Result<(), String> {
    restore_generation(&plugin_dir(&app)?, &name, &id)
}
```

`src-tauri/src/lib.rs` 的 `generate_handler!` 追加三行：`plugins::snapshot_plugin_version,`、`plugins::list_plugin_versions,`、`plugins::restore_plugin_version`。

- [ ] **Step 4: 跑测试确认绿 + 重建命令目录**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && pnpm gen:commands && pnpm record:i18n -- docs/commands.md`
Expected: Rust 全绿；commands.md 双侧生成区出现三命令

- [ ] **Step 5: 前端服务三方法（host/plugins.ts）+ 失败测试**

`tests/host-plugins.test.ts` 追加：

```ts
test("版本仓三方法走 invoke 且参数/返回形状正确", async () => {
  const calls: Array<[string, unknown]> = [];
  const deps: PluginsDeps = {
    invoke: vi.fn(async (cmd: string, args?: unknown) => {
      calls.push([cmd, args]);
      if (cmd === "snapshot_plugin_version") return "1690000000-abcd1234ef56";
      if (cmd === "list_plugin_versions") {
        return [{ id: "1690000000-abcd1234ef56", createdAt: 1690000000, version: "1.0.0", apiVersion: 1, hash: "abcd", current: true }];
      }
      return undefined;
    }),
    loadExternal: vi.fn(),
    pickTgz: vi.fn(),
  };
  const svc = new PluginsService(deps);
  await expect(svc.snapshot("demo")).resolves.toBe("1690000000-abcd1234ef56");
  const versions = await svc.listVersions("demo");
  expect(versions[0].current).toBe(true);
  await svc.restoreVersion("demo", "1690000000-abcd1234ef56");
  expect(calls.map(([c]) => c)).toEqual(["snapshot_plugin_version", "list_plugin_versions", "restore_plugin_version"]);
  expect(calls[2][1]).toEqual({ name: "demo", id: "1690000000-abcd1234ef56" });
});
```

实现（host/plugins.ts，PluginEntry 旁）：

```ts
/** 版本仓一代（list_plugin_versions 的行）。 */
export interface PluginVersion {
  id: string;
  createdAt: number;
  version: string | null;
  apiVersion: number;
  hash: string;
  current: boolean;
}
```

PluginsService 类内追加：

```ts
  /** 成功激活后快照一代（内容未变返回 null）；三路激活路径共用。 */
  async snapshot(name: string): Promise<string | null> {
    return this.#deps.invoke("snapshot_plugin_version", { name }) as Promise<string | null>;
  }

  /** 列版本仓历史（新到旧；current 标记当前活目录内容）。 */
  async listVersions(name: string): Promise<PluginVersion[]> {
    return this.#deps.invoke("list_plugin_versions", { name }) as Promise<PluginVersion[]>;
  }

  /** 把历史一代原子写回活目录（激活归热重载路径，本方法只管落盘）。 */
  async restoreVersion(name: string, id: string): Promise<void> {
    await this.#deps.invoke("restore_plugin_version", { name, id });
  }
```

- [ ] **Step 6: 跑 vitest 确认绿 + 门禁**

Run: `pnpm test && pnpm lint:docs && pnpm verify:commands`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/plugins.rs src-tauri/src/lib.rs src/host/plugins.ts tests/host-plugins.test.ts docs/commands.md docs/commands.en.md docs/commands.i18n.yaml
git commit -m "Phase 4: Rust 版本仓三命令（快照/列表/回滚）+ 移除连删历史

动机：动态化的兜底地基——每次成功激活留一代快照，回滚 = 原子写回活目录；
活目录保持单一事实源，boot 路径零改动。"
```

---

### Task 2: guard 白名单门面（loader/guard.ts）

**Files:**
- Create: `src/loader/guard.ts`
- Modify: `scripts/code-map.manifest.json`（登记 guard.ts 职责行）+ `docs/architecture.md` + `docs/architecture.en.md`（gen:code-map 重生成 + record:i18n）
- Test: `tests/guard.test.ts`

**Interfaces:**
- Consumes: `PluginModule`（src/loader/types.ts）。
- Produces（Task 3 依赖，签名逐字）：`guardExternalModule(mod: PluginModule): PluginModule`——返回包装的模块：name/inject 原样透传，apply 收到的 ctx 为门面。

- [ ] **Step 1: 写失败测试**

`tests/guard.test.ts`：

```ts
import { expect, test } from "vitest";
import { Context } from "cordis";
import { guardExternalModule } from "../src/loader/guard";
import type { PluginModule } from "../src/loader/types";

function demoModule(): PluginModule {
  return {
    name: "ext-demo",
    inject: ["files"],
    apply: (ctx: any) => {
      ctx.files.readTree(); // 已声明：放行
      return () => {};
    },
  };
}

test("门面放行 inject 声明的服务，未声明的读即抛教学错误，赋值即抛只读", () => {
  // cordis 对未满足 inject 的 fiber 会停等待态不跑 apply，故门面单测手动驱动；
  // 真 Context 的集成行为归 Task 3 的 activate 测试。
  const files = { readTree: () => ["a.md"] };
  const mod = guardExternalModule({
    name: "ext-demo",
    inject: ["files"],
    apply: (ctx: any) => {
      expect(ctx.files.readTree()).toEqual(["a.md"]);
      expect(() => ctx.windows).toThrow(/未声明的服务 "windows"/);
      expect(() => (ctx.windows = 1)).toThrow(/只读/);
      expect("files" in ctx).toBe(true);
      expect("windows" in ctx).toBe(false);
      return () => {};
    },
  });
  (mod.apply as any)({ files }, {});
});

test("门面：声明过的服务方法放行，返回值里的 Context 被拒（同步与 Promise 解包）", async () => {
  const realCtx = new Context();
  const evil = {
    self: () => realCtx,
    read: () => 42,
    asyncSelf: async () => realCtx,
    asyncRead: async () => 43,
  };
  const mod = guardExternalModule({
    name: "ext-demo",
    inject: ["files"],
    apply: (ctx: any) => {
      expect(ctx.files.read()).toBe(42);
      expect(() => ctx.files.self()).toThrow(/Context/);
      return () => {};
    },
  });
  // 手动驱动：构造一个带 files 属性的假 ctx（真 Context 集成归 Task 3）
  (mod.apply as any)({ files: evil }, {});
  // Promise 解包后的 Context 同样被拒；普通异步值放行
  const wrappedApply = guardExternalModule({
    name: "ext-demo",
    inject: ["files"],
    apply: (ctx: any) => {
      expect(ctx.files.asyncRead()).resolves.toBe(43);
      expect(ctx.files.asyncSelf()).rejects.toThrow(/Context/);
      return () => {};
    },
  });
  (wrappedApply.apply as any)({ files: evil }, {});
});

test("模块形状原样透传（name/inject 不变，apply 被包装）", () => {
  const src = demoModule();
  const wrapped = guardExternalModule(src);
  expect(wrapped.name).toBe(src.name);
  expect(wrapped.inject).toBe(src.inject);
  expect(wrapped.apply).not.toBe(src.apply);
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm test tests/guard.test.ts`
Expected: FAIL（找不到 ../src/loader/guard）

- [ ] **Step 3: 实现 guard.ts**

```ts
import { Context } from "cordis";
import type { PluginModule } from "./types";

/** 外置插件 guard 门面（只包外置；内置一等公民静态表直装）。
 * 白名单：inject 声明过的服务名；其余属性读即抛教学错误，赋值即抛只读错误，
 * 服务返回值里的 cordis Context 一律拒绝（防经返回值摸到别的上下文）。
 * 边界诚实化：本门面收窄的是服务面，不是语言能力——外置插件仍可触达
 * DOM/fetch/全局对象，这不是沙箱（同进程真沙箱在停机坪，见 Phase 4 Note）。
 * @param mod 已过形状校验的外置模块。
 * @returns 包装后的模块：name/inject 透传，apply 的 ctx 换门面。 */
export function guardExternalModule(mod: PluginModule): PluginModule {
  const declared = new Set(mod.inject ?? []);
  return {
    name: mod.name,
    inject: mod.inject,
    apply(ctx: unknown, config: unknown) {
      return mod.apply(facade(mod.name, ctx, declared) as never, config);
    },
  };
}

/** 单插件门面 Proxy：按声明集合放行/教学拒绝。 */
function facade(name: string, ctx: unknown, declared: Set<string>): unknown {
  const wrapped = new Map<string, unknown>();
  return new Proxy(Object.create(null), {
    get(_target, prop) {
      // symbol 探测（then / Symbol.toPrimitive 等）一律缺席，防 thenable 副作用。
      if (typeof prop !== "string") return undefined;
      if (!declared.has(prop)) {
        throw new Error(
          `外置插件 ${name} 访问了未声明的服务 "${prop}"——在模块的 inject 数组里声明 "${prop}" 后重新加载。已声明：${[...declared].join(", ") || "（无）"}`,
        );
      }
      if (!wrapped.has(prop)) {
        wrapped.set(prop, guardService(name, prop, (ctx as Record<string, unknown>)[prop]));
      }
      return wrapped.get(prop);
    },
    set(_target, prop) {
      throw new Error(`外置插件 ${name} 的 ctx 只读：不可赋值 "${String(prop)}"`);
    },
    has(_target, prop) {
      return typeof prop === "string" && declared.has(prop);
    },
  });
}

/** 服务对象包装：方法以原 receiver 调用，返回值（含 Promise 解包）拒 Context。 */
function guardService(name: string, serviceName: string, service: unknown): unknown {
  if (service === null || (typeof service !== "object" && typeof service !== "function")) return service;
  const target = service as Record<string | symbol, unknown>;
  return new Proxy(target, {
    get(t, prop) {
      const value = Reflect.get(t, prop, t);
      if (typeof value !== "function") return denyContext(name, serviceName, value);
      return (...args: unknown[]) => {
        const result = Reflect.apply(value as (...a: unknown[]) => unknown, t, args);
        if (result instanceof Promise) return result.then((r) => denyContext(name, serviceName, r));
        return denyContext(name, serviceName, result);
      };
    },
  });
}

/** Context 返回值拒绝（门面不提供别的上下文，教学文案点名来源服务）。 */
function denyContext(name: string, serviceName: string, value: unknown): unknown {
  if (value instanceof Context) {
    throw new Error(
      `外置插件 ${name} 的服务 "${serviceName}" 返回了 cordis Context——门面不提供 Context，请只经自身 inject 声明的服务操作`,
    );
  }
  return value;
}
```

- [ ] **Step 4: 跑测试确认绿 + code-map 登记**

`scripts/code-map.manifest.json` 在 `src/loader/` 区登记两行（activate.ts 归 Task 3 登记）：

```json
"src/loader/guard.ts": "外置插件 guard 门面：inject 白名单 Proxy（只包外置；收窄服务面非语言能力，非沙箱）",
```

Run: `pnpm test tests/guard.test.ts && pnpm gen:code-map && pnpm record:i18n -- docs/architecture.md && pnpm lint:docs`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add src/loader/guard.ts tests/guard.test.ts scripts/code-map.manifest.json docs/architecture.md docs/architecture.en.md docs/architecture.i18n.yaml
git commit -m "Phase 4: 外置插件 guard 白名单门面

动机：动态化后陌生代码随时进 app，inject 从君子协定升级为门面强制——
收窄服务面 + 教学错误 + Context 返回值拒绝；边界诚实化（非沙箱）写进注释。"
```

---

### Task 3: 共享激活函数 + fiber 等待式审计（loader/activate.ts）

**Files:**
- Create: `src/loader/activate.ts`
- Modify: `src/loader/boot.ts`（ext: 行改走共享激活；50ms 审计只管内置）
- Modify: `src/bootstrap.ts`（boot 调用传入 snapshot 通道）
- Modify: `scripts/code-map.manifest.json` + `docs/architecture.md` 双侧（登记 + 重生成 + 重录）
- Test: `tests/activate.test.ts`（新增）、`tests/loader.test.ts`、`tests/bootstrap.test.ts`（既有用例适配）

**Interfaces:**
- Consumes: `guardExternalModule`（Task 2）；`PluginModule`；Task 1 的 `PluginsService.snapshot`（经 bootstrap 注入为 deps）。
- Produces（Task 4 依赖，签名逐字）：

```ts
export interface ActivateDeps {
  /** 激活成功后的版本快照通道（snapshot_plugin_version）；失败只 warn 不致命。 */
  snapshot: (name: string) => Promise<unknown>;
  /** 审计等待参数（测试注入零等待）。 */
  wait?: { intervalMs?: number; budgetMs?: number; sleep?: (ms: number) => Promise<void> };
}
export function serialized<T>(name: string, fn: () => Promise<T>): Promise<T>;
export function waitActive(fiber: Fiber, name: string, wait?: ActivateDeps["wait"]): Promise<void>;
export function activateExternal(ctx: Context, name: string, mod: PluginModule, config: Record<string, unknown>, deps: ActivateDeps): Promise<void>;
export function reloadExternal(ctx: Context, name: string, mod: PluginModule, config: Record<string, unknown>, deps: ActivateDeps): Promise<void>;
export function deactivateExternal(name: string): Promise<void>;
export function runningExternals(): ReadonlySet<string>;
export function activationFailures(): ReadonlyMap<string, string>;
```

- [ ] **Step 1: 写失败测试**

`tests/activate.test.ts`：

```ts
import { expect, test, vi } from "vitest";
import { Context } from "cordis";
import {
  activateExternal, activationFailures, deactivateExternal, reloadExternal,
  runningExternals, serialized,
} from "../src/loader/activate";

const noopDeps = { snapshot: vi.fn(async () => {}) };
const fastWait = { intervalMs: 0, budgetMs: 50, sleep: () => Promise.resolve() };

function hello(name = "ext-demo"): { name: string; inject?: string[]; apply: (ctx: never, config: unknown) => () => void } {
  return { name, apply: () => () => {} };
}

test("激活成功：登记 running + 快照被调 + guard 包装生效（apply 拿不到未声明服务）", async () => {
  const ctx = new Context();
  const seen: string[] = [];
  await activateExternal(ctx, "demo", {
    name: "ext-demo",
    apply: (ctx2: any) => {
      try { ctx2.files; } catch (e) { seen.push((e as Error).message); }
      return () => {};
    },
  }, {}, { ...noopDeps, snapshot: async (n) => { seen.push(`snap:${n}`); } });
  expect(runningExternals().has("demo")).toBe(true);
  expect(seen.some((m) => m.includes("未声明的服务"))).toBe(true); // 无 inject 声明
  expect(seen).toContain("snap:demo");
  await deactivateExternal("demo");
});

test("声明服务未提供：审计超时失败，fiber 被处置，记入 activationFailures", async () => {
  const ctx = new Context();
  await expect(
    activateExternal(ctx, "stuck", { ...hello(), inject: ["nonexistent"] } as never, {}, { ...noopDeps, wait: fastWait }),
  ).rejects.toThrow(/审计超时|未激活/);
  expect(runningExternals().has("stuck")).toBe(false);
  expect(activationFailures().get("stuck")).toMatch(/声明的服务未提供/);
});

test("重载失败回退旧版：新模块激活抛错，旧模块重新激活并仍在 running", async () => {
  const ctx = new Context();
  const v1 = hello();
  await activateExternal(ctx, "demo", v1, {}, noopDeps);
  const bad = { name: "ext-demo", apply: () => { throw new Error("new code boom"); } };
  await expect(reloadExternal(ctx, "demo", bad as never, {}, { ...noopDeps, wait: fastWait })).rejects.toThrow("new code boom");
  expect(runningExternals().has("demo")).toBe(true); // 旧版已恢复
  expect(activationFailures().has("demo")).toBe(false);
  await deactivateExternal("demo");
});

test("同一插件操作串行：两次 reload 不交错", async () => {
  const ctx = new Context();
  const order: string[] = [];
  const slow = (tag: string) => ({
    name: "ext-demo",
    apply: () => { order.push(`apply:${tag}`); return () => { order.push(`dispose:${tag}`); }; },
  });
  await activateExternal(ctx, "demo", slow("v1"), {}, noopDeps);
  await Promise.all([
    reloadExternal(ctx, "demo", slow("v2") as never, {}, noopDeps),
    reloadExternal(ctx, "demo", slow("v3") as never, {}, noopDeps),
  ]);
  expect(order).toEqual(["apply:v1", "dispose:v1", "apply:v2", "dispose:v2", "apply:v3"]);
  await deactivateExternal("demo");
});
```

`tests/loader.test.ts` 适配：外置行现在走 activateExternal——stuck 外置行的坏行理由文案变为审计超时文案（含"声明的服务未提供"），boot 调用补 deps 参数（`{ snapshot: async () => {}, wait: fastWait }` 形态，fastWait 同上）。

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm test tests/activate.test.ts`
Expected: FAIL（找不到 ../src/loader/activate）

- [ ] **Step 3: 实现 activate.ts**

```ts
import { Context, FiberState, type Fiber } from "cordis";
import { guardExternalModule } from "./guard";
import type { PluginModule } from "./types";

/** 运行期外置插件登记（本窗内存）：name → 活 fiber + 模块对象 + 配置。
 * 模块对象同时是"重载失败回退旧版"的唯一副本（磁盘已被新代码覆盖）。 */
interface ActiveExternal {
  fiber: Fiber;
  module: PluginModule;
  config: Record<string, unknown>;
}

const active = new Map<string, ActiveExternal>();
/** 最近一次激活失败的原因（面板行"装载失败"投影的数据源；running 时无条目）。 */
const failures = new Map<string, string>();
/** 同一插件的操作串行链（dsh starting 表等价物）：连点不交错。 */
const queues = new Map<string, Promise<unknown>>();

/** 激活参数：snapshot 通道 + 审计等待配置（测试注入零等待）。 */
export interface ActivateDeps {
  /** 激活成功后的版本快照通道；快照失败只 console.warn，不卡死激活。 */
  snapshot: (name: string) => Promise<unknown>;
  /** 审计等待参数：intervalMs 轮询间隔、budgetMs 上限、sleep 实现。 */
  wait?: { intervalMs?: number; budgetMs?: number; sleep?: (ms: number) => Promise<void> };
}

/** 串行化一个插件的运行期操作（前序失败不阻塞后续）。 */
export function serialized<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(name) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(name, next);
  return next;
}

/** fiber 等待式审计（替代 boot 50ms 固定静默覆盖不了的热路径）：
 * 轮询 fiber.state 到 ACTIVE；FAILED/DISPOSED 立即失败；超时点名
 * "声明的服务未提供"。@param fiber 待审 fiber。@param name 插件名（报错点名用）。 */
export async function waitActive(fiber: Fiber, name: string, wait: ActivateDeps["wait"] = {}): Promise<void> {
  const { intervalMs = 10, budgetMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = wait;
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const state = fiber.state;
    if (state === FiberState.ACTIVE) return;
    if (state === FiberState.FAILED || state === FiberState.DISPOSED) {
      throw new Error(`外置插件 ${name} 激活失败（state=${state}）`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`外置插件 ${name} 激活审计超时（state=${state}）：声明的服务未提供？`);
    }
    await sleep(intervalMs);
  }
}

/** 共享激活：guard 包装 → ctx.plugin → 等待审计（失败处置半成品 fiber）→
 * 登记 running → 版本快照。boot 的 ext: 行与面板全部热路径的唯一入口。 */
export async function activateExternal(
  ctx: Context,
  name: string,
  mod: PluginModule,
  config: Record<string, unknown>,
  deps: ActivateDeps,
): Promise<void> {
  const fiber = ctx.plugin(guardExternalModule(mod) as never, config);
  try {
    await waitActive(fiber, name, deps.wait);
  } catch (e) {
    await fiber.dispose();
    failures.set(name, (e as Error).message);
    throw e;
  }
  active.set(name, { fiber, module: mod, config });
  failures.delete(name);
  try {
    await deps.snapshot(name);
  } catch (e) {
    console.warn(`[phase4] 版本快照失败（不阻断激活）：${(e as Error).message}`);
  }
}

/** 重新加载（先验证后切换）：新模块须已在调用方过完装载校验；先 dispose
 * 旧 fiber 再激活新模块，激活失败用内存中的旧模块回退（回退也失败则记坏行）。 */
export async function reloadExternal(
  ctx: Context,
  name: string,
  mod: PluginModule,
  config: Record<string, unknown>,
  deps: ActivateDeps,
): Promise<void> {
  return serialized(name, async () => {
    const prev = active.get(name);
    if (prev) {
      await prev.fiber.dispose();
      active.delete(name);
    }
    try {
      await activateExternal(ctx, name, mod, config, deps);
    } catch (e) {
      if (prev) {
        try {
          await activateExternal(ctx, name, prev.module, prev.config, deps);
        } catch (restoreError) {
          failures.set(name, (restoreError as Error).message);
        }
      } else {
        failures.set(name, (e as Error).message);
      }
      throw e;
    }
  });
}

/** 停用/移除前置：dispose 活 fiber 并销登记（幂等：没在跑也成功）。 */
export async function deactivateExternal(name: string): Promise<void> {
  return serialized(name, async () => {
    const cur = active.get(name);
    if (cur) {
      await cur.fiber.dispose();
      active.delete(name);
    }
  });
}

/** 本窗正在运行的外置插件名集合（面板"运行中"投影数据源）。 */
export function runningExternals(): ReadonlySet<string> {
  return active.size ? new Set(active.keys()) : new Set();
}

/** 最近激活失败表（面板"装载失败"投影数据源；running 的插件无条目）。 */
export function activationFailures(): ReadonlyMap<string, string> {
  return new Map(failures);
}
```

boot.ts 的 ext: 分支改为：

```ts
    if (row.id.startsWith("ext:")) {
      const name = row.id.slice(4);
      try {
        const plugin = await loadExternal(name);
        await activateExternal(ctx, name, plugin, row.config, deps ?? { snapshot: async () => {} });
        loaded.push(row.id);
      } catch (e) {
        // 资源缺失/入口损坏/形状不符/审计超时：跳过并点名，不阻断其余插件。
        broken.push({ id: row.id, reason: (e as Error).message });
      }
      continue;
    }
```

同时：①`states` 数组只收内置行（删掉 ext 行的 states.push）；②50ms 审计后的 `stuck` 循环里 ext 分治分支删除（外置已由 waitActive 覆盖），只留内置 fail-loud；③boot 签名加 `deps?: ActivateDeps` 参数并加文档注释。boot.ts 顶部 import activateExternal。

bootstrap.ts 的 boot 调用改为：

```ts
  const report = await boot(ctx, manifest, table, (name) => plugins.loadModule(name), {
    snapshot: (name) => plugins.snapshot(name),
  });
```

- [ ] **Step 4: code-map 登记 + 跑全部测试**

`scripts/code-map.manifest.json` 登记：

```json
"src/loader/activate.ts": "外置插件共享激活：guard 包装 + fiber 等待式审计 + 串行队列 + running/失败登记（boot 与热路径唯一入口）（→ guard.ts、types.ts）",
```

Run: `pnpm gen:code-map && pnpm record:i18n -- docs/architecture.md && pnpm test && pnpm lint:docs && pnpm verify:layering`
Expected: 全绿（loader.test/bootstrap.test 适配后）

- [ ] **Step 5: Commit**

```bash
git add src/loader/activate.ts src/loader/boot.ts src/bootstrap.ts tests/activate.test.ts tests/loader.test.ts tests/bootstrap.test.ts scripts/code-map.manifest.json docs/architecture.md docs/architecture.en.md docs/architecture.i18n.yaml
git commit -m "Phase 4: 共享激活函数 + fiber 等待式审计

动机：boot 的 50ms 固定静默覆盖不了运行期装载；所有外置激活收敛到单一
入口（guard 包装 + 等待审计 + 快照），热重载失败可用内存旧模块回退。"
```

---

### Task 4: 面板全即时化 + 安装写清单行（修存量缺口）

**Files:**
- Modify: `src/plugins/plugin-manager/model.ts`（PanelRow 扩 runtime/failure；computePanelRows 四源；新增 withRow）
- Modify: `src/plugins/plugin-manager/index.ts`（四动作即时化 + 版本历史展开 + 常驻说明替换重启提示）
- Modify: `styles.css`（版本历史行/状态徽章样式，无逻辑）
- Test: `tests/plugin-manager.test.ts`（即时化行为重写）

**Interfaces:**
- Consumes: Task 1 的 `PluginsService.{snapshot,listVersions,restoreVersion}` + `PluginVersion`；Task 3 的 `activateExternal/reloadExternal/deactivateExternal/runningExternals/activationFailures/ActivateDeps`。
- Produces: `withRow(manifest: Manifest, id: string): Manifest`（追加 enabled 行，幂等）；`PanelRow.runtime: "running" | "failed" | "stopped" | null`（内置恒 null）；`PanelRow.failure: string | null`；`computePanelRows(manifest, entries, bootBroken, running: ReadonlySet<string>, failures: ReadonlyMap<string, string>): PanelRow[]`。
- **存量缺口修复（必须在 PR 说明点名）**：现状安装/导入从不写清单行（`ext:` 行无入清单路径，重启后也不会被装载）——本任务安装路径 `withRow` 落清单即修复；这是 Phase 2 验收盲区留下的缺陷，不是本阶段引入。

- [ ] **Step 1: 写失败测试（model 纯函数）**

`tests/plugin-manager.test.ts` 追加/改写：

```ts
test("withRow 追加 enabled 行且幂等", () => {
  const m = manifest([["app-shell", true]]);
  const m2 = withRow(m, "ext:demo");
  expect(m2.plugins.map((r) => r.id)).toEqual(["app-shell", "ext:demo"]);
  expect(m2.plugins[1]).toEqual({ id: "ext:demo", enabled: true, config: {} });
  expect(withRow(m2, "ext:demo")).toEqual(m2); // 已在则不增生
});

test("四源投影：running/failed/stopped 与 failure 文案", () => {
  const m = manifest([["app-shell", true], ["ext:a", true], ["ext:b", true], ["ext:c", false]]);
  const rows = computePanelRows(m, entries, [], new Set(["a"]), new Map([["b", "激活审计超时：声明的服务未提供？"]]));
  expect(rows[0].runtime).toBeNull(); // 内置不投影运行态
  expect(rows[1].runtime).toBe("running");
  expect(rows[2].runtime).toBe("failed");
  expect(rows[2].failure).toContain("声明的服务未提供");
  expect(rows[3].runtime).toBe("stopped"); // 停用 = 清单 enabled:false
});
```

- [ ] **Step 2: 跑确认红 → 实现 model.ts**

```ts
/** 追加一行 enabled 的外置清单行（幂等：已在则原样返回）。
 * @param manifest 变换前的清单。
 * @param id 新行 id（外置带 ext: 前缀）。
 * @returns 含新行的新清单。 */
export function withRow(manifest: Manifest, id: string): Manifest {
  if (manifest.plugins.some((row) => row.id === id)) return manifest;
  return { plugins: [...manifest.plugins, { id, enabled: true, config: {} }] };
}
```

`PanelRow` 接口加两字段（文档注释：`runtime` 本窗运行态投影（内置恒 null）；`failure` 最近激活失败原因），`computePanelRows` 签名加 `running` / `failures` 两参，外置分支：

```ts
      const runningNow = running.has(name);
      const failure = failures.get(name) ?? null;
      return {
        id: row.id,
        externalName: name,
        enabled: row.enabled,
        version: entry?.version ?? null,
        problem: brokenById.get(row.id) ?? entry?.problem ?? (entry ? null : "插件目录缺失"),
        removable: true,
        runtime: !row.enabled ? "stopped" : runningNow ? "running" : failure ? "failed" : "stopped",
        failure,
      };
```

内置分支补 `runtime: null, failure: null`。

Run: `pnpm test tests/plugin-manager.test.ts` → 两新用例绿

- [ ] **Step 3: 面板即时化（index.ts）**

顶栏/面板骨架不变，改动点（全部用真实代码替换现有回调）：

① 模块顶部加 import 与 deps 工厂：

```ts
import {
  activateExternal, activationFailures, deactivateExternal, reloadExternal, runningExternals,
  type ActivateDeps,
} from "../../loader/activate";
import { withRow } from "./model";

/** 面板热路径的激活参数：快照走宿主插件服务。 */
function activateDeps(ctx: Context): ActivateDeps {
  return { snapshot: (name) => ctx.plugins.snapshot(name) };
}
```

② 重启提示 hint 元素删除，换常驻说明（errLine 保留）：

```ts
  const note = document.createElement("p");
  note.className = "plugin-note";
  note.textContent = "改动即时生效于本窗口；其他窗口重启后跟随清单。";
```

（`noteSaved` 函数与 `.plugin-restart-hint` 全部删除；render 的 replaceChildren 尾部用 `errLine, note`。）

③ 安装按钮（写清单行 + 即激活；失败内联 + 行留 enabled 待下次 boot 重试）：

```ts
        button("安装", "btn", async () => {
          const spec = installInput.value.trim();
          if (!spec) return;
          try {
            const installed = await ctx.plugins.install(spec);
            await ctx.plugins.writeManifest(withRow(manifest, `ext:${installed}`));
            const mod = await ctx.plugins.loadModule(installed);
            await activateExternal(ctx, installed, mod, {}, activateDeps(ctx));
          } catch (e) {
            showError(e);
          }
          await render();
        }),
```

本地导入按钮同构（`importFromTgz` 返回 null 即取消，直接 render）。

④ render 的数据源改四源：

```ts
      const rows = computePanelRows(manifest, entries, ctx.plugins.bootBroken, runningExternals(), activationFailures());
```

⑤ rowEl 外置行：开关即时化 + 三个新按钮（重新加载 / 历史 / 移除带确认）：

```ts
  toggle.addEventListener("change", async () => {
    try {
      if (toggle.checked) {
        const mod = await ctx.plugins.loadModule(row.externalName!);
        await reloadExternal(ctx, row.externalName!, mod, rowOf(manifest, row.id).config, activateDeps(ctx));
        await ctx.plugins.writeManifest(withEnabled(manifest, row.id, true));
      } else {
        await deactivateExternal(row.externalName!);
        await ctx.plugins.writeManifest(withEnabled(manifest, row.id, false));
      }
    } catch (e) {
      showError(e);
    }
    await rerender();
  });
```

（`rowOf` 为 index.ts 局部 helper：`const rowOf = (m: Manifest, id: string) => m.plugins.find((r) => r.id === id)!;`；③④⑤三处共用。）

重新加载按钮（仅健康外置行）：

```ts
      button("重新加载", "btn btn-ghost", async () => {
        try {
          const mod = await ctx.plugins.loadModule(row.externalName!);
          await reloadExternal(ctx, row.externalName!, mod, rowOf(manifest, row.id).config, activateDeps(ctx));
        } catch (e) {
          showError(e);
        }
        await rerender();
      }),
```

历史按钮（展开版本列表；每代一个"回退"）：

```ts
      button("历史", "btn btn-ghost", async () => {
        const box = line.querySelector(".plugin-versions");
        if (box) { box.remove(); return; }
        const versions = await ctx.plugins.listVersions(row.externalName!);
        const list = document.createElement("div");
        list.className = "plugin-versions";
        for (const v of versions) {
          const item = document.createElement("div");
          item.className = "plugin-version-row";
          const label = document.createElement("span");
          label.textContent = `${v.id.slice(11)} ${v.version ?? ""} ${new Date(v.createdAt * 1000).toLocaleString()}${v.current ? "（当前）" : ""}`;
          item.append(label);
          if (!v.current) {
            item.append(button("回退", "btn btn-ghost", async () => {
              try {
                await ctx.plugins.restoreVersion(row.externalName!, v.id);
                const mod = await ctx.plugins.loadModule(row.externalName!);
                await reloadExternal(ctx, row.externalName!, mod, rowOf(manifest, row.id).config, activateDeps(ctx));
              } catch (e) {
                showError(e);
              }
              await rerender();
            }));
          }
          list.append(item);
        }
        line.append(list);
      }),
```

移除按钮加确认（**先把模块顶部的 `export const inject = ["plugins", "slots"]` 改为 `["plugins", "slots", "windows"]`**——内置插件声明即可，confirmDialog 已在 WindowsService）：

```ts
        if (await ctx.windows.confirmDialog(`移除 ${row.externalName}？其版本历史将一并删除。`)) {
          await deactivateExternal(row.externalName!);
          await ctx.plugins.remove(row.externalName!);
          await ctx.plugins.writeManifest(withoutRow(manifest, row.id));
        }
```

行状态徽章：runtime === "failed" 追加 `<span class="plugin-problem">装载失败：${row.failure}</span>`；runtime === "running" 追加 `<span class="plugin-runtime">运行中</span>`。

⑥ styles.css 追加（无逻辑，贴现有风格）：`.plugin-note`、`.plugin-runtime`、`.plugin-versions`、`.plugin-version-row` 四条规则。

- [ ] **Step 4: 行为测试（即时化）**

`tests/plugin-manager.test.ts` 改写"列行 + 开关写清单 + 移除"用例为即时化断言（fake ctx 补 `loadModule`、`snapshot`、`listVersions`、`restoreVersion`、`windows.confirmDialog`；activate 函数用 vi.mock 钉调用）：

```ts
vi.mock("../src/loader/activate", () => ({
  activateExternal: vi.fn(async () => {}),
  reloadExternal: vi.fn(async () => {}),
  deactivateExternal: vi.fn(async () => {}),
  runningExternals: vi.fn(() => new Set(["demo"])),
  activationFailures: vi.fn(() => new Map()),
}));
```

关键断言：安装成功 → `writeManifest` 收到含 `ext:demo` 的清单 + `activateExternal` 以 `("demo", …)` 被调 + **无重启提示元素**；开关关 → `deactivateExternal("demo")` + 清单 enabled=false；移除 → confirmDialog 被问 + `remove` + `deactivateExternal` 都被调；激活失败 → `.plugin-error` 内联可见。

Run: `pnpm test tests/plugin-manager.test.ts` → 全绿

- [ ] **Step 5: 全量测试 + 门禁**

Run: `pnpm test && pnpm lint:docs && pnpm verify:layering && pnpm verify:dep-audit`
Expected: 全绿（dep-audit 白名单不动）

- [ ] **Step 6: Commit**

```bash
git add src/plugins/plugin-manager/ styles.css tests/plugin-manager.test.ts
git commit -m "Phase 4: 面板全即时化（重载/启停/安装即激活/版本回退）

动机：外置插件生态从重启生效转即时生效（本窗即时、他窗重启见清单）；
顺带修复存量缺口——安装/导入此前从不写清单行，ext 行无入清单路径。"
```

---

### Task 5: layering 门禁 + 文档两件套 + Note 收口

**Files:**
- Modify: `scripts/verify-layering.mjs` + `scripts/verify-layering.spec.mjs`（外置激活必经 guard 扫描）
- Create: `docs/plugins/contract.md` + `.en.md` + `.i18n.yaml`（怎么写插件）
- Create: `docs/plugins/dynamic.md` + `.en.md` + `.i18n.yaml`（怎么动态加载）
- Modify: `docs/plugins/authoring.md` 双侧（互链最小修补 + 重录）
- Modify: `docs/README.md` 双侧（索引两行 + 重录）、`scripts/doc-budgets.manifest.json`（两文档预算登记）
- Modify: `plans/2026-09-13-phase4-worklist.md`（主体方向段勾掉落地项）
- Move: `.agents/notes/proposed/architecture/2026-09-16-phase4-dynamic-plugins.*` → `implemented/architecture/`（Status 改 implemented + 按实落地修订事实 + 重录）

**Interfaces:**
- Consumes: 全部前序任务。
- Produces: layering 新扫描函数 `scanExternalActivation(relPath: string, code: string): string[]`——`ctx.plugin(` 只允许出现在 `src/loader/boot.ts` 与 `src/loader/activate.ts`；activate.ts 必须含 `guardExternalModule(`。

- [ ] **Step 1: layering 扫描 + 自测试（红-绿）**

verify-layering.spec.mjs 追加用例：

```js
test("外置激活扫描：ctx.plugin 白名单外即违规，activate.ts 缺 guard 包装即违规", () => {
  expect(scanExternalActivation("src/plugins/x/index.ts", "ctx.plugin(m, {})")).toHaveLength(1);
  expect(scanExternalActivation("src/loader/boot.ts", "ctx.plugin(entry.plugin, c)")).toHaveLength(0);
  expect(scanExternalActivation("src/loader/activate.ts", "guardExternalModule(mod); ctx.plugin(m, {})")).toHaveLength(0);
  expect(scanExternalActivation("src/loader/activate.ts", "ctx.plugin(m, {})")).toHaveLength(1);
});
```

实现（verify-layering.mjs）：

```js
const ACTIVATION_ALLOWLIST = new Set(["src/loader/boot.ts", "src/loader/activate.ts"]);

/**
 * 外置激活扫描：ctx.plugin( 只允许出现在装载器两文件（内置行 + 共享激活函数）；
 * activate.ts 必须经 guardExternalModule 包装（外置路径必经门面的机械保证）。
 */
export function scanExternalActivation(relPath, code) {
  const violations = [];
  const stripped = code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  if (!/(?<![.\w])ctx\.plugin\s*\(/.test(stripped)) {
    if (relPath === "src/loader/activate.ts" && !stripped.includes("guardExternalModule(")) {
      violations.push(`${relPath}: 共享激活函数缺 guardExternalModule 包装（外置路径必须过 guard 门面）`);
    }
    return violations;
  }
  if (!ACTIVATION_ALLOWLIST.has(relPath)) {
    violations.push(`${relPath}: ctx.plugin( 调用只允许在 src/loader/boot.ts 与 src/loader/activate.ts`);
  }
  if (relPath === "src/loader/activate.ts" && !stripped.includes("guardExternalModule(")) {
    violations.push(`${relPath}: 共享激活函数缺 guardExternalModule 包装（外置路径必须过 guard 门面）`);
  }
  return violations;
}
```

主扫描循环里对 src/ 每个 .ts 追加调用该函数。Run: `pnpm test && pnpm verify:layering` → 绿。

- [ ] **Step 2: contract.md（怎么写插件）**

三件套。中文版骨架（逐节写实，段一行到底；示例必须可用）：

```markdown
# 外置插件契约

[English](contract.en.md) | 中文

> 类型：参考 | 读者：插件作者与 AI agent。发布/供应链流程见 [authoring.md](authoring.md)；运行期行为见 [dynamic.md](dynamic.md)。

## 模块形状

外置插件是一个零依赖单文件 ESM 模块，导出三件套：`name`（非空字符串）、`apply(ctx, config)`（函数，可返回清理函数）、`inject`（可选字符串数组）。宿主装载时逐字段校验，缺什么点名拒载。最小可用示例：

```js
export const name = "hello-topbar";
export const inject = ["slots"];
export function apply(ctx) {
  return ctx.slots.register("topbar.right", (el) => {
    const s = document.createElement("span");
    s.textContent = "你好";
    el.append(s);
  });
}
```

## inject 即权限声明

apply 拿到的 ctx 是 guard 门面：只能读 inject 声明过的宿主服务（files / windows / workspace / slots / plugins），读未声明的服务当场抛错并点名补声明；ctx 只读不可赋值；服务方法返回的 cordis Context 会被拒绝。声明了但宿主没提供的服务：插件停在等待态，激活审计 2 秒后判失败，面板点名"声明的服务未提供"。

## 边界（诚实声明）

门面收窄的是服务面，不是语言能力：插件代码仍可触达 DOM、fetch 与全局对象——这不是沙箱。只安装你信任的插件。

## 失败处置

装载期失败（形状不符 / apiVersion 不在支持集 {1} / 入口读不到）不影响其他插件：面板行点名原因。apply 返回的清理函数在停用/重载/移除时由宿主调用；DOM 监听与定时器请在清理函数里自行拆除。

## apiVersion

package.json 的 `studywiki.apiVersion` 是契约版本；宿主支持集见（当前仅 1）。扩集会回 Phase 2 Note 修订。
```

英文侧按 i18n 契约翻译（围栏逐字复制不翻译），写完 `pnpm record:i18n -- docs/plugins/contract.md`。

- [ ] **Step 3: dynamic.md（怎么动态加载）**

```markdown
# 动态加载

[English](dynamic.en.md) | 中文

> 类型：参考 | 读者：插件作者、AI agent 与维护者。写插件见 [contract.md](contract.md)；发布见 [authoring.md](authoring.md)。

## 行为契约

插件面板（顶栏"插件"）的全部操作即时生效于本窗口，不再要求重启：安装/导入（联网或本地 tgz → 落盘 → 写清单 → 本窗激活）、启用/停用开关、重新加载（改完代码点一下）、移除、回退。其他窗口不跟随——它们下次启动按清单自然对齐，清单是跨窗口一致性的唯一准源。

## 重新加载

重新加载先验证后切换：新代码要过装载校验（形状/apiVersion/inject 形状）才动旧版；激活审计（轮询 fiber 到 ACTIVE，2 秒上限）失败时自动用内存中的旧模块恢复运行，面板行内报错。同一插件的操作串行排队，连点不交错。

## 版本仓

每次成功激活自动留一代快照（`plugins/.history/<name>/`，内容 hash 去重，每插件保留 10 代）。面板"历史"展开版本列表，"回退"把选中代原子写回活目录并热重载。版本仓只增不改、不自动激活任何东西；移除插件连带删除其历史（面板会二次确认）。

## 激活失败的去处

安装即激活失败：目录与清单保留，面板行点名原因，下次启动自动重试。停用失败/回退失败：旧状态保持，错误内联显示。装载期失败的行不影响其他任何插件。
```

英文侧翻译 + 重录。

- [ ] **Step 4: 互链与登记**

- `authoring.md` 双侧"本地导入内环"句改为指向 dynamic.md（现状口径：即时生效，不再写"重启生效"）；重录。
- `docs/README.md` 双侧索引加两行（contract / dynamic 一句话职责）；重录。
- `scripts/doc-budgets.manifest.json` 登记：`"docs/plugins/contract.md": 560`、`"docs/plugins/dynamic.md": 520`（写完按实际校准，超限按 docs/AGENTS.md 处置顺序）。
- `plans/2026-09-13-phase4-worklist.md` 主体方向段的"合成路线/前置硬点"中已落地四件标注"✅ 已落地（本阶段）"，agent 两件（网络豁免/密钥）与 W1/W2 保持未勾。
- `docs/architecture.md` 双侧数据流段外置插件句最小更新：装载（…与静态表同流程激活；坏行分治跳过、面板点名待清理）；管理（面板改动写清单、**本窗即时生效**——重载/启停/安装/移除经共享激活函数（guard 门面 + fiber 等待审计），版本仓快照兜底，他窗重启跟随清单）。中英双侧同步 + 重录。

- [ ] **Step 5: Note 转 implemented**

`git mv` 三件套到 `.agents/notes/implemented/architecture/`，`Status: proposed` → `Status: implemented`；按实际落地修订 Note 中的事实（只改事实不改决策：parked 态细化为 2s 超时转失败行）；重录配对。

- [ ] **Step 6: 全量门禁 + 发布档**

Run: `pnpm verify:docs && pnpm verify:env-independence && pnpm verify:dep-audit && pnpm verify:layering && pnpm route:gates`
Expected: 全绿；route:gates 推荐组合无遗漏

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-layering.mjs scripts/verify-layering.spec.mjs docs/ plans/2026-09-13-phase4-worklist.md .agents/notes/
git commit -m "Phase 4: layering 门禁（外置激活必经 guard）+ 动态化文档两件套 + Note 收口

动机：门面纪律机械化（ctx.plugin 调用点白名单）；怎么写插件/怎么动态加载
两份常驻文档按 agent 可直接消费口径写，为后续 AI agent 阶段留地基。"
```

---

## 验收清单（人工）

- [ ] `pnpm tauri dev` 起真实 app：安装一个 hello 插件 → 不重启面板显示"运行中"，顶栏出现插件 UI
- [ ] 改插件代码 → 面板"重新加载"→ UI 即时更新；改坏 → 报错且旧版仍在跑
- [ ] "历史"里回退到上一代 → 内容与行为回到旧版
- [ ] 开关停用 → UI 消失；再启用 → 回来；移除 → 确认后消失且 `.history/<name>` 已删
- [ ] 开第二个窗口验证"他窗重启见"语义与常驻说明文案
