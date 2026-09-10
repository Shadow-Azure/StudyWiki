#!/usr/bin/env node
// 发布产物动态链接扫描：darwin otool / linux ldd（win32 显式跳过提示）。环境无关铁律的产物侧背书。
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** darwin 链接白名单前缀（@rpath/@executable_path 视为包内）。 */
export const DARWIN_PREFIXES = ["/usr/lib/", "/System/", "@rpath/", "@executable_path"];
/** linux 系统运行时库白名单（so 名精确匹配）。 */
export const LINUX_LIBS = new Set([
  "libc.so.6", "libgcc_s.so.1", "libm.so.6", "libpthread.so.0",
  "libdl.so.2", "ld-linux-x86-64.so.2", "ld-linux-aarch64.so.1", "linux-vdso.so.1",
]);

/**
 * Lift dependency lines out of `otool -L` output (drop the header line).
 * @param {string} output `otool -L` 的完整 stdout（首行是产物自身路径头）。
 * @returns {string[]} 依赖行列表（trim 后，空行剔除）。
 */
export function parseOtool(output) {
  return output.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
}

/**
 * Darwin audit: any line not starting with an allowed prefix is bad.
 * @param {string[]} lines parseOtool 抬出的依赖行。
 * @returns {string[]} 白名单外的依赖行（空数组即 darwin 侧合规）。
 */
export function auditDarwinLinks(lines) {
  return lines.filter((l) => !DARWIN_PREFIXES.some((p) => l.startsWith(p)));
}

/**
 * Linux audit: so names outside the system set are bad.
 * @param {string[]} lines `ldd` 的逐行输出。
 * @returns {string[]} 系统运行时白名单外的 so 依赖（空数组即 linux 侧合规）。
 */
export function auditLinuxLinks(lines) {
  return lines
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((name) => name.endsWith(".so") || /\.so\./.test(name))
    .filter((name) => !LINUX_LIBS.has(name));
}

/** Collect scannable binaries: darwin = every .app/Contents/MacOS file;
 * linux = the raw release binary (same link set as the deb/AppImage payload). */
function collectBinaries(root, bundleDir) {
  const out = [];
  const macosDir = path.join(bundleDir, "macos");
  if (existsSync(macosDir)) {
    for (const app of readdirSync(macosDir).filter((n) => n.endsWith(".app"))) {
      const binDir = path.join(macosDir, app, "Contents/MacOS");
      if (!existsSync(binDir)) continue;
      for (const f of readdirSync(binDir, { withFileTypes: true })) {
        if (f.isFile()) out.push(path.join(binDir, f.name));
      }
    }
  }
  // linux：productName 归一化（StudyWiki → studywiki）定位裸二进制
  const conf = JSON.parse(readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const binName = String(conf.productName ?? "studywiki").toLowerCase().replace(/[^a-z0-9-]/g, "");
  const linuxBin = path.join(root, "src-tauri/target/release", binName);
  if (process.platform === "linux" && existsSync(linuxBin)) out.push(linuxBin);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.platform === "win32") {
    console.log("[native-links] win32：显式跳过（未发 Windows 档；发版前补扫并更新本提示）");
    process.exit(0);
  }
  // cwd 相对（pnpm script 保证从仓库根跑），同 verify-dep-audit/verify-layering 既有门禁；
  // 本脚本无脚本旁静态文件，全部读取都随 root 走。
  const root = process.cwd();
  const bundleDir = path.join(root, "src-tauri/target/release/bundle");
  const binaries = collectBinaries(root, bundleDir);
  if (binaries.length === 0) {
    console.log("[native-links] 跳过：未找到发布产物（先 pnpm tauri build；release 档在其后运行）");
    process.exit(0);
  }
  const bad = [];
  for (const bin of binaries) {
    // otool 必须 -L 列依赖；glibc ldd 无 -L 选项，直接吃产物路径
    const tool = process.platform === "darwin" ? "otool" : "ldd";
    const args = process.platform === "darwin" ? ["-L", bin] : [bin];
    const out = execFileSync(tool, args, { encoding: "utf8" });
    const violations = process.platform === "darwin" ? auditDarwinLinks(parseOtool(out)) : auditLinuxLinks(out.split("\n"));
    for (const v of violations) bad.push(`${bin} → ${v}`);
  }
  if (bad.length) {
    console.error(`[native-links] 动态链接扫描失败（${bad.length} 项）：`);
    for (const b of bad) console.error(`  - ${b}`);
    process.exit(1);
  }
  console.log(`[native-links] 动态链接扫描通过（${binaries.length} 个产物）`);
}
