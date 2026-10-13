#!/usr/bin/env node
// Gate: Install a generated macOS DMG into an isolated directory and prove
// Finder's normal Launch Services path can launch it. CI macOS lanes only.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { isStableBundleIdentifier } from "./verify-env-independence.mjs";

const run = promisify(execFile);

export { isStableBundleIdentifier };

async function walkFiles(root) {
  const out = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...await walkFiles(full));
    else out.push(full);
  }
  return out;
}

/** Find exactly one DMG; callers should pass an explicit path when builds can emit multiple. */
export async function findDmg(root) {
  const found = (await walkFiles(root)).filter((file) => file.endsWith(".dmg"));
  if (found.length === 0) throw new Error(`未找到 DMG：${root}`);
  if (found.length > 1) throw new Error(`找到多个 DMG，请显式指定：${found.join(", ")}`);
  return path.resolve(found[0]);
}

/** Structural checks run before codesign so failures name the missing bundle part. */
export function collectBundleErrors(app) {
  const required = [
    "Contents/Info.plist",
    "Contents/MacOS/study-wiki",
    "Contents/Resources/icon.icns",
    "Contents/_CodeSignature/CodeResources",
  ];
  return required
    .filter((relative) => !existsSync(path.join(app, relative)))
    .map((relative) => `缺少 ${relative}`);
}

/** Compare the installed identity with the Tauri config that produced the DMG. */
export function plistIdentityErrors(info, identifier) {
  const errors = [];
  if (info?.CFBundleIdentifier !== identifier) {
    errors.push(`CFBundleIdentifier 应为 ${identifier}，实际 ${info?.CFBundleIdentifier ?? "缺失"}`);
  }
  if (!isStableBundleIdentifier(info?.CFBundleIdentifier)) {
    errors.push("CFBundleIdentifier 不能以 .app 结尾，且须为 reverse-DNS");
  }
  if (info?.CFBundleExecutable !== "study-wiki") {
    errors.push(`CFBundleExecutable 应为 study-wiki，实际 ${info?.CFBundleExecutable ?? "缺失"}`);
  }
  if (info?.CFBundleName !== "StudyWiki") {
    errors.push(`CFBundleName 应为 StudyWiki，实际 ${info?.CFBundleName ?? "缺失"}`);
  }
  return errors;
}

/** Find the app bundle itself, not files nested inside it. */
export async function findApp(root) {
  const apps = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name === "StudyWiki.app") apps.push(full);
    else apps.push(...await findApp(full));
  }
  if (apps.length === 0) throw new Error(`挂载卷中未找到 StudyWiki.app：${root}`);
  if (apps.length > 1) throw new Error(`挂载卷中出现多个 app：${apps.join(", ")}`);
  return apps[0];
}

async function pidsFor(binary) {
  try {
    const { stdout } = await run("pgrep", ["-f", binary]);
    return stdout.trim().split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function verifyStandardLaunch(installedApp) {
  const binary = path.join(installedApp, "Contents/MacOS/study-wiki");
  const before = new Set(await pidsFor(binary));
  await run("/usr/bin/open", ["-n", "-g", installedApp]);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const fresh = (await pidsFor(binary)).filter((pid) => !before.has(pid));
    if (fresh.length > 0) {
      await sleep(750);
      const alive = (await pidsFor(binary)).filter((pid) => fresh.includes(pid));
      if (alive.length === 0) throw new Error("应用进程在 Launch Services 启动后立即退出");
      for (const pid of alive) process.kill(pid, "SIGTERM");
      return;
    }
    await sleep(250);
  }
  throw new Error("标准 open 未在 10 秒内启动应用进程");
}

async function verifyPackage(dmgPath) {
  if (process.platform !== "darwin") throw new Error("verify-macos-package 只能在 macOS 执行");
  const conf = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
  if (!isStableBundleIdentifier(conf.identifier)) {
    throw new Error(`Tauri identifier 非法：${conf.identifier}`);
  }
  if (!existsSync(dmgPath)) throw new Error(`DMG 不存在：${dmgPath}`);

  const work = await mkdtemp(path.join(tmpdir(), "studywiki-package-smoke-"));
  const mount = path.join(work, "mount");
  const applications = path.join(work, "Applications");
  let mounted = false;
  try {
    await mkdir(mount, { recursive: true });
    await mkdir(applications, { recursive: true });
    await run("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mount, dmgPath]);
    mounted = true;

    const sourceApp = await findApp(mount);
    const installedApp = path.join(applications, path.basename(sourceApp));
    await run("/usr/bin/ditto", [sourceApp, installedApp]);
    await run("/usr/bin/hdiutil", ["detach", mount, "-quiet"]);
    mounted = false;

    const structural = collectBundleErrors(installedApp);
    if (structural.length > 0) throw new Error(`安装包结构不完整：\n  ${structural.join("\n  ")}`);

    const plistPath = path.join(installedApp, "Contents/Info.plist");
    const plistJson = await run("/usr/bin/plutil", ["-convert", "json", "-o", "-", plistPath]);
    const identity = plistIdentityErrors(JSON.parse(plistJson.stdout), conf.identifier);
    if (identity.length > 0) throw new Error(`安装包身份不一致：\n  ${identity.join("\n  ")}`);

    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", installedApp]);
    await verifyStandardLaunch(installedApp);
    console.log(`verify-macos-package: ok\n  ${installedApp}`);
  } finally {
    if (mounted) {
      try {
        await run("/usr/bin/hdiutil", ["detach", mount, "-quiet"]);
      } catch (error) {
        console.warn(`[verify-macos-package] DMG 卸载失败：${error.message}`);
      }
    }
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = process.argv[2] ?? await findDmg("src-tauri/target");
  try {
    await verifyPackage(path.resolve(source));
  } catch (error) {
    console.error(`verify-macos-package: FAIL\n  ${error.message}`);
    process.exit(1);
  }
}
