// 门禁自测试：命令目录生成器——解析（文档注释、签名、注册表双向一致）、
// 生成区拼接（标记对、区块外保留）、--check 新鲜度（写→查→篡改→红）。
// 纯函数走静态导入；CLI 走子进程在临时 fixture 里跑（cwd 即仓库根）。

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { fileModuleNames, parseCommands, renderRegion, spliceRegion } from "./gen-commands-catalog.mjs";

const SCRIPT = path.resolve("scripts/gen-commands-catalog.mjs");
const BEGIN = "<!-- BEGIN GENERATED commands-catalog (scripts/gen-commands-catalog.mjs) — do not edit between markers -->";
const END = "<!-- END GENERATED commands-catalog -->";

const LIB = `use std::fs;

/// Reads a file.
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_folder(root: String) -> String {
    root
}

fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_file, open_folder])
        .run(tauri::generate_context!())
        .expect("err");
}
`;

describe("parseCommands", () => {
  it("按出现顺序提取文档注释与签名", () => {
    const commands = parseCommands(LIB);
    expect(commands.map((c) => c.name)).toEqual(["read_file", "open_folder"]);
    expect(commands[0].docs).toEqual(["Reads a file."]);
    expect(commands[0].signature).toBe("fn read_file(path: String) -> Result<String, String>");
    expect(commands[1].docs).toEqual([]);
  });
  it("命令未注册即抛", () => {
    const unregistered = LIB.replace(", open_folder]", "]");
    expect(() => parseCommands(unregistered)).toThrow("未注册：open_folder");
  });
  it("注册无对应命令即抛", () => {
    const undeclared = LIB.replace(", open_folder]", ", open_folder, ghost_cmd]");
    expect(() => parseCommands(undeclared)).toThrow("未声明：ghost_cmd");
  });
});

describe("parseCommands：模块命令（mod:: 前缀）", () => {
  const LIB_MOD = `use std::fs;

/// Reads a file.
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

mod windows;

fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![read_file, windows::create_view])
        .run(tauri::generate_context!())
        .expect("err");
}
`;
  const WINDOWS_MOD = `use tauri::AppHandle;

/// Creates a view window.
#[tauri::command]
pub fn create_view(
    app: AppHandle,
    root: String,
) -> String {
    root
}
`;

  it("模块命令按注册项逐字收编（mod:: 名），签名与文档取自模块文件", () => {
    const commands = parseCommands(LIB_MOD, { windows: WINDOWS_MOD });
    expect(commands.map((c) => c.name)).toEqual(["read_file", "windows::create_view"]);
    expect(commands[1].docs).toEqual(["Creates a view window."]);
    // rustfmt 换行的参数表收敛成单行签名
    expect(commands[1].signature).toBe("pub fn create_view(app: AppHandle, root: String) -> String");
  });

  it("模块命令未注册即抛", () => {
    const noHandler = LIB_MOD.replace(", windows::create_view]", "]");
    expect(() => parseCommands(noHandler, { windows: WINDOWS_MOD })).toThrow(
      "未注册：windows::create_view",
    );
  });

  it("注册了不存在的模块命令即抛", () => {
    const ghost = LIB_MOD.replace("windows::create_view", "windows::ghost_cmd");
    expect(() => parseCommands(ghost, { windows: WINDOWS_MOD })).toThrow(
      "未声明：windows::ghost_cmd",
    );
  });

  it("fileModuleNames 只认文件模块（分号），不认内联模块", () => {
    expect(fileModuleNames("mod a;\npub mod b;\nmod c { }\nmod d{")).toEqual(["a", "b"]);
  });
});

describe("renderRegion / spliceRegion", () => {
  it("渲染注册表与 /// 搬运", () => {
    const region = renderRegion(parseCommands(LIB));
    expect(region.startsWith(BEGIN)).toBe(true);
    expect(region.endsWith(END)).toBe(true);
    expect(region).toContain("// Registered: read_file, open_folder");
    expect(region).toContain("/// Reads a file.");
    expect(region).toContain("#[tauri::command]");
    expect(region).toContain("fn read_file(path: String) -> Result<String, String>;");
  });
  it("拼接保留区块外内容", () => {
    const doc = `# Commands\n\n${BEGIN}\nstale\n${END}\n\ntail prose\n`;
    const next = spliceRegion(doc, renderRegion(parseCommands(LIB)));
    expect(next.startsWith("# Commands\n\n" + BEGIN)).toBe(true);
    expect(next.endsWith(END + "\n\ntail prose\n")).toBe(true);
    expect(next).not.toContain("stale");
  });
  it("缺标记对即抛", () => {
    expect(() => spliceRegion("# Commands\n\n无标记\n", "x")).toThrow(
      "缺 commands-catalog 生成区标记对",
    );
  });
});

describe("CLI --check 新鲜度（子进程）", () => {
  const dirs = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  function fixture() {
    const dir = mkdtempSync(path.join(tmpdir(), "studywiki-gen-commands-"));
    dirs.push(dir);
    const doc = `# Commands\n\n${BEGIN}\nstale\n${END}\n`;
    for (const target of ["docs/commands.md", "docs/commands.en.md"]) {
      mkdirSync(path.dirname(path.join(dir, target)), { recursive: true });
      writeFileSync(path.join(dir, target), doc);
    }
    mkdirSync(path.join(dir, "src-tauri/src"), { recursive: true });
    writeFileSync(path.join(dir, "src-tauri/src/lib.rs"), LIB);
    return dir;
  }
  const run = (dir, args = []) =>
    execFileSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: "utf8" });

  it("写模式重生成 → --check 新鲜；篡改生成区 → --check 红", () => {
    const dir = fixture();
    run(dir); // 写模式
    const generated = readFileSync(path.join(dir, "docs/commands.md"), "utf8");
    expect(generated).toContain("/// Reads a file.");
    expect(generated.startsWith("# Commands\n\n" + BEGIN)).toBe(true); // 区块外保留
    expect(generated).not.toContain("stale"); // 旧内容清空
    run(dir, ["--check"]); // 新鲜，退出 0

    const tampered = generated.replace("/// Reads a file.", "/// 被手改了。");
    writeFileSync(path.join(dir, "docs/commands.md"), tampered);
    expect(() => run(dir, ["--check"])).toThrow();
  });
});

describe("真仓库不变量", () => {
  it("lib.rs 命令（含 mod:: 模块命令）重生成与 docs/commands.md 生成区逐字一致", async () => {
    const lib = await readFile("src-tauri/src/lib.rs", "utf8");
    const moduleSources = {};
    for (const name of fileModuleNames(lib))
      moduleSources[name] = await readFile(`src-tauri/src/${name}.rs`, "utf8");
    const commands = parseCommands(lib, moduleSources);
    expect(commands.map((c) => c.name)).toContain("windows::create_window");
    const doc = await readFile("docs/commands.md", "utf8");
    expect(spliceRegion(doc, renderRegion(commands))).toBe(doc);
  });
});
