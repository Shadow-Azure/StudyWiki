// 门禁自测试：环境无关性——WebView2 离线安装器、三平台产物形态、禁联网插件、
// 源码无外部 URL（白名单回显地址除外）。夹具机制见 spec-fixture.mjs。

import { afterAll, describe, expect, it } from "vitest";
import { isStableBundleIdentifier } from "./verify-env-independence.mjs";
import { createGateRunner } from "./spec-fixture.mjs";

const gate = createGateRunner("verify-env-independence.mjs", "env-independence");
afterAll(gate.cleanup);

const CONF = (identifier, type, targets) =>
  JSON.stringify({ identifier, bundle: { windows: { webviewInstallMode: { type } }, targets } });

describe("stable bundle identifier", () => {
  it("接受 reverse-DNS 且不以 .app 结尾的 identifier", () => {
    expect(isStableBundleIdentifier("dev.studywiki.desktop")).toBe(true);
  });

  it("拒绝缺失、单段、非法字符和 .app 后缀", () => {
    for (const identifier of [undefined, "", "studywiki", "dev.study..wiki", "dev.studywiki.app"]) {
      expect(isStableBundleIdentifier(identifier)).toBe(false);
    }
  });

  it("环境无关门禁拒绝 .app 后缀 identifier", async () => {
    const result = await gate.run({
      "src-tauri/tauri.conf.json": CONF("dev.studywiki.app", "offlineInstaller", ["dmg", "nsis", "appimage"]),
      "src-tauri/Cargo.toml": '[dependencies]\ntauri = "2"\n',
      "index.html": "<!doctype html>\n<html></html>\n",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("bundle identifier 不能以 .app 结尾");
  });
});

describe("verify-env-independence", () => {
  it("合规配置与白名单回显地址过检", async () => {
    const result = await gate.run({
      "src-tauri/tauri.conf.json": CONF("dev.studywiki.desktop", "offlineInstaller", ["dmg", "nsis", "appimage"]),
      "src-tauri/Cargo.toml": '[dependencies]\ntauri = "2"\n',
      "index.html": "<!doctype html>\n<html></html>\n",
      "src/main.ts": 'export const base = "http://asset.localhost/";\n',
    });
    expect(result.ok).toBe(true);
  });

  it("SVG namespace 精确豁免过检，同 host 其他路径在源码与产物均拒检", async () => {
    const result = await gate.run({
      "src-tauri/tauri.conf.json": CONF("dev.studywiki.desktop", "offlineInstaller", ["dmg", "nsis", "appimage"]),
      "src-tauri/Cargo.toml": '[dependencies]\ntauri = "2"\n',
      "index.html": "<!doctype html>\n<html></html>\n",
      "src/ui/icons.ts": 'export const SVG_NS = "http://www.w3.org/2000/svg";\n',
      "src/main.ts": 'export const css = "http://www.w3.org/not-allowed.css";\n',
      "dist/index.html": '<img src="http://www.w3.org/not-allowed.png">\n',
    });
    expect(result.ok).toBe(false);
    const joined = result.errors.join("\n");
    expect(joined).toContain("外部 URL 引用 http://www.w3.org/not-allowed.css");
    expect(joined).toContain("dist/index.html: 资源引用外部 URL http://www.w3.org/not-allowed.png");
  });

  it("四类违规各报各的错", async () => {
    const result = await gate.run({
      "src-tauri/tauri.conf.json": CONF("dev.studywiki.desktop", "downloadBootstrapper", ["dmg", "appimage"]),
      "src-tauri/Cargo.toml": 'tauri-plugin-http = "2"\n',
      "index.html": "<!doctype html>\n<html></html>\n",
      "src/main.ts": 'export const cdn = "https://cdn.example.com/x";\n',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(4);
    const joined = result.errors.join("\n");
    expect(joined).toContain('webviewInstallMode.type 须为 "offlineInstaller"');
    expect(joined).toContain("bundle.targets 缺 nsis");
    expect(joined).toContain("联网类插件（updater/http/upload）");
    expect(joined).toContain("外部 URL 引用 https://cdn.example.com/x");
  });
});
