#!/usr/bin/env node
// Provision pinned ripgrep target binaries before Rust/Tauri builds.
// The release artifact never downloads at runtime; this command is the only
// build-time network seam and always verifies the pinned archive digest.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
export const MANIFEST_PATH = path.join(REPO_ROOT, "scripts/ripgrep-manifest.json");
export const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "src-tauri/binaries");
const DEFAULT_CACHE_DIR = path.join(REPO_ROOT, "node_modules/.cache/study-wiki/ripgrep");

/** Load and minimally shape-check the pinned target map. */
export function loadManifest(manifestPath = MANIFEST_PATH) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (typeof manifest.version !== "string" || !manifest.targets) {
    throw new Error("ripgrep manifest 缺少 version 或 targets");
  }
  for (const [target, asset] of Object.entries(manifest.targets)) {
    if (!/^[a-z0-9_-]+$/i.test(target)) throw new Error(`非法 target：${target}`);
    assertAssetShape(target, asset);
  }
  return manifest;
}

function assertAssetShape(target, asset) {
  const required = ["url", "sha256", "format", "archivePath"];
  for (const key of required) {
    if (typeof asset?.[key] !== "string" || asset[key] === "") {
      throw new Error(`ripgrep manifest target ${target} 缺少 ${key}`);
    }
  }
  if (!/^[0-9a-f]{64}$/i.test(asset.sha256)) {
    throw new Error(`ripgrep manifest target ${target} 的 SHA-256 非法`);
  }
  if (!["tar.gz", "zip"].includes(asset.format)) {
    throw new Error(`ripgrep manifest target ${target} 的归档格式不支持`);
  }
  if (path.isAbsolute(asset.archivePath) || asset.archivePath.split(/[\\/]+/).includes("..")) {
    throw new Error(`ripgrep manifest target ${target} 的 archivePath 不安全`);
  }
}

/** Read the default target from rustc, independent of process.platform. */
export function hostRustTarget() {
  const output = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  return /^host:\s*(.+)$/m.exec(output)?.[1] ?? "";
}

function resolveTargets(values = []) {
  if (values.length) return values;
  const envTarget = process.env.RIPGREP_RUST_TARGET ?? process.env.CARGO_TARGET;
  return [envTarget || hostRustTarget()];
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

function binaryName(target) {
  return target.includes("windows") ? "rg.exe" : "rg";
}

function outputPaths(outputDir, target) {
  const binary = path.join(outputDir, `rg-${target}${target.includes("windows") ? ".exe" : ""}`);
  return { binary, metadata: `${binary}.sha256` };
}

async function fetchVerifiedArchive(asset, archivesDir, fetchImpl) {
  const archivePath = path.join(archivesDir, `${asset.sha256}.${asset.format.replace(".", "-")}`);
  if (existsSync(archivePath)) {
    const actual = await sha256File(archivePath);
    if (actual === asset.sha256.toLowerCase()) return archivePath;
    rmSync(archivePath, { force: true });
  }

  const response = await fetchImpl(asset.url);
  if (!response.ok) throw new Error(`ripgrep 下载失败 HTTP ${response.status}：${asset.url}`);
  const tempPath = `${archivePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tempPath, Buffer.from(await response.arrayBuffer()));
  const actual = await sha256File(tempPath);
  if (actual !== asset.sha256.toLowerCase()) {
    rmSync(tempPath, { force: true });
    throw new Error(`ripgrep SHA-256 mismatch：期望 ${asset.sha256}，实际 ${actual}`);
  }
  renameSync(tempPath, archivePath);
  return archivePath;
}

function defaultExtractArchive(archivePath, format, destination) {
  if (format === "zip") {
    if (process.platform === "win32") {
      execFileSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destination}' -Force`],
        { stdio: "pipe" },
      );
    } else {
      execFileSync("unzip", ["-q", archivePath, "-d", destination], { stdio: "pipe" });
    }
  } else {
    execFileSync("tar", ["-xzf", archivePath, "-C", destination], { stdio: "pipe" });
  }
}

