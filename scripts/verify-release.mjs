#!/usr/bin/env node
// Gate: 发布版本一致性。四处版本号必须相同；--tag 给出时还须与其相等。
// 用法：node scripts/verify-release.mjs [--tag v0.1.0]

import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const tagIdx = args.indexOf("--tag");
const tag = tagIdx >= 0 ? args[tagIdx + 1] : undefined;

const pkg = JSON.parse(await readFile("package.json", "utf8")).version;
const conf = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8")).version;
const cargoText = await readFile("src-tauri/Cargo.toml", "utf8");
const cargo = cargoText.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const errors = [];
const versions = { "package.json": pkg, "tauri.conf.json": conf, "Cargo.toml": cargo };
const first = pkg;
for (const [name, v] of Object.entries(versions)) {
  if (!v) errors.push(`${name}: 读不到版本号`);
  else if (v !== first) errors.push(`${name}: ${v} != ${first}（package.json）`);
}
if (tag) {
  const tagVersion = tag.replace(/^v/, "");
  if (tagVersion !== first) errors.push(`tag: ${tagVersion} != ${first}（package.json）`);
}

if (errors.length) {
  console.error(`verify-release: FAIL\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log(`verify-release: ok (v${first}${tag ? ` == ${tag}` : ""})`);
