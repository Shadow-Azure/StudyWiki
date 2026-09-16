// 门禁自测试：环境无关性——WebView2 离线安装器、三平台产物形态、禁联网插件、
// 源码无外部 URL（白名单回显地址除外）。夹具机制见 spec-fixture.mjs。

import { afterAll, describe, expect, it } from "vitest";
import { createGateRunner } from "./spec-fixture.mjs";

const gate = createGateRunner("verify-env-independence.mjs", "env-independence");
afterAll(gate.cleanup);

const CONF = (type, targets) =>
  JSON.stringify({ bundle: { windows: { webviewInstallMode: { type } }, targets } });

describe("verify-env-independence", () => {
  it("合规配置与白名单回显地址过检", async () => {
    const result = await gate.run({
      "src-tauri/tauri.conf.json": CONF("offlineInstaller", ["dmg", "nsis", "appimage"]),
      "src-tauri/Cargo.toml": '[dependencies]\ntauri = "2"\n',
      "index.html": "<!doctype html>\n<html></html>\n",
      "src/main.ts": 'export const base = "http://asset.localhost/";\n',
    });
    expect(result.ok).toBe(true);
  });

  it("SVG namespace 精确豁免过检，同 host 其他路径在源码与产物均拒检", async () => {
    const result = await gate.run({
      "src-tauri/tauri.conf.json": CONF("offlineInstaller", ["dmg", "nsis", "appimage"]),
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
      "src-tauri/tauri.conf.json": CONF("downloadBootstrapper", ["dmg", "appimage"]),
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
