import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isCliEntry, loadManifest, parseArgs, provisionRipgrep } from "./provision-ripgrep.mjs";

const isWindows = process.platform === "win32";

function makeTarFixture(root, target) {
  const packageName = `ripgrep-test-${target}`;
  const binaryName = target.includes("windows") ? "rg.exe" : "rg";
  const packageDir = path.join(root, packageName);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(path.join(packageDir, binaryName), `pinned-${target}\n`, { mode: 0o755 });
  const archive = path.join(root, `${packageName}.tar.gz`);
  execFileSync("tar", ["-czf", archive, "-C", root, packageName]);
  return {
    archive,
    archivePath: `${packageName}/${binaryName}`,
    sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
  };
}

describe("ripgrep provisioning", () => {
  let workspace;

  beforeEach(() => {
    workspace = mkdtempSync(path.join(tmpdir(), "studywiki-ripgrep-"));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("recognizes the script entry without relying on platform path text", () => {
    const entry = path.resolve("scripts/provision-ripgrep.mjs");
    expect(isCliEntry(entry, pathToFileURL(entry).href)).toBe(true);
    expect(isCliEntry("", pathToFileURL(entry).href)).toBe(false);
  });

  it("accepts the pnpm value separator before target arguments", () => {
    expect(parseArgs(["--", "--target", "x86_64-apple-darwin"])).toEqual({
      targetValues: ["x86_64-apple-darwin"],
    });
  });

  it("pins every target required by the release matrix", () => {
    const manifest = loadManifest();
    expect(manifest.version).toBe("15.2.0");
    expect(Object.keys(manifest.targets)).toEqual([
      "aarch64-apple-darwin",
      "x86_64-apple-darwin",
      "x86_64-unknown-linux-gnu",
      "x86_64-pc-windows-msvc",
    ]);
  });

  it("rejects unsafe archive members and malformed digests", () => {
    const manifestPath = path.join(workspace, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
      version: "1",
      targets: {
        "aarch64-apple-darwin": {
          url: "https://example.invalid/rg.tar.gz",
          sha256: "not-a-digest",
          format: "tar.gz",
          archivePath: "../../outside/rg",
        },
      },
    }));
    expect(() => loadManifest(manifestPath)).toThrow("SHA-256 非法");
  });

  it("provisions distinct Rust targets into the Tauri sidecar names", async () => {
    const targets = isWindows ? ["x86_64-pc-windows-msvc"] : ["aarch64-apple-darwin", "x86_64-apple-darwin"];
    const target = targets[0];
    const fixture = makeTarFixture(path.join(workspace, "assets"), target);
    const manifestPath = path.join(workspace, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
      version: "test",
      targets: Object.fromEntries(targets.map((name) => [name, {
        url: `https://example.invalid/${name}.tar.gz`,
        sha256: fixture.sha256,
        format: "tar.gz",
        archivePath: fixture.archivePath,
      }])),
    }));

    const outputDir = path.join(workspace, "binaries");
    const results = await provisionRipgrep({
      targetValues: targets,
      manifestPath,
      outputDir,
      cacheDir: path.join(workspace, "cache"),
      fetchImpl: async (url) => new Response(readFileSync(fixture.archive)),
    });

    expect(results).toHaveLength(targets.length);
    for (const name of targets) {
      const binary = path.join(outputDir, `rg-${name}${name.includes("windows") ? ".exe" : ""}`);
      expect(readFileSync(binary, "utf8")).toBe(`pinned-${target}\n`);
      expect(readFileSync(`${binary}.sha256`, "utf8")).toBe(
        `${createHash("sha256").update(readFileSync(binary)).digest("hex")}\n`,
      );
    }
  });

  it("fails closed on a digest mismatch without writing the sidecar", async () => {
    const target = "aarch64-apple-darwin";
    const fixture = makeTarFixture(path.join(workspace, "assets"), target);
    const manifestPath = path.join(workspace, "manifest.json");
    const badDigest = "0".repeat(64);
    writeFileSync(manifestPath, JSON.stringify({
      version: "test",
      targets: { [target]: {
        url: "https://example.invalid/rg.tar.gz",
        sha256: badDigest,
        format: "tar.gz",
        archivePath: fixture.archivePath,
      } },
    }));
    const outputDir = path.join(workspace, "binaries");

    await expect(provisionRipgrep({
      targetValues: [target],
      manifestPath,
      outputDir,
      cacheDir: path.join(workspace, "cache"),
      fetchImpl: async () => new Response(readFileSync(fixture.archive)),
    })).rejects.toThrow("SHA-256 mismatch");
    expect(existsSync(path.join(outputDir, `rg-${target}`))).toBe(false);
  });

  it("repairs a deleted target output from the verified local cache", async () => {
    const target = "x86_64-apple-darwin";
    const fixture = makeTarFixture(path.join(workspace, "assets"), target);
    const manifestPath = path.join(workspace, "manifest.json");
    writeFileSync(manifestPath, JSON.stringify({
      version: "test",
      targets: { [target]: {
        url: "https://example.invalid/rg.tar.gz",
        sha256: fixture.sha256,
        format: "tar.gz",
        archivePath: fixture.archivePath,
      } },
    }));
    const outputDir = path.join(workspace, "binaries");
    const options = {
      targetValues: [target],
      manifestPath,
      outputDir,
      cacheDir: path.join(workspace, "cache"),
    };
    let downloads = 0;
    const fetchImpl = async () => {
      downloads += 1;
      return new Response(readFileSync(fixture.archive));
    };

    await provisionRipgrep({ ...options, fetchImpl });
    const binary = path.join(outputDir, `rg-${target}`);
    rmSync(binary);
    rmSync(`${binary}.sha256`);
    const repaired = await provisionRipgrep({ ...options, fetchImpl });

    expect(downloads).toBe(1);
    expect(repaired[0].binarySha256).toBe(
      createHash("sha256").update(readFileSync(binary)).digest("hex"),
    );
    expect(readFileSync(binary, "utf8")).toBe(`pinned-${target}\n`);
  });
});
