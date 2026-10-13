import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectBundleErrors,
  findDmg,
  findApp,
  isStableBundleIdentifier,
  plistIdentityErrors,
} from "./verify-macos-package.mjs";

describe("macOS 打包门禁辅助逻辑", () => {
  it("只接受不以 .app 结尾的 reverse-DNS identifier", () => {
    expect(isStableBundleIdentifier("dev.studywiki.desktop")).toBe(true);
    expect(isStableBundleIdentifier("dev.studywiki.app")).toBe(false);
    expect(isStableBundleIdentifier("studywiki")).toBe(false);
    expect(isStableBundleIdentifier(undefined)).toBe(false);
  });

  it("查找 DMG 时拒绝空集合和多义集合", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "studywiki-package-"));
    await expect(findDmg(root)).rejects.toThrow("未找到 DMG");
    const dmgDir = path.join(root, "bundle", "dmg");
    await mkdir(dmgDir, { recursive: true });
    await writeFile(path.join(dmgDir, "a.dmg"), "a");
    await writeFile(path.join(dmgDir, "b.dmg"), "b");
    await expect(findDmg(root)).rejects.toThrow("找到多个 DMG");
  });

  it("只把 StudyWiki.app 目录视为应用包，而不是其中嵌套的文件", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "studywiki-package-"));
    const app = path.join(root, "StudyWiki.app");
    const nested = path.join(app, "Contents/MacOS");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, "study-wiki"), "");
    await expect(findApp(root)).resolves.toBe(app);
  });

  it("安装包必须包含可执行文件、资源与签名封条", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "studywiki-bundle-"));
    const app = path.join(root, "StudyWiki.app");
    for (const file of [
      "Contents/Info.plist",
      "Contents/MacOS/study-wiki",
      "Contents/Resources/icon.icns",
      "Contents/_CodeSignature/CodeResources",
    ]) {
      await mkdir(path.dirname(path.join(app, file)), { recursive: true });
      await writeFile(path.join(app, file), "");
    }
    expect(collectBundleErrors(app)).toEqual([]);

    const incomplete = path.join(root, "incomplete.app");
    await mkdir(path.join(incomplete, "Contents/MacOS"), { recursive: true });
    await writeFile(path.join(incomplete, "Contents/Info.plist"), "");
    await writeFile(path.join(incomplete, "Contents/MacOS/study-wiki"), "");
    expect(collectBundleErrors(incomplete).join("\n")).toContain("_CodeSignature/CodeResources");
  });

  it("Info.plist 身份必须与 Tauri 配置一致且不以 .app 结尾", () => {
    const identity = {
      CFBundleIdentifier: "dev.studywiki.desktop",
      CFBundleExecutable: "study-wiki",
      CFBundleName: "StudyWiki",
    };
    expect(plistIdentityErrors(identity, "dev.studywiki.desktop")).toEqual([]);
    expect(plistIdentityErrors(identity, "dev.studywiki.other").join("\n")).toContain("CFBundleIdentifier");
    expect(plistIdentityErrors({
      ...identity,
      CFBundleIdentifier: "dev.studywiki.app",
    }, "dev.studywiki.app").join("\n")).toContain(".app 结尾");
  });
});
