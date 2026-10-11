use sha2::{Digest, Sha256};

/// cargo test 无法直接执行 build.rs；本测试用同一个构建期契约把供给产物
/// 钉住：文件、SHA 元数据必须成对，且元数据必须匹配实际字节。
#[test]
fn provisioned_sidecar_matches_pinned_metadata() {
    let target = env!("TARGET_TRIPLE");
    let binary = std::env::current_dir().expect("read cwd").join(format!(
        "binaries/rg-{target}{}",
        if target.contains("windows") {
            ".exe"
        } else {
            ""
        }
    ));
    let metadata = std::path::PathBuf::from(format!("{}.sha256", binary.display()));
    let actual = sha256(&binary);
    let expected = std::fs::read_to_string(&metadata).expect("provisioned sidecar metadata");
    assert_eq!(
        actual,
        expected.trim(),
        "sidecar bytes do not match provisioning metadata"
    );
}

fn sha256(path: &std::path::Path) -> String {
    let bytes = std::fs::read(path).expect("provisioned sidecar");
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .fold(String::new(), |mut output, byte| {
            use std::fmt::Write;
            write!(output, "{byte:02x}").expect("hex encoding cannot fail");
            output
        })
}
