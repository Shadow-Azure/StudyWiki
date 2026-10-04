use std::{env, fs, path::PathBuf};

/// 构建期把 @vscode/ripgrep 的平台二进制落位为 Tauri sidecar（npm 当仓库用，
/// 运行零下载；node_modules 缺失时明确指向 pnpm install）。同时导出 TARGET_TRIPLE
/// 供运行期解析 sidecar 文件名。
fn main() {
    let target = env::var("TARGET").expect("TARGET 由 cargo 提供");
    let windows = target.contains("windows");
    let exe = if windows { "rg.exe" } else { "rg" };
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let package_dir = fs::canonicalize(manifest.join("../node_modules/@vscode/ripgrep"))
        .expect("定位 @vscode/ripgrep（node_modules 缺失？先跑 pnpm install）");
    let platform = if windows {
        "win32"
    } else if target.contains("darwin") {
        "darwin"
    } else if target.contains("linux") {
        "linux"
    } else {
        panic!("暂不支持 TARGET 平台：{target}");
    };
    let arch = if target.contains("x86_64") {
        "x64"
    } else if target.contains("aarch64") {
        "arm64"
    } else if target.contains("i686") || target.contains("i586") || target.contains("i386") {
        "ia32"
    } else if target.contains("armv7") {
        "arm"
    } else if target.contains("powerpc64") {
        "ppc64"
    } else if target.contains("riscv64") {
        "riscv64"
    } else if target.contains("s390x") {
        "s390x"
    } else {
        panic!("暂不支持 TARGET 架构：{target}");
    };
    let src = package_dir
        .join(format!("../ripgrep-{platform}-{arch}/bin"))
        .join(exe);
    let out_dir = manifest.join("binaries");
    fs::create_dir_all(&out_dir).expect("创建 binaries 目录");
    let dst = out_dir.join(format!("rg-{target}{}", if windows { ".exe" } else { "" }));
    let stale = fs::metadata(&dst).map(|m| m.len()) .unwrap_or(0)
        != fs::metadata(&src).map(|m| m.len()).unwrap_or(u64::MAX);
    if stale {
        fs::copy(&src, &dst).unwrap_or_else(|e| {
            panic!("落位 rg sidecar 失败：{e}（{} 缺失？先跑 pnpm install）", src.display())
        });
    }
    println!("cargo:rerun-if-changed={}", src.display());
    println!("cargo:rustc-env=TARGET_TRIPLE={target}");
    tauri_build::build()
}
