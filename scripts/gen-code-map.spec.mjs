// 门禁自测试：gen-code-map 的纯函数层——登记对账（漏登记/孤儿/缺根描述）、
// 内部依赖推导（TS 相对 import、Rust mod 与 lib crate 引用）、树渲染对齐与
// splice；外加真仓库不变量（对账通过、两侧生成区与重生成逐字一致——等价于
// --check 的 spec 侧背书，src 改动没重生成时 pnpm test 即红）。

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  REGION_MARKERS,
  SCAN_ROOTS,
  collectSourceFiles,
  deriveDeps,
  parseLibName,
  reconcileManifest,
  renderTree,
  resolveTsSpec,
  rustModNames,
  spliceRegion,
  tsImportSpecs,
} from "./gen-code-map.mjs";

const tmpDirs = [];
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

/** 临时仓库夹具：写入给定相对路径 → 内容。 */
function fixtureRepo(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "studywiki-code-map-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  tmpDirs.push(dir);
  return dir;
}

describe("collectSourceFiles", () => {
  it("收 ts/css/rs、递归子目录、排除其他扩展名", async () => {
    const dir = fixtureRepo({
      "src/main.ts": "",
      "src/styles.css": "",
      "src/nested/util.ts": "",
      "src/README.md": "",
      "src/app.jsx": "",
      "src-tauri/src/lib.rs": "",
      "src-tauri/src/deep/mod.rs": "",
      "src-tauri/src/notes.txt": "",
    });
    // 码点排序：'-'(0x2D) < '/'(0x2F)，所以 src-tauri/… 排在 src/… 之前；
    // 树上的顺序由 SCAN_ROOTS 决定，与此排序无关。
    expect(await collectSourceFiles(dir)).toEqual([
      "src-tauri/src/deep/mod.rs",
      "src-tauri/src/lib.rs",
      "src/main.ts",
      "src/nested/util.ts",
      "src/styles.css",
    ]);
  });

  it("扫描根缺失不炸（空仓库形态）", async () => {
    const dir = fixtureRepo({});
    expect(await collectSourceFiles(dir)).toEqual([]);
  });
});

describe("reconcileManifest", () => {
  const files = ["src/main.ts", "src/styles.css", "src-tauri/src/lib.rs"];
  const manifest = {
    src: "前端",
    "src/main.ts": "入口",
    "src/styles.css": "样式",
    "src-tauri": "壳",
    "src-tauri/src/lib.rs": "命令",
    vendor: "vendored",
  };

  it("全部登记时通过", () => {
    expect(reconcileManifest(files, manifest)).toEqual([]);
  });

  it("新文件漏登记即红（css 也在扫描面内）", () => {
    const errors = reconcileManifest([...files, "src/theme.css"], manifest);
    expect(errors.join("\n")).toContain("src/theme.css");
  });

  it("登记了已删除的文件即红（删码不清账）", () => {
    const errors = reconcileManifest(files.slice(0, 2), manifest);
    expect(errors.join("\n")).toContain("src-tauri/src/lib.rs");
  });

  it("根目录缺职责登记即红", () => {
    const { src, ...rest } = manifest;
    const errors = reconcileManifest(files, rest);
    expect(errors.join("\n")).toContain('"src"');
  });
});

describe("TS 依赖推导", () => {
  it("import type / 副作用 import / 相对路径都算，外部包不算", () => {
    const source = [
      'import MarkdownIt from "markdown-it";',
      'import { invoke } from "@tauri-apps/api/core";',
      'import type { LibraryEntry } from "./types";',
      'import "./styles.css";',
      'export { helper } from "../lib/helper";',
    ].join("\n");
    expect(tsImportSpecs(source)).toEqual(["./types", "./styles.css", "../lib/helper"]);
  });

  it("无扩展名解析到 .ts，解析不到返回 null", () => {
    const known = new Set(["src/types.ts", "src/main.ts"]);
    expect(resolveTsSpec("src/main.ts", "./types", known)).toBe("src/types.ts");
    expect(resolveTsSpec("src/main.ts", "./styles.css", known)).toBeNull();
    expect(resolveTsSpec("src/a/b.ts", "../main", known)).toBe("src/main.ts");
  });

  it("边只进已知源文件，自指不算", () => {
    const known = new Set(["src/main.ts", "src/types.ts", "src/styles.css"]);
    expect(deriveDeps("src/main.ts", 'import x from "./types"; import "./styles.css";', known, "")).toEqual(
      ["src/styles.css", "src/types.ts"],
    );
    expect(deriveDeps("src/main.ts", 'import x from "./main";', known, "")).toEqual([]);
  });
});