async function extractVerifiedBinary(asset, archivePath, extractedRoot, extractArchive = defaultExtractArchive) {
  const extractDir = path.join(extractedRoot, asset.sha256);
  const extractedBinary = path.resolve(extractDir, asset.archivePath);
  if (existsSync(extractedBinary)) return extractedBinary;

  const tempDir = mkdtempSync(path.join(extractedRoot, "extract-"));
  try {
    await extractArchive(archivePath, asset.format, tempDir);
    const member = path.resolve(tempDir, asset.archivePath);
    if (!member.startsWith(path.resolve(tempDir) + path.sep) || !existsSync(member) || !statSync(member).isFile()) {
      throw new Error(`ripgrep 归档缺少 ${asset.archivePath}`);
    }
    mkdirSync(path.dirname(extractedBinary), { recursive: true });
    copyFileSync(member, extractedBinary);
    if (!targetIncludesWindows(asset.archivePath)) chmodBinary(extractedBinary);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  return extractedBinary;
}

function targetIncludesWindows(value) {
  return value.endsWith(".exe");
}

function chmodBinary(filePath) {
  if (process.platform !== "win32") execFileSync("chmod", ["755", filePath], { stdio: "pipe" });
}

async function provisionTarget(target, asset, options) {
  const { outputDir, cacheDir, fetchImpl, extractArchive } = options;
  const archivesDir = path.join(cacheDir, "archives");
  const extractedRoot = path.join(cacheDir, "extracted");
  mkdirSync(archivesDir, { recursive: true });
  mkdirSync(extractedRoot, { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  const archivePath = await fetchVerifiedArchive(asset, archivesDir, fetchImpl);
  const cachedBinary = await extractVerifiedBinary(asset, archivePath, extractedRoot, extractArchive);
  const paths = outputPaths(outputDir, target);
  const sameBytes = existsSync(paths.binary) && Buffer.compare(readFileSync(paths.binary), readFileSync(cachedBinary)) === 0;
  if (!sameBytes) {
    const tempOutput = `${paths.binary}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    copyFileSync(cachedBinary, tempOutput);
    if (!targetIncludesWindows(paths.binary)) chmodBinary(tempOutput);
    rmSync(paths.binary, { force: true });
    renameSync(tempOutput, paths.binary);
  }
  const binarySha256 = await sha256File(paths.binary);
  writeFileSync(paths.metadata, `${binarySha256}\n`, { encoding: "utf8", mode: 0o644 });
  return { target, binary: paths.binary, binarySha256, fromCache: existsSync(archivePath) };
}

/**
 * Ensure one or more pinned ripgrep binaries exist for their Rust targets.
 * Archive downloads are verified and cached; already-correct outputs are kept.
 */
export async function provisionRipgrep(options = {}) {
  const {
    targets = resolveTargets(options.targetValues),
    manifestPath = MANIFEST_PATH,
    outputDir = DEFAULT_OUTPUT_DIR,
    cacheDir = process.env.RIPGREP_CACHE_DIR ?? DEFAULT_CACHE_DIR,
    fetchImpl = fetch,
    extractArchive,
  } = options;
  const manifest = loadManifest(manifestPath);
  const results = [];
  for (const target of targets) {
    const asset = manifest.targets[target];
    if (!asset) throw new Error(`ripgrep manifest 不支持 Rust target：${target}`);
    results.push(await provisionTarget(target, asset, { outputDir, cacheDir, fetchImpl, extractArchive }));
  }
  return results;
}

export function parseArgs(argv) {
  const values = { targetValues: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--") continue;
    if (key === "--target") values.targetValues.push(argv[++index] ?? "");
    else if (key === "--cache-dir") values.cacheDir = argv[++index];
    else if (key === "--output-dir") values.outputDir = argv[++index];
    else if (key === "--manifest") values.manifestPath = argv[++index];
    else throw new Error(`未知参数：${key}`);
  }
  return values;
}

export function isCliEntry(entryPath, moduleUrl) {
  return Boolean(entryPath) && pathToFileURL(path.resolve(entryPath)).href === moduleUrl;
}

if (isCliEntry(process.argv[1], import.meta.url)) {
  try {
    const results = await provisionRipgrep(parseArgs(process.argv.slice(2)));
    for (const result of results) {
      console.log(`[ripgrep] ${result.target} → ${result.binary} (${result.binarySha256})`);
    }
  } catch (error) {
    console.error(`[ripgrep] 供给失败：${error.message}`);
    process.exit(1);
  }
}
