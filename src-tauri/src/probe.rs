//! 源文件探测：流式 SHA-256 + 大小 + mtime；known 命中（size + mtimeMs 一致）
//! 时跳过哈希（视频大文件每回合重哈希不可接受）。错误带稳定 code，message 仅诊断。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;

const CHUNK: usize = 64 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSample {
    pub size: u64,
    pub mtime_ms: i64,
    pub sha256: String,
}

#[derive(Debug, Serialize)]
pub struct ProbeError {
    pub code: String,
    pub message: String,
}

fn err(code: &str, message: String) -> ProbeError {
    ProbeError {
        code: code.into(),
        message,
    }
}

/// 探测文件：返回大小、mtime（Unix 毫秒）与流式 SHA-256。known 提供且
/// size/mtime 与磁盘一致时原样返回 known.sha256（快路径，不重读内容）。
pub fn probe_file(path: &Path, known: Option<ProbeSample>) -> Result<ProbeSample, ProbeError> {
    if path
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(err(
            "PROBE_INVALID_PATH",
            format!("路径不得含 .. 组件：{}", path.display()),
        ));
    }
    let meta = std::fs::metadata(path).map_err(|e| {
        err(
            "PROBE_NOT_FOUND",
            format!("metadata {}: {e}", path.display()),
        )
    })?;
    let size = meta.len();
    let mtime_ms = meta
        .modified()
        .map_err(|e| err("PROBE_STAT", format!("mtime {}: {e}", path.display())))?
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    if let Some(known) = known {
        if known.size == size && known.mtime_ms == mtime_ms {
            return Ok(ProbeSample {
                size,
                mtime_ms,
                sha256: known.sha256,
            });
        }
    }
    let mut hasher = Sha256::new();
    let mut file = std::fs::File::open(path)
        .map_err(|e| err("PROBE_READ", format!("open {}: {e}", path.display())))?;
    use std::io::Read;
    let mut buf = vec![0u8; CHUNK];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| err("PROBE_READ", format!("read {}: {e}", path.display())))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(ProbeSample {
        size,
        mtime_ms,
        sha256: format!("{:x}", hasher.finalize()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_known_content() {
        let dir = std::env::temp_dir().join(format!("sw-probe-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.md");
        std::fs::write(&p, b"hello study-wiki").unwrap();
        let r = probe_file(&p, None).unwrap();
        assert_eq!(r.size, 16);
        assert_eq!(r.sha256.len(), 64);
        assert!(r.mtime_ms > 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn known_fast_path_skips_hash() {
        let dir = std::env::temp_dir().join(format!("sw-probe-fast-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("big.bin");
        std::fs::write(&p, vec![7u8; 200_000]).unwrap();
        let full = probe_file(&p, None).unwrap();
        let fast = probe_file(&p, Some(full.clone())).unwrap();
        assert_eq!(fast.sha256, full.sha256);
        let stale = probe_file(
            &p,
            Some(ProbeSample {
                size: 1,
                ..full.clone()
            }),
        )
        .unwrap();
        assert_eq!(stale.sha256, full.sha256);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_parent_dir_components() {
        let e = probe_file(Path::new("/tmp/../etc/passwd"), None).unwrap_err();
        assert_eq!(e.code, "PROBE_INVALID_PATH");
    }
}
