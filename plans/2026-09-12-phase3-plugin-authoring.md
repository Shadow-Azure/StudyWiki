# Phase 3 作者侧插件工具链 + 宿主加固收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把外置插件供应链补上作者侧（脚手架生成器 + 发布前校验 + 作者指南），同时收掉宿主侧既定加固欠账（fast-follow 五项 + 文件命令根域校验）。

**Architecture:** 生成器是仓库内的纯模板脚本（零新依赖，模板文本内嵌、spec 钉渲染字节）；加固全部落在既有文件的单点改动（Rust 安装管线 + lib.rs 命令面 + host 形状校验 + 面板 render）。发布产物除加固项外零变化。

**Tech Stack:** Rust（ureq Agent 超时、std::io::Take 上限、窗口注册表 roots 准源）、TypeScript/vitest、Node 脚本（模板生成器）、npm pack --dry-run（作者侧发布面真值）。

**Spec:** `.agents/notes/proposed/architecture/2026-09-12-phase3-plugin-authoring.md`（本计划从该 Note 论证；执行者两份都读）

## Global Constraints

- 环境无关铁律（docs/environment-independence.md 唯一 home）：发布产物零运行时依赖、零联网（安装动作豁免不变）；本阶段**零新增 Rust/npm 依赖**——esbuild/typescript 是生成物的 devDependencies，作者机器装，宿主 dep-audit 与发布产物不得见到。
- 分层纪律：`src/plugins/**` 禁值导入 `@tauri-apps/*` 与 `../host`（`pnpm verify:layering`）；`src/` 无新动态 import（装载缝白名单不动）。
- TS 导出与 Tauri 命令必须带文档注释（契约语义）；改命令注释后 `pnpm gen:commands` + `pnpm record:i18n -- docs/commands.md`。
- 常驻文档中英成对（三件套）：改任一侧最小修补另一侧重录；围栏与生成区逐字复制不翻译。
- 提交信息中文 + 正文说明动机；**不加 Co-Authored-By trailer**（仓库无此惯例）；每任务单提交。
- 测试即契约：TDD 红-绿；任何既有用例的红先怀疑实现。Rust 测试 fixture 用 `std::env::temp_dir()` 线程隔离。
- 脚手架生成物落 `plugins-dev/`（gitignored）；生成器本身（scripts/）不进 code-map（code-map 只管 src/ 与 src-tauri/）。
- AGENTS.md 命令清单加 `gen:plugin` 一行（CLAUDE.md 是其 symlink，自动跟随）；AGENTS.md 词数预算 690，超限按 docs/AGENTS.md 处置顺序。

---

### Task 1: Rust 加固捆包（Agent 超时 + 包大小上限 + entry 拒 package.json + 命令面根域校验）

**Files:**
- Modify: `src-tauri/src/plugins.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/windows.rs`
- Modify: `docs/commands.md` + `docs/commands.en.md` + `docs/commands.i18n.yaml`（gen:commands + record 重录）

**Interfaces:**
- Produces（后续任务依赖）: 无（加固不新增导出面）。`WindowRegistry::roots() -> Vec<PathBuf>` 新增 pub 方法（T1 内自用 + 测试）。

- [ ] **Step 1: 写失败测试（Rust）**

`src-tauri/src/plugins.rs` 测试模块追加（沿用既有 `package_json`/`build_tgz` helper 与手工 tar header 手法）：

```rust
#[test]
fn parse_rejects_entry_equal_package_json() {
    let raw = package_json("demo", Some("1.0.0"), Some("package.json"));
    let err = parse_package_json(&raw).unwrap_err();
    assert!(err.contains("不得是 package.json"), "{err}");
}

#[test]
fn read_capped_rejects_over_cap() {
    use std::io::Cursor;
    let big = vec![0u8; 101];
    assert!(read_capped(Cursor::new(big), 100).is_err());
    let ok = vec![0u8; 100];
    assert_eq!(read_capped(Cursor::new(ok), 100).unwrap().len(), 100);
}
```

`src-tauri/src/windows.rs` 测试模块追加：

```rust
#[test]
fn registry_roots_collects_set_roots_only() {
    let mut reg = WindowRegistry::default();
    reg.set_root("main", Some("/a".into()));
    reg.set_root("win-1", None);
    reg.set_root("win-2", Some("/b".into()));
    let mut roots = reg.roots();
    roots.sort();
    assert_eq!(roots, vec![std::path::PathBuf::from("/a"), std::path::PathBuf::from("/b")]);
}
```

