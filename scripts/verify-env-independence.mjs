#!/usr/bin/env node
// Gate: 环境无关性（约束 home：docs/environment-independence.md）。
// 检查源与配置层面可机械判定的条款；产物层面（dist/ 存在时）一并扫描。
// 豁免必须先在 docs/environment-independence.md 登记表登记，再进 ALLOWED 列表。

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// 白名单：asset/ipc 协议的本地回显地址是 Tauri 机制的一部分，不是外网引用。
const ALLOWED_URL = ["http://asset.localhost", "http://ipc.localhost", "https://schema.tauri.app"];
const EXTERNAL_URL_RE = /https?:\/\/[a-z0-9.-]+/gi;

async function scanDir(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await scanDir(full, out);
    else if (/\.(ts|html|css|js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function externalUrls(text) {
  const hits = new Set();
  for (const url of text.matchAll(EXTERNAL_URL_RE)) {
    const u = url[0];
    if (!ALLOWED_URL.some((a) => u.startsWith(a))) hits.add(u);
  }
  return [...hits];
}

export default async function verifyEnvIndependence() {
  const errors = [];

  // 1) Windows 安装器必须内嵌 WebView2 离线安装器（不联网补装）。
  const conf = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
  const mode = conf?.bundle?.windows?.webviewInstallMode?.type;
  if (mode !== "offlineInstaller")
    errors.push(`tauri.conf.json: bundle.windows.webviewInstallMode.type 须为 "offlineInstaller"，当前 "${mode}"`);

  // 2) 三平台自包含产物形态齐全。
  const targets = conf?.bundle?.targets ?? [];
  for (const t of ["dmg", "nsis", "appimage"])
    if (!targets.includes(t)) errors.push(`tauri.conf.json: bundle.targets 缺 ${t}`);

  // 3) 不引入更新器插件（运行时联网下载）。
  const cargo = await readFile("src-tauri/Cargo.toml", "utf8");
  if (/tauri-plugin-(updater|http|upload)/.test(cargo))
    errors.push("src-tauri/Cargo.toml: 出现联网类插件（updater/http/upload），环境无关约束禁止");

  // 4) 源码无外部资源引用。
  for (const file of ["index.html", ...(await scanDir("src"))]) {
    const urls = externalUrls(await readFile(file, "utf8"));
    if (urls.length) errors.push(`${file}: 外部 URL 引用 ${urls.join(", ")}`);
  }

  // 5) 产物扫描（构建后才有；CI 在 build 之后跑本门禁）。
  for (const file of await scanDir("dist")) {
    const text = await readFile(file, "utf8");
    // 只抓 src=/href= 资源引用，正文文本里的链接（如 markdown 渲染产物）不管。
    for (const m of text.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
      const u = m[1];
      if (!ALLOWED_URL.some((a) => u.startsWith(a)))
        errors.push(`dist/${path.relative("dist", file)}: 资源引用外部 URL ${u}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await verifyEnvIndependence();
  if (!result.ok) {
    console.error(`verify-env-independence: FAIL\n  ${result.errors.join("\n  ")}`);
    process.exit(1);
  }
  console.log("verify-env-independence: ok");
}