describe("Rust 依赖推导", () => {
  it("mod x; 算文件模块，内联 mod x { 不算", () => {
    const source = ["pub mod foo;", "mod bar;", "#[cfg(test)]", "mod tests {", "}"].join("\n");
    expect(rustModNames(source)).toEqual(["foo", "bar"]);
  });

  it("lib crate 引用成边指向 lib.rs，lib.rs 自身不算", () => {
    const known = new Set(["src-tauri/src/lib.rs", "src-tauri/src/main.rs"]);
    expect(deriveDeps("src-tauri/src/main.rs", "fn main() { study_wiki_lib::run() }", known, "study_wiki_lib")).toEqual([
      "src-tauri/src/lib.rs",
    ]);
    expect(deriveDeps("src-tauri/src/lib.rs", "use study_wiki_lib::x;", known, "study_wiki_lib")).toEqual([]);
  });

  it("Cargo.toml 显式 [lib] name 优先，缺省回退包名 + _lib", () => {
    expect(parseLibName('[package]\nname = "a-b"\n[lib]\nname = "custom_lib"\ncrate-type = ["cdylib"]')).toBe(
      "custom_lib",
    );
    expect(parseLibName('[package]\nname = "a-b"\n')).toBe("a_b_lib");
  });
});

describe("renderTree 与 splice", () => {
  const files = ["src/main.ts", "src/styles.css", "src/types.ts", "src-tauri/src/lib.rs", "src-tauri/src/main.rs"];
  const manifest = {
    src: "前端（TypeScript + Vite，无 UI 框架）",
    "src/main.ts": "入口：侧栏文件列表 + 查看器分发",
    "src/types.ts": "LibraryEntry —— 前后端共享的唯一形状",
    "src/styles.css": "样式（无逻辑）",
    "src-tauri": "Rust 壳",
    "src-tauri/src/lib.rs": "tauri::Builder + 两条命令",
    "src-tauri/src/main.rs": "入口壳（Windows 隐藏控制台）",
    vendor: "vendored 上游源码",
  };
  const deps = {
    "src/main.ts": ["src/styles.css", "src/types.ts"],
    "src-tauri/src/main.rs": ["src-tauri/src/lib.rs"],
  };

  it("列对齐、依赖后缀、无依赖不加后缀", () => {
    expect(renderTree(files, manifest, deps)).toBe(
      [
        "```text",
        "src/          前端（TypeScript + Vite，无 UI 框架）",
        "  main.ts     入口：侧栏文件列表 + 查看器分发（→ styles.css、types.ts）",
        "  styles.css  样式（无逻辑）",
        "  types.ts    LibraryEntry —— 前后端共享的唯一形状",
        "src-tauri/    Rust 壳",
        "  lib.rs      tauri::Builder + 两条命令",
        "  main.rs     入口壳（Windows 隐藏控制台）（→ lib.rs）",
        "vendor/       vendored 上游源码",
        "```",
      ].join("\n"),
    );
  });

  it("splice 只动标记之间，标记缺失即抛", () => {
    const region = [REGION_MARKERS.BEGIN, renderTree(files, manifest, {}), REGION_MARKERS.END].join("\n");
    const doc = ["# 标题", "", REGION_MARKERS.BEGIN, "旧内容", REGION_MARKERS.END, "", "尾部"].join("\n");
    expect(spliceRegion(doc, region)).toBe(["# 标题", "", region, "", "尾部"].join("\n"));
    expect(() => spliceRegion("没有标记", region)).toThrow("标记对");
  });
});

describe("真仓库不变量", () => {
  it("manifest 与磁盘对账通过（styles.css 在扫描面内）", async () => {
    const manifest = JSON.parse(await readFile("scripts/code-map.manifest.json", "utf8"));
    const files = await collectSourceFiles();
    expect(files).toContain("src/styles.css");
    expect(reconcileManifest(files, manifest)).toEqual([]);
  });

  it("两侧生成区与重生成逐字一致（= --check 的 spec 侧背书）", async () => {
    const manifest = JSON.parse(await readFile("scripts/code-map.manifest.json", "utf8"));
    const files = await collectSourceFiles();
    const known = new Set(files);
    const libName = parseLibName(await readFile("src-tauri/Cargo.toml", "utf8"));
    const depsByFile = {};
    for (const file of files)
      depsByFile[file] = deriveDeps(file, await readFile(file, "utf8"), known, libName);
    const region = [REGION_MARKERS.BEGIN, renderTree(files, manifest, depsByFile), REGION_MARKERS.END].join("\n");
    for (const doc of ["docs/architecture.md", "docs/architecture.en.md"])
      expect(spliceRegion(await readFile(doc, "utf8"), region)).toBe(await readFile(doc, "utf8"));
  });

  it("扫描根与 manifest 根键一一对应（加第三个根须同步两处）", () => {
    const manifest = JSON.parse(readFileSync("scripts/code-map.manifest.json", "utf8"));
    for (const { display } of SCAN_ROOTS) expect(manifest[display]).toBeTypeOf("string");
  });
});