`src-tauri/src/lib.rs` 末尾新增测试模块（lib.rs 现无测试模块）：

```rust
#[cfg(test)]
mod tests {
    use super::path_authorized;
    use crate::windows::WindowRegistry;

    #[test]
    fn path_authorized_accepts_root_and_nested() {
        let mut reg = WindowRegistry::default();
        reg.set_root("main", Some("/lib/root".into()));
        assert!(path_authorized(&reg, "/lib/root").is_ok());
        assert!(path_authorized(&reg, "/lib/root/sub/a.md").is_ok());
        // 词法按路径组件比对：前缀字符串相同但组件不同不算在内。
        assert!(path_authorized(&reg, "/lib/rootx/a.md").is_err());
    }

    #[test]
    fn path_authorized_rejects_outside_and_empty_registry() {
        let mut reg = WindowRegistry::default();
        reg.set_root("main", Some("/lib/root".into()));
        let err = path_authorized(&reg, "/etc/passwd").unwrap_err();
        assert!(err.contains("未授权"), "{err}");
        reg.set_root("main", None);
        assert!(path_authorized(&reg, "/lib/root/a.md").is_err());
    }
}
```

- [ ] **Step 2: 跑红**

`cd src-tauri && cargo test` — 预期编译错（`read_capped`/`roots`/`path_authorized` 不存在）。

- [ ] **Step 3: 实现**

`plugins.rs`：

```rust
use std::time::Duration;

/// tarball 大小上限（下载与本地导入共用）：封闭契约下单文件插件远低于此；
/// 超限 fail-loud（DoS 加固面，非安全边界）。
const MAX_TARBALL_BYTES: u64 = 20 * 1024 * 1024;

/// 联网共用 Agent：整体超时，registry/网络挂起时安装命令不再无限等待。
fn http_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(30))
        .build()
}

/// 读入至多 `cap` 字节；超出即 Err（点名上限）。
fn read_capped<R: std::io::Read>(mut r: R, cap: u64) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    r.take(cap + 1)
        .read_to_end(&mut buf)
        .map_err(|e| format!("读 tarball 失败：{e}"))?;
    if buf.len() as u64 > cap {
        return Err(format!("插件包超过 {cap} 字节上限"));
    }
    Ok(buf)
}
```

`parse_package_json` 在 entry 分隔符/`..` 检查之后追加：

```rust
    if block.entry == "package.json" {
        return Err(format!("studywiki.entry 不得是 package.json（{}）", pkg.name));
    }
```

`resolve_registry` 的 `ureq::get(&url)` 改 `http_agent().get(&url)`；`install_plugin` 改用：

```rust
    let bytes = http_agent()
        .get(&resolved.tarball)
        .call()
        .map_err(|e| format!("下载 tarball 失败：{e}"))?
        .into_reader();
    let bytes = read_capped(bytes, MAX_TARBALL_BYTES)?;
```

（`use std::io::Read;` 若不再需要 `read_to_end` 直接调用则删；以编译器为准。）

`import_plugin` 改用同一 helper：

```rust
    let file = fs::File::open(&path).map_err(|e| format!("读 {path} 失败：{e}"))?;
    let bytes = read_capped(file, MAX_TARBALL_BYTES)?;
```

`windows.rs` 在 `set_root` 之后加：

```rust
    /// 已设 root 的窗口根集合：文件命令根域校验的准源（None 不算授权）。
    pub fn roots(&self) -> Vec<std::path::PathBuf> {
        self.roots
            .values()
            .filter_map(|r| r.clone())
            .map(std::path::PathBuf::from)
            .collect()
    }
```

`lib.rs`：三条文件命令加 `state: tauri::State<'_, std::sync::Mutex<windows::WindowRegistry>>` 参数并先校验；doc comment 同步补契约语义（下例为 read_tree，另两条同形追加一句"路径须在已授权文件夹内"）：

