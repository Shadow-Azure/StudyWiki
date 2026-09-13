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

/** 渲染模板文件表（相对路径 → 内容）。唯一参数是插件名。
 * 模板不带 README：npm 无条件把 README/package.json 打进 tgz，带 README 的
 * 发布面必为三文件，撞宿主"恰好两文件"封闭契约。 */
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
// Context 更大；权威契约见 StudyWiki 作者指南 \`docs/plugins/authoring.md\`。
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
// 发布前机械校验（prepublishOnly 自动跑）：npm pack --dry-run 断言发布面
// 恰好 package.json + 入口，studywiki 契约字段齐备——与宿主安装管线
// 同一契约的作者侧镜像。fail at publish, not install。
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
// npm 各版本 files[].path 形态不一（新版无前缀，旧版带 package/ 前缀）——
// 统一剥前缀再比（生成环境 npm 11.12.1 实测无前缀，此处为防御性 no-op）。
const files = JSON.parse(out)[0].files
  .map((f) => (f.path.startsWith("package/") ? f.path.slice("package/".length) : f.path))
  .sort();
const expect = [sw.entry, "package.json"].sort();
if (JSON.stringify(files) !== JSON.stringify(expect))
  fail(\`发布面必须是恰好 \${expect.join(" + ")}，实际：\${files.join(", ")}\`);
console.log(\`check: OK（发布面 \${files.join(" + ")}）\`);
`,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv.slice(2).filter((a) => a !== "--")[0]; // pnpm run 会把 -- 分隔符原样透传
  if (!name) {
    console.error("用法：pnpm gen:plugin -- <name>");
    process.exit(2);
  }
  if (!validateName(name)) {
    console.error(`插件名非法：${name}（小写字母/数字/连字符）`);
    process.exit(2);
  }
  const dir = path.join("plugins-dev", name);
  if (existsSync(dir)) {
    console.error(`已存在：${dir}`);
    process.exit(2);
  }
  for (const [rel, content] of Object.entries(renderTemplate(name))) {
    const target = path.join(dir, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  console.log(`已生成 ${dir}（下一步：cd ${dir} && npm install && npm run build）`);
}
