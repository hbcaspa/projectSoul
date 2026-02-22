use std::path::PathBuf;
use std::process::Command;

/// Find a usable Node.js binary.
/// Priority: bundled (in app resources) → system node
pub fn find_node(app_handle: Option<&tauri::AppHandle>) -> Option<PathBuf> {
    // 1. Try bundled node (production builds)
    if let Some(handle) = app_handle {
        if let Ok(resource_dir) = handle.path().resource_dir() {
            let bundled = resource_dir.join("node").join("bin").join("node");
            if bundled.exists() {
                return Some(bundled);
            }
        }
    }

    // 2. Try system node
    let output = Command::new("which")
        .arg("node")
        .output()
        .ok()?;

    if output.status.success() {
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path.is_empty() {
            return Some(PathBuf::from(path));
        }
    }

    None
}

/// Get Node.js version string
pub fn node_version(node_path: &PathBuf) -> Option<String> {
    let output = Command::new(node_path)
        .arg("--version")
        .output()
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

use tauri::Manager;