```rust
/// 递归扫描打开的库根，返回整棵文件树。错误携带 OS 失败原文。
/// 路径必须落在窗口注册表已授权 root 之内（欢迎态无授权即拒——
/// 命令面与 assetProtocol 运行期授权同源收口）。
#[tauri::command]
fn read_tree(
    state: tauri::State<'_, std::sync::Mutex<windows::WindowRegistry>>,
    root: String,
) -> Result<Vec<FileNode>, String> {
    ensure_authorized(&state, &root)?;
    walk_dir(Path::new(&root))
}
```

`write_text_file` 校验 `path`（在 `std_write` 之前）；`read_text_file` 校验 `path`。纯判定函数：

```rust
/// 命令面根域校验（单一决策点）：路径须落在某个已授权 root 之内。
/// 词法 starts_with（路径组件级），与 assetProtocol 的 allow_directory 授权
/// 同源；symlink 跟随不在本层防线（停机坪）。
fn path_authorized(reg: &windows::WindowRegistry, path: &str) -> Result<(), String> {
    let p = Path::new(path);
    for root in reg.roots() {
        if p.starts_with(&root) {
            return Ok(());
        }
    }
    Err(format!("路径不在任何已授权文件夹内：{path}（先打开文件夹）"))
}

fn ensure_authorized(
    state: &tauri::State<'_, std::sync::Mutex<windows::WindowRegistry>>,
    path: &str,
) -> Result<(), String> {
    path_authorized(&state.lock().unwrap(), path)
}
```

注意：测试断言 `err.contains("未授权")`——错误文案含"未授权"三字（上面文案"不在任何已授权文件夹内"含"已授权"但不含"未授权"！把断言改为 `err.contains("先打开文件夹")` 或把文案改为含"未授权"。**取断言 `contains("先打开文件夹")`**，上面测试代码以最终断言为准改一处）。

- [ ] **Step 4: 跑绿 + 门禁**

`cd src-tauri && cargo fmt && cargo test`（15 + 5 新 = 20 通过）。`pnpm test`（241 全绿，TS 侧不受影响）。`pnpm gen:commands && pnpm record:i18n -- docs/commands.md`（三条命令 doc comment 变化入册）。`pnpm verify:docs`。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/plugins.rs src-tauri/src/lib.rs src-tauri/src/windows.rs docs/commands.md docs/commands.en.md docs/commands.i18n.yaml
git commit -m "Rust 加固捆包：联网超时与包上限、entry 拒 package.json、文件命令根域校验

