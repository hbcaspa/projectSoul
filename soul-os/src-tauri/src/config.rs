use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub soul_path: PathBuf,
    pub first_run: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            soul_path: default_soul_dir(),
            first_run: true,
        }
    }
}

/// Default soul directory: ~/Soul
fn default_soul_dir() -> PathBuf {
    dirs_next::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Soul")
}

/// Where we persist the config: ~/Library/Application Support/com.projectsoul.soulosnew/config.json
fn config_path() -> PathBuf {
    let base = dirs_next::config_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("com.projectsoul.soulosnew").join("config.json")
}

impl AppConfig {
    /// Load from disk, or return default if missing/corrupt.
    pub fn load() -> Self {
        let path = config_path();
        if path.exists() {
            if let Ok(data) = fs::read_to_string(&path) {
                if let Ok(cfg) = serde_json::from_str::<AppConfig>(&data) {
                    return cfg;
                }
            }
        }
        Self::default()
    }

    /// Persist to disk.
    pub fn save(&self) -> Result<(), String> {
        let path = config_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&path, json).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn is_first_run(&self) -> bool {
        self.first_run
    }

    /// Determine the app state based on config + whether SEED.md exists
    pub fn app_state(&self) -> &'static str {
        if self.first_run {
            return "setup";
        }
        let seed = self.soul_path.join("SEED.md");
        if seed.exists() {
            "ready"
        } else {
            "founding"
        }
    }
}
