use sha2::{Digest, Sha256};
use std::{env, fs, path::Path, path::PathBuf};

/// 校验供给脚本已按 Rust TARGET 落位的 pinned ripgrep sidecar。
/// 二进制下载、SHA-256、缓存与跨 target 选择都在 `pnpm ripgrep:provision` 完成；
/// 构建期不联网，也不依赖包管理器的平台包布局。
fn main() {
    let target = env::var("TARGET").expect("TARGET 由 cargo 提供");
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let binary = manifest.join("binaries").join(format!(
        "rg-{target}{}",
        if target.contains("windows") {
            ".exe"
        } else {
            ""
        }
    ));
    let metadata = PathBuf::from(format!("{}.sha256", binary.display()));
    if !binary.is_file() || !metadata.is_file() {
        panic!(
            "rg sidecar 未供给：{}（先运行 pnpm ripgrep:provision -- --target {target}）",
            binary.display()
        );
    }
    let expected = fs::read_to_string(&metadata)
        .unwrap_or_else(|e| {
            panic!(
                "读取 rg sidecar SHA-256 失败（{}）：{e}",
                metadata.display()
            )
        })
        .trim()
        .to_owned();
    let actual = sha256_file(&binary);
    if actual != expected {
        panic!(
            "rg sidecar SHA-256 mismatch（{}）：期望 {expected}，实际 {actual}（重跑 pnpm ripgrep:provision -- --target {target}）",
            binary.display()
        );
    }
    println!(
        "cargo:rerun-if-changed={}",
        manifest.join("../scripts/ripgrep-manifest.json").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        manifest.join("../scripts/provision-ripgrep.mjs").display()
    );
    println!("cargo:rerun-if-changed={}", binary.display());
    println!("cargo:rerun-if-changed={}", metadata.display());
    println!("cargo:rustc-env=TARGET_TRIPLE={target}");
    tauri_build::build()
}

fn sha256_file(path: &Path) -> String {
    let bytes = fs::read(path)
        .unwrap_or_else(|e| panic!("读取 rg sidecar 失败（{}）：{e}", path.display()));
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .fold(String::new(), |mut out, byte| {
            use std::fmt::Write;
            write!(out, "{byte:02x}").expect("hex 编码不会失败");
            out
        })
}
