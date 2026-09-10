import { expect, test } from "vitest";
import {
  parseOtool,
  auditDarwinLinks,
  auditLinuxLinks,
  LINUX_LIBS,
  resolveLinuxBinName,
  shouldFailLoud,
} from "./verify-native-links.mjs";

const otoolSample = `/path/to/StudyWiki.app/Contents/MacOS/studywiki:
\t/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit (compatibility version 45.0.0)
\t/usr/lib/libc++.1.dylib (compatibility version 1.0.0)
\t@rpath/libTauri.dylib (compatibility version 1.0.0)
\t@executable_path/../Frameworks/libWebView.dylib (compatibility version 1.0.0)
\t/opt/homebrew/lib/libshark.dylib (compatibility version 3.0.0)
`;

test("parseOtool 抬出依赖行", () => {
  expect(parseOtool(otoolSample)).toHaveLength(5);
});

test("darwin: 白名单前缀放行，homebrew 路径红", () => {
  const bad = auditDarwinLinks(parseOtool(otoolSample));
  expect(bad).toEqual([expect.stringContaining("/opt/homebrew/lib/libshark.dylib")]);
});

test("linux: 系统 C 运行时放行，其他 so 红", () => {
  const lines = ["libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6", "libssh.so.4 => /usr/lib/libssh.so.4"];
  const bad = auditLinuxLinks(lines);
  expect(bad).toEqual([expect.stringContaining("libssh.so.4")]);
  expect(LINUX_LIBS.has("libc.so.6")).toBe(true);
});

// 真实 Cargo.toml 形态：[package].name 是 study-wiki，后续 [lib] 段还有同名键
const cargoSample = `[package]
name = "study-wiki"
version = "0.1.0"

[lib]
name = "study_wiki_lib"
crate-type = ["staticlib", "cdylib", "rlib"]
`;

test("resolveLinuxBinName 取 [package].name（cargo 产物名权威源，不做 productName 式归一化）", () => {
  expect(resolveLinuxBinName(cargoSample)).toBe("study-wiki");
  expect(resolveLinuxBinName(cargoSample)).not.toBe("studywiki");
});

test("resolveLinuxBinName 段隔离：[package] 之外的 name 不认，缺段缺键回 null", () => {
  expect(resolveLinuxBinName(`name = "stray"\n[lib]\nname = "x"`)).toBeNull();
  expect(resolveLinuxBinName(`[package]\nversion = "0.1.0"`)).toBeNull();
});

test("shouldFailLoud：bundle 在且产物空才响，未构建与有产物都不响", () => {
  expect(shouldFailLoud([], true)).toBe(true);
  expect(shouldFailLoud([], false)).toBe(false);
  expect(shouldFailLoud(["/x/target/release/study-wiki"], true)).toBe(false);
});