ureq 共用 Agent 整体超时（30s）+ 下载/导入统一 read_capped 20MiB 上限，
registry 挂起或恶意大包不再无限等/吃内存；parse_package_json 拒
entry==package.json 封掉双 package.json 计数旁路；read_tree/read_text_file/
write_text_file 三命令路径须落窗口注册表已授权 root 内（欢迎态全拒），
dynamic-asset-scope 提案的命令侧收尾，与 assetProtocol 运行期授权同源。"
```

---

### Task 2: TS/面板加固（inject 严格化 + render 包错）

**Files:**
- Modify: `src/host/plugins.ts`
- Modify: `src/plugins/plugin-manager/index.ts`
- Modify: `tests/host-plugins.test.ts`
- Modify: `tests/plugin-manager.test.ts`

**Interfaces:**
- Consumes: `PluginsService.loadModule`（T4 形状校验所在）；面板 `render` 既有结构（errLine 持久元素跨 render 复用）。
- Produces: 无新导出；行为收紧（非法 inject 拒载、render 失败内联）。

- [ ] **Step 1: 写失败测试**

`tests/host-plugins.test.ts` 追加（沿用既有 fake deps 手法）：

```ts
test("loadModule: inject 非 undefined 且非字符串数组即拒（undefined 合法）", async () => {
  const bad = {
    invoke: async () => ({ code: "export const name=1", apiVersion: 1 }),
    loadExternal: async () => ({ name: "demo", apply: () => {}, inject: "slots" }),
    pickTgz: async () => null,
  };
  const svc = new PluginsService(bad);
  await expect(svc.loadModule("demo")).rejects.toThrow("inject 必须是字符串数组");

  const noInject = { ...bad, loadExternal: async () => ({ name: "demo", apply: () => {} }) };
  await expect(new PluginsService(noInject).loadModule("demo")).resolves.toMatchObject({ name: "demo" });
});
```

`tests/plugin-manager.test.ts` 追加（沿用既有 jsdom + `beforeEach` 清场）：

```ts
test("面板: readManifest 失败内联显示，不 unhandled rejection", async () => {
  const ctx = fakeCtx();
  ctx.plugins.readManifest = vi.fn().mockRejectedValue(new Error("清单不见了"));
  document.body.append(topbarButton(ctx));
  (document.querySelector("button") as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  const err = document.querySelector(".plugin-error");
  expect(err?.textContent).toContain("操作失败：清单不见了");
});
```

（`fakeCtx`/`topbarButton` 若无现成 helper，按既有用例 3/4 的 ctx 构造方式内联；用例名与断言以行为为准。）

- [ ] **Step 2: 跑红**

`pnpm test -- tests/host-plugins.test.ts tests/plugin-manager.test.ts` — 两条新用例红（inject 字符串透传现在不拒；readManifest reject 现在是 unhandled，`.plugin-error` 不出现）。

- [ ] **Step 3: 实现**

`src/host/plugins.ts` 替换 inject 检查：

```ts
    if (
      mod.inject !== undefined &&
      (!Array.isArray(mod.inject) || mod.inject.some((k) => typeof k !== "string"))
    ) {
      throw new Error(`外置插件 ${name}（${mod.name}）的 inject 必须是字符串数组`);
    }
```

`src/plugins/plugin-manager/index.ts` 的 `render` 整体包 try/catch（保留 JSON.parse 内层 catch 的"清单读取失败"语义）：

```ts
  const render = async () => {
    try {
      const raw = await ctx.plugins.readManifest();
      let manifest: Manifest;
      try {
        manifest = JSON.parse(raw ?? '{"plugins":[]}') as Manifest;
      } catch (e) {
        box.replaceChildren(errorLine(`清单读取失败：${(e as Error).message}`));
        return;
      }
      const entries = await ctx.plugins.list();
      // ……（既有主体不动：rows/list/head/installInput/head.append/replaceChildren）
      box.replaceChildren(head, list, errLine, hint);
    } catch (e) {
      showError(e);
      box.replaceChildren(head ?? errLine, errLine, hint);
    }
  };
```

（`head` 在 try 内声明则 catch 里不可见——catch 分支直接 `box.replaceChildren(errLine, hint)` 即可：读失败时面板只剩错误行与提示行，head/list 是陈旧状态不该保留。实现以此为准。）

- [ ] **Step 4: 跑绿 + 门禁**

`pnpm test`（241 + 2 = 243 全绿）、`pnpm build`、`pnpm verify:layering`、`pnpm verify:docs`。

- [ ] **Step 5: Commit**

```bash
git add src/host/plugins.ts src/plugins/plugin-manager/index.ts tests/host-plugins.test.ts tests/plugin-manager.test.ts
git commit -m "TS/面板加固：inject 非法形态拒载 + render 失败内联显示

外置模块 inject 非 undefined 且非字符串数组即拒（undefined 合法——inject
可选）；plugin-manager render 对 readManifest/list 的 reject 走 errLine 内联，
消灭 void 链上的 unhandled rejection。Phase 2 终审 fast-follow 五项全数收口。"
```

---

### Task 3: 脚手架生成器（gen:plugin + 内嵌模板 + spec 钉字节）

**Files:**
- Create: `scripts/gen-plugin-template.mjs`
- Create: `scripts/gen-plugin-template.spec.mjs`
- Modify: `.gitignore`
- Modify: `package.json`（scripts +1）
- Modify: `AGENTS.md`（命令清单 +1 行）

**Interfaces:**
- Produces: `pnpm gen:plugin -- <name>` → `plugins-dev/<name>/{package.json, src/index.ts, src/host.d.ts, scripts/check.mjs}`；导出 `validateName(name): boolean` 与 `renderTemplate(name): Record<string, string>`（spec 测试消费）。

- [ ] **Step 1: 写失败测试**

`scripts/gen-plugin-template.spec.mjs`（沿用既有 spec 风格，vitest 跑 .spec.mjs）：

```js
import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateName, renderTemplate } from "./gen-plugin-template.mjs";

test("validateName：小写/数字/连字符，禁大写点斜杠空", () => {
  expect(validateName("demo-hello")).toBe(true);
  expect(validateName("a")).toBe(true);
  expect(validateName("Demo")).toBe(false);
  expect(validateName("../evil")).toBe(false);
  expect(validateName("demo/hello")).toBe(false);
  expect(validateName("")).toBe(false);
});

