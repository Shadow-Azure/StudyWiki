//! 用户配置根（~/.studywiki）解析与老 app_config_dir 一次性迁移。

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// 老配置域里需要搬家的条目（插件清单 + 外置插件目录）。
const LEGACY_ENTRIES: [&str; 2] = ["plugins.json", "plugins"];

/// 用户配置根：<home>/.studywiki（三端同形，纯函数便于测试）。
pub fn studywiki_dir(home: &Path) -> PathBuf {
    home.join(".studywiki")
}

/// App 态配置根：home 解析失败即 fail-loud。
pub fn app_studywiki_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(studywiki_dir(
        &app.path().home_dir().map_err(|e| e.to_string())?,
    ))
}

/// 一次性迁移本体：老条目在新根缺席时 move；两边都有以新根为准，老条目保留。
pub fn migrate_legacy_dirs(legacy: &Path, new: &Path) -> Result<(), String> {
    if legacy == new {
        return Ok(());
    }
    for name in LEGACY_ENTRIES {
        let (from, to) = (legacy.join(name), new.join(name));
        if from.exists() && !to.exists() {
            fs::create_dir_all(new).map_err(|e| format!("mkdir {}: {e}", new.display()))?;
            fs::rename(&from, &to)
                .map_err(|e| format!("迁移 {} → {} 失败：{e}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

/// 启动入口：解析两个目录后委托纯函数（空转成本可忽略）。
pub fn migrate_legacy(app: &AppHandle) -> Result<(), String> {
    let legacy = app.path().app_config_dir().map_err(|e| e.to_string())?;
    migrate_legacy_dirs(&legacy, &app_studywiki_dir(app)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn studywiki_dir_joins_dot_dir() {
        assert_eq!(studywiki_dir(Path::new("/home/u")), PathBuf::from("/home/u/.studywiki"));
    }

    #[test]
    fn migrate_moves_absent_entries_and_is_idempotent() {
        let tmp = std::env::temp_dir().join(format!("sw-mig-{}", std::process::id()));
        let legacy = tmp.join("legacy");
        let new = tmp.join("new");
        std::fs::create_dir_all(legacy.join("plugins/ext-a")).unwrap();
        std::fs::write(legacy.join("plugins.json"), "{}").unwrap();
        std::fs::create_dir_all(&new).unwrap();
        migrate_legacy_dirs(&legacy, &new).unwrap();
        assert!(new.join("plugins.json").exists() && new.join("plugins/ext-a").is_dir());
        assert!(!legacy.join("plugins.json").exists());
        migrate_legacy_dirs(&legacy, &new).unwrap(); // 二次空转不报错
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn migrate_keeps_both_sides_when_new_exists() {
        let tmp = std::env::temp_dir().join(format!("sw-mig2-{}", std::process::id()));
        let legacy = tmp.join("legacy");
        let new = tmp.join("new");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(legacy.join("plugins.json"), "old").unwrap();
        std::fs::write(new.join("plugins.json"), "new").unwrap();
        migrate_legacy_dirs(&legacy, &new).unwrap();
        assert_eq!(std::fs::read_to_string(new.join("plugins.json")).unwrap(), "new");
        assert!(legacy.join("plugins.json").exists()); // 老条目保留不删
        std::fs::remove_dir_all(&tmp).unwrap();
    }
}