test("renderTemplate：渲染字节钉死（契约漂移即红）", () => {
  const files = renderTemplate("demo-hello");
  expect(Object.keys(files).sort()).toEqual([
    "package.json",
    "scripts/check.mjs",
    "src/host.d.ts",
    "src/index.ts",
  ]);
  const pkg = JSON.parse(files["package.json"]);
  expect(pkg.name).toBe("demo-hello");
  expect(pkg.keywords).toContain("studywiki-plugin");
  expect(pkg.dependencies).toEqual({});
  expect(pkg.studywiki).toEqual({ apiVersion: 1, entry: "index.js" });
  expect(pkg.files).toEqual(["index.js"]);
  expect(pkg.scripts.prepublishOnly).toContain("build");
  expect(files["src/index.ts"]).toContain('export const name = "demo-hello";');
  // check.mjs 钉契约镜像断言的存在（防静默弱化）
  expect(files["scripts/check.mjs"]).toContain("studywiki-plugin");
  expect(files["scripts/check.mjs"]).toContain("npm pack");
});

test("check.mjs：好发布面过、三文件发布面拒（真实 npm pack --dry-run）", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sw-plugin-check-"));
  try {
    for (const [rel, content] of Object.entries(renderTemplate("demo-hello"))) {
      const t = path.join(dir, rel);
      mkdirSync(path.dirname(t), { recursive: true });
      writeFileSync(t, content);
    }
    writeFileSync(path.join(dir, "index.js"), "export const name='demo-hello';\n");
    const run = () =>
      execFileSync(process.execPath, [path.join(dir, "scripts", "check.mjs")], {
        cwd: dir,
        encoding: "utf8",
      });
    expect(run()).toContain("check: OK");
    writeFileSync(path.join(dir, "README.md"), "# hi\n");
    expect(() => run()).toThrow(/发布面/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 跑红**

`pnpm test -- scripts/gen-plugin-template.spec.mjs` — 模块不存在。

- [ ] **Step 3: 实现**

`scripts/gen-plugin-template.mjs` 完整结构（模板文本内嵌；示例值为准，实现者可微调空白但 spec 断言的键值必须成立）：

```js
#!/usr/bin/env node
// 插件脚手架生成器：pnpm gen:plugin -- <name> → plugins-dev/<name>/ 完整 npm 包。
// 模板内嵌本文件（仓库零新增依赖）；渲染字节由 spec 钉死——与宿主封闭契约的
// 漂移在 pnpm test 即红。esbuild/typescript 是生成物的 devDependencies，
// 装在作者机器，宿主 dep-audit 与发布产物不见。
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

/** 插件名规则：小写字母/数字/连字符（与宿主安装名同风格；拒路径形态）。 */
export function validateName(name) {
  return /^[a-z0-9][a-z0-9-]*$/.test(name) && name.length <= 100;
}

/** 渲染模板文件表（相对路径 → 内容）。唯一参数是插件名。 */
export function renderTemplate(name) {
  return {
    "package.json": JSON.stringify(
      {
        name,
        version: "0.1.0",
        description: "StudyWiki external plugin",
        keywords: ["studywiki-plugin"],
        type: "module",
        files: ["index.js"],
        scripts: {
          build: "esbuild src/index.ts --bundle --format=esm --outfile=index.js",
          check: "node scripts/check.mjs",
          prepublishOnly: "npm run build && npm run check",
        },
        devDependencies: {
          esbuild: "^0.25.0",
          typescript: "^5.6.0",
        },
        dependencies: {},
        studywiki: { apiVersion: 1, entry: "index.js" },
      },
      null,
      2,
    ) + "\n",
    "src/index.ts": `// 插件模块：name / inject / apply 三段式（cordis 契约子集）。
// 类型来自本地最小契约副本 ./host.d.ts（可能与宿主实现漂移，以作者指南为准）。
import type { Context } from "./host";

export const name = "${name}";
export const inject = ["slots"];

export function apply(ctx: Context): () => void {
  return ctx.slots.register("topbar.left", (el) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "hello";
    el.append(b);
  });
}
`,
    "src/host.d.ts": `// 本地最小类型副本：仅示例用到的一角（slots.register）。宿主真实
// Context 更大；权威契约见 StudyWiki 作者指南 docs/plugins/authoring.md。
export interface Context {
  slots: {
    register: (
      slot: string,
      render: (el: HTMLElement) => (() => void) | void,
    ): () => void;
  };
}
`,
    "scripts/check.mjs": `#!/usr/bin/env node
// 发布前机械校验（prepublishOnly 自动跑）：发布面恰好 package.json + 入口，
// studywiki 契约字段齐备——与宿主安装管线同一契约的作者侧镜像。
// fail at publish, not install。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const fail = (msg) => {
  console.error(\`check: FAIL \${msg}\`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes("studywiki-plugin"))
  fail("keywords 缺 studywiki-plugin");
if (!pkg.dependencies || Object.keys(pkg.dependencies).length > 0)
  fail("dependencies 必须为空对象（封闭契约：零依赖单文件）");
const sw = pkg.studywiki ?? {};
if (sw.apiVersion !== 1) fail("studywiki.apiVersion 必须为 1");
if (
  typeof sw.entry !== "string" ||
  !sw.entry ||
  sw.entry.includes("/") ||
  sw.entry.includes("\\\\") ||
  sw.entry.includes("..")
)
  fail("studywiki.entry 必须是顶层单文件");
if (sw.entry === "package.json") fail("studywiki.entry 不得是 package.json");
if (!Array.isArray(pkg.files) || pkg.files.length !== 1 || pkg.files[0] !== sw.entry)
  fail("files 必须只含入口文件");

const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" });
const files = JSON.parse(out)[0].files.map((f) => f.path).sort();
const expect = [sw.entry, "package.json"].sort();
if (JSON.stringify(files) !== JSON.stringify(expect))
  fail(\`发布面必须是恰好 \${expect.join(" + ")}，实际：\${files.join(", ")}\`);
console.log(\`check: OK（发布面 \${files.join(" + ")}）\`);
`,
  };
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const name = process.argv[2];
  if (!name) {
    console.error("用法：pnpm gen:plugin -- <name>");
    process.exit(2);
  }
  if (!validateName(name)) {
    console.error(\`插件名非法：\${name}（小写字母/数字/连字符）\`);
    process.exit(2);
  }
  const dir = path.join("plugins-dev", name);
  if (existsSync(dir)) {
    console.error(\`已存在：\${dir}\`);
    process.exit(2);
  }
  for (const [rel, content] of Object.entries(renderTemplate(name))) {
    const target = path.join(dir, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  console.log(\`已生成 \${dir}（下一步：cd \${dir} && npm install && npm run build）\`);
}
```

注意：上面 CLI 段的反引号是嵌套模板——实现时脚本本体用普通反引号，此处为计划文档转义显示；`npm pack --dry-run --json` 的 files[].path 形态以真实 npm 输出为准（macOS 本机验证），若带 `package/` 前缀则 strip 后比较，spec 第 3 用例是机械背书。

`.gitignore` 追加（`# SDD` 段之前）：

```
# 插件脚手架生成物（作者工作区，不进仓库）
plugins-dev/
```

`package.json` scripts 在 `gen:code-map` 之后加：`"gen:plugin": "node scripts/gen-plugin-template.mjs",`。`AGENTS.md` 命令清单 `gen:code-map` 行后加一行（沿用现有行格式）：

```
pnpm gen:plugin -- <name>  # 生成外置插件脚手架（plugins-dev/<name>，gitignored）
```

- [ ] **Step 4: 跑绿 + 门禁**

`pnpm test`（+3 spec 用例全绿）、`pnpm verify:dep-audit`（零变化）、`pnpm lint:docs`（AGENTS.md 预算内）、真实 CLI 冒烟：`pnpm gen:plugin -- demo-hello && ls plugins-dev/demo-hello && rm -rf plugins-dev`。

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-plugin-template.mjs scripts/gen-plugin-template.spec.mjs .gitignore package.json AGENTS.md
git commit -m "插件脚手架生成器：pnpm gen:plugin 内嵌模板落 plugins-dev/

作者侧工程起点：生成封闭契约 npm 包（package.json/src/index.ts/
host.d.ts/check.mjs），esbuild/typescript 是生成物 devDependencies
（作者机器装，宿主 dep-audit 与发布产物不见）；check.mjs 用
npm pack --dry-run 镜像宿主安装契约，fail at publish 而非 install。
渲染字节 spec 钉死，模板与宿主契约漂移在 pnpm test 即红。
生成物 plugins-dev/ 入 gitignore；AGENTS.md 命令清单 +1。"
```

---

### Task 4: 作者指南三件套（docs/plugins/authoring.md）

**Files:**
- Create: `docs/plugins/authoring.md` + `.en.md` + `.i18n.yaml`（record 生成）
- Modify: `docs/README.md` + `docs/README.en.md`（索引 +1 行，双侧）
- Modify: `scripts/doc-budgets.manifest.json`（+1 条，预算 700）

**Interfaces:**
- Consumes: Task 3 的 `gen:plugin` 用法与产物清单；Phase 2 Note 的封闭契约事实（现状口径转述，不复制生成区）。
- Produces: 常驻文档新叶（配对/预算/索引自动纳入；术语遵循 docs/i18n/terminology.md）。

- [ ] **Step 1: 登记 + 写中文侧**

`doc-budgets.manifest.json` 加 `"docs/plugins/authoring.md": 700`。中文侧结构（各节标题即下，正文"现在是什么"口径，不写变更史；总词数 ≤700）：

```markdown
# 外置插件作者指南

[English](authoring.en.md) | 中文

## 封闭契约（宿主机械校验，安装即拒）

| 项 | 要求 |
|---|---|
| tgz 内容 | 恰好 `package/package.json` + `package/<entry>` 两个文件（README/LICENSE 会被 npm 无条件打包，勿放） |
| keywords | 含 `studywiki-plugin` |
| dependencies | 空对象（零依赖单文件） |
| studywiki.apiVersion | `1`（宿主支持集 {1}，不符拒载） |
| studywiki.entry | 顶层单文件名（拒 `/`、`\`、`..`、`package.json`） |
| 大小上限 | 20 MiB（超限拒装点名上限） |
| 模块导出 | ESM：非空 `name`、函数 `apply`；`inject` 可选（缺省 `undefined`），给出时必须是字符串数组 |

## 快速开始

（gen:plugin 生成 → cd plugins-dev/<name> → npm install → npm run build → npm run check；每条命令一行说明）

## 在宿主里试装

（面板"本地导入…"选 tgz → 重启生效；无热装载——Phase 2 裁定：清单一致性/失败回滚/多窗同步的最简正确形态是下次 boot 见）

## 发布

（npm publish；prepublishOnly 自动 build + check；发布名即安装名；版本号即 `name@version` 安装形态）

## 信任模型与边界

（同进程全权：插件与宿主同一 webview JS 世界，Obsidian 前鉴；apiVersion + 零依赖 + 单文件是当前全部防线；作者侧类型是本地最小副本 ./src/host.d.ts，权威契约以本指南为准）
```

- [ ] **Step 2: 英文侧对译 + 索引 + 重录**

EN 侧最小修补对译（结构镜像、表格同序、术语按 terminology.md）。`docs/README.md` 与 `.en.md` 索引各 +1 行。`pnpm record:i18n -- docs/plugins/authoring.md` + `pnpm record:i18n -- docs/README.md`。

- [ ] **Step 3: 门禁**

`pnpm verify:docs`（19→20 叶全绿）、`pnpm lint:docs`、`node scripts/verify-doc-refs.mjs`（新叶内链可达）。

- [ ] **Step 4: Commit**

```bash
git add docs/plugins/authoring.md docs/plugins/authoring.en.md docs/plugins/authoring.i18n.yaml docs/README.md docs/README.en.md docs/README.i18n.yaml scripts/doc-budgets.manifest.json
git commit -m "外置插件作者指南：封闭契约全表 + 生成/构建/校验/发布全流程

docs/plugins/authoring.md 三件套入常驻文档体系（预算 700/配对/索引）：
契约表是宿主安装管线与模板 check.mjs 的同一契约的指南口径；内环
无热装载重启生效（Phase 2 裁定）；信任模型同进程全权如实披露。"
```

（README.i18n.yaml 若有 hash 变化一并 add；以 record 输出为准。）

---

### Task 5: 文档连锁 + Note 收口 + 全量门禁

**Files:**
- Modify: `scripts/code-map.manifest.json`（lib.rs 职责行）+ `docs/architecture.md` + `.en.md`（gen:code-map 重建）
- Modify: `src/boot-error.ts`（指引 +1 句）
- Rename: `.agents/notes/proposed/feature/2026-09-06-dynamic-asset-scope*` → `implemented/feature/`（Status: implemented）
- Rename: `.agents/notes/proposed/architecture/2026-09-12-phase3-plugin-authoring*` → `implemented/architecture/`（Status: implemented）
- Modify: 对应 `.i18n.yaml`（record 重录）

**Interfaces:**
- Consumes: T1–T4 全部落地事实。

- [ ] **Step 1: code-map 职责 + boot-error 文案**

`scripts/code-map.manifest.json` 中 `src-tauri/src/lib.rs` 职责更新为覆盖插件命令注册与根域校验现状（例：`tauri::Builder + 文件命令（路径根域校验）+ 窗口事件接线 + 命令注册总装`——以现状为准措辞）；`pnpm gen:code-map` 重建两侧生成区。`src/boot-error.ts` 的指引句追加"或重新打开文件夹"（既有句保留）。

- [ ] **Step 2: 两条 Note 三件套转 implemented**

- `git mv .agents/notes/proposed/feature/2026-09-12... `（注意是 2026-09-06-dynamic-asset-scope）三件套 → `implemented/feature/`；两侧第三行 `Status: proposed` → `Status: implemented`。
- Phase 3 Note 三件套 → `implemented/architecture/`；Status 同改。Note 内相对链接深度不变（proposed 与 implemented 同为二级目录），跑 `node scripts/verify-agent-notes.mjs` 确认。
- `pnpm record:i18n` 重录两条 Note。

- [ ] **Step 3: 全量门禁 + release 档**

```sh
pnpm test && pnpm build && pnpm verify:layering && pnpm verify:dep-audit && pnpm verify:env-independence && pnpm verify:commands && pnpm verify:docs && pnpm lint:docs
cd src-tauri && cargo fmt && cargo test
cd .. && pnpm tauri build --bundles app && pnpm verify:release
```

（darwin 本机完整 tauri build 的 dmg 步会移除 .app 致 verify:release fail-loud——已知 quirk，直接 `--bundles app`。）

- [ ] **Step 4: Commit（单提交收口）**

```bash
git add scripts/code-map.manifest.json docs/architecture.md docs/architecture.en.md src/boot-error.ts .agents/notes
git commit -m "Phase 3 文档连锁收口：lib.rs 职责入 code-map，两条 Note 转 implemented

code-map 补 lib.rs 职责现状（文件命令根域校验 + 插件命令注册总装）；
boot-error 指引补"或重新打开文件夹"；dynamic-asset-scope 提案
（协议面 Phase 2 落地 + 命令面本阶段落地）与 Phase 3 Note 转
implemented。全量门禁 + release 档绿。"
```

（`docs/architecture.i18n.yaml` 若 record 重录有变化一并 add。）

---

## 手工验收清单（PR 描述随附）

前置：`pnpm tauri dev`。

1. **脚手架端到端**：`pnpm gen:plugin -- demo-hello` → `cd plugins-dev/demo-hello && npm install && npm run build && npm run check`（check: OK）→ 宿主面板"本地导入…"选 `plugins-dev/demo-hello/demo-hello-0.1.0.tgz`（先 `npm pack`）→ 重启 → 顶栏出现 hello 按钮。
2. **check.mjs 红路径**：生成物里加一个 `README.md` → `npm run check` → FAIL（发布面三文件）。
3. **根域校验**：未开文件夹（欢迎态）下应用正常；开文件夹后树/编辑/保存正常；关掉所有窗口重开（欢迎态）一切正常。
4. **加固超时**：断网点名安装 → 内联报错（不再无限挂起）。
5. **entry 拒 package.json**：手工构造 entry 为 package.json 的 tgz 导入 → 拒（点名"不得是 package.json"）。
6. **面板读失败**：（需要人为破坏才可达，可选）清单读取失败时面板内联报错不白屏。

## 执行注意

- 任务顺序 1→5；T1/T2 相互独立、T3 独立，但提交按序落同一分支、按任务独立提交。
- `pnpm test` 是门禁自测试 + 应用测试总和；任何既有用例的红先怀疑实现。
- 蓝本代码以分支 `phase3-plugin-authoring`（基点 4b6827f）现状为准；Tauri/ureq 小版本 API 形态漂移以编译器为准微调调用形态，语义不变即不算偏离计划。
