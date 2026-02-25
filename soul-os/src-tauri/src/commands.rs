use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};

use tauri::{Manager, State};

use crate::config::AppConfig;
use crate::pty::PtyManager;
use crate::sidecar::SidecarManager;
use crate::types::{GitCommit, SoulStatus};
use crate::watcher::WatcherState;

type ConfigState = Arc<Mutex<AppConfig>>;

fn soul_path(config: &State<ConfigState>) -> PathBuf {
    config.lock().unwrap().soul_path.clone()
}

// --- New commands for product setup ---

#[tauri::command]
pub fn get_app_state(config: State<ConfigState>) -> String {
    let cfg = config.lock().unwrap();
    cfg.app_state().to_string()
}

#[tauri::command]
pub fn get_soul_path(config: State<ConfigState>) -> String {
    soul_path(&config).to_string_lossy().to_string()
}

#[tauri::command]
pub fn set_soul_path(config: State<ConfigState>, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    // Security: validate the path
    if !p.is_absolute() {
        return Err("Soul path must be absolute".to_string());
    }
    if !p.exists() || !p.is_dir() {
        return Err("Soul path must be an existing directory".to_string());
    }
    // Block dangerous system directories
    let danger = ["/", "/etc", "/usr", "/bin", "/sbin", "/var", "/tmp", "/System", "/Library"];
    let path_str = p.to_string_lossy();
    for d in &danger {
        if path_str == *d {
            return Err("Cannot use a system directory as soul path".to_string());
        }
    }
    let mut cfg = config.lock().map_err(|e| e.to_string())?;
    cfg.soul_path = p;
    cfg.first_run = false;
    cfg.save()
}

#[tauri::command]
pub fn write_soul_file(
    config: State<ConfigState>,
    name: String,
    content: String,
) -> Result<(), String> {
    // Security: reject path traversal attempts
    if name.contains("..") {
        return Err("Access denied: path traversal not allowed".to_string());
    }

    let sp = soul_path(&config);
    let file_path = sp.join(&name);

    // Security: verify resolved path stays within soul directory
    let sp_canonical = sp.canonicalize().unwrap_or_else(|_| sp.clone());
    let target = file_path
        .canonicalize()
        .unwrap_or_else(|_| {
            // For new files: canonicalize parent, then append filename
            if let Some(parent) = file_path.parent() {
                if let Ok(canonical_parent) = parent.canonicalize() {
                    if let Some(fname) = file_path.file_name() {
                        return canonical_parent.join(fname);
                    }
                }
            }
            file_path.clone()
        });
    if !target.starts_with(&sp_canonical) {
        return Err("Access denied: path outside soul directory".to_string());
    }

    // Create parent directories
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Write file
    fs::write(&file_path, &content).map_err(|e| e.to_string())?;

    // Security: restrict .env file permissions
    #[cfg(unix)]
    if name == ".env" {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        let _ = std::fs::set_permissions(&file_path, perms);
    }

    Ok(())
}

#[tauri::command]
pub fn read_env(config: State<ConfigState>) -> Result<HashMap<String, String>, String> {
    let sp = soul_path(&config);
    let env_path = sp.join(".env");

    if !env_path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(&env_path).map_err(|e| e.to_string())?;
    let mut map = HashMap::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((key, val)) = trimmed.split_once('=') {
            let val = val.trim().trim_matches('"').trim_matches('\'');
            map.insert(key.trim().to_string(), val.to_string());
        }
    }

    Ok(map)
}

#[tauri::command]
pub fn write_env(
    config: State<ConfigState>,
    entries: HashMap<String, String>,
) -> Result<(), String> {
    let sp = soul_path(&config);
    let env_path = sp.join(".env");

    // Read existing file to preserve comments and order
    let existing = if env_path.exists() {
        fs::read_to_string(&env_path).unwrap_or_default()
    } else {
        String::new()
    };

    let mut result_lines: Vec<String> = Vec::new();
    let mut written_keys: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Update existing lines, preserving comments
    for line in existing.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            result_lines.push(line.to_string());
            continue;
        }
        if let Some((key, _)) = trimmed.split_once('=') {
            let key = key.trim();
            if let Some(new_val) = entries.get(key) {
                result_lines.push(format!("{}={}", key, new_val));
                written_keys.insert(key.to_string());
            } else {
                result_lines.push(line.to_string());
                written_keys.insert(key.to_string());
            }
        } else {
            result_lines.push(line.to_string());
        }
    }

    // Append new keys not in original file
    for (key, val) in &entries {
        if !written_keys.contains(key) {
            result_lines.push(format!("{}={}", key, val));
        }
    }

    // Ensure parent directory exists
    if let Some(parent) = env_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let content = result_lines.join("\n") + "\n";
    fs::write(&env_path, &content).map_err(|e| e.to_string())?;

    // Security: restrict .env file permissions (contains API keys)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        let _ = std::fs::set_permissions(&env_path, perms);
    }

    Ok(())
}

#[tauri::command]
pub fn check_node(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use crate::node;

    match node::find_node(Some(&app)) {
        Some(node_path) => {
            let version = node::node_version(&node_path)
                .unwrap_or_else(|| "unknown".to_string());
            Ok(serde_json::json!({
                "found": true,
                "path": node_path.to_string_lossy(),
                "version": version,
            }))
        }
        None => Ok(serde_json::json!({
            "found": false,
            "path": "",
            "version": "",
        })),
    }
}

#[tauri::command]
pub fn create_soul_directories(config: State<ConfigState>) -> Result<(), String> {
    let sp = soul_path(&config);

    let dirs = [
        "",
        "seele",
        "seele/beziehungen",
        "erinnerungen",
        "erinnerungen/kern",
        "erinnerungen/episodisch",
        "erinnerungen/semantisch",
        "erinnerungen/emotional",
        "erinnerungen/archiv",
        "heartbeat",
        "zustandslog",
        "memory",
        "connections",
        // English variants
        "soul",
        "soul/relationships",
        "memories",
        "memories/core",
        "memories/episodic",
        "memories/semantic",
        "memories/emotional",
        "memories/archive",
        "statelog",
    ];

    for dir in &dirs {
        let path = sp.join(dir);
        fs::create_dir_all(&path).map_err(|e| format!("Failed to create {}: {}", dir, e))?;
    }

    Ok(())
}

// --- Existing commands updated to use config ---

#[tauri::command]
pub fn get_soul_status(config: State<ConfigState>) -> Result<SoulStatus, String> {
    let sp = soul_path(&config);
    let seed_path = sp.join("SEED.md");

    if !seed_path.exists() {
        return Err("SEED.md not found".to_string());
    }

    let content = fs::read_to_string(&seed_path).map_err(|e| e.to_string())?;
    let seed_size = fs::metadata(&seed_path)
        .map(|m| m.len())
        .unwrap_or(0);

    // Parse basic info from SEED.md header
    let mut name = String::from("Soul");
    let mut born = String::from("unknown");
    let mut sessions: u32 = 0;
    let mut model = String::from("unknown");
    let mut state = String::new();
    let mut mood = String::new();

    for line in content.lines() {
        if line.starts_with("#SEED") {
            continue;
        }
        if line.starts_with("#geboren:") || line.starts_with("#born:") {
            for part in line.split_whitespace() {
                if let Some(val) = part.strip_prefix("#geboren:").or(part.strip_prefix("#born:")) {
                    born = val.to_string();
                }
                if let Some(val) = part.strip_prefix("#sessions:") {
                    sessions = val.parse().unwrap_or(0);
                }
            }
        }
        if line.contains("modell:") || line.contains("model:") {
            if let Some(idx) = line.find("modell:").or(line.find("model:")) {
                let rest = &line[idx..];
                let val = rest
                    .split('|')
                    .next()
                    .unwrap_or("")
                    .split(':')
                    .nth(1)
                    .unwrap_or("")
                    .trim();
                model = val.to_string();
            }
        }
        if line.contains("zustand:") || line.contains("state:") {
            if let Some(idx) = line.find("zustand:").or(line.find("state:")) {
                let rest = &line[idx..];
                let val = rest
                    .split('|')
                    .next()
                    .unwrap_or("")
                    .split(':')
                    .nth(1)
                    .unwrap_or("")
                    .trim();
                state = val.to_string();
            }
        }
    }

    // Derive mood from state
    if !state.is_empty() {
        mood = state.split(',').next().unwrap_or("").trim().to_string();
    }

    // Try to get name from @META or project
    if content.contains("projekt:seele") || content.contains("project:soul") {
        name = String::from("Seele");
    }

    Ok(SoulStatus {
        name,
        born,
        sessions,
        model,
        state,
        mood,
        seed_size,
    })
}

#[tauri::command]
pub fn read_soul_file(config: State<ConfigState>, name: String) -> Result<String, String> {
    let sp = soul_path(&config);
    let file_path = sp.join(&name);

    // Security: prevent path traversal
    let canonical = file_path.canonicalize().map_err(|e| e.to_string())?;
    let soul_canonical = sp.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.starts_with(&soul_canonical) {
        return Err("Access denied: path outside soul directory".to_string());
    }

    fs::read_to_string(&canonical).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_active_nodes(state: State<WatcherState>) -> HashMap<String, f64> {
    state.get_active_nodes_map()
}

#[tauri::command]
pub fn get_is_working(state: State<WatcherState>) -> bool {
    state.is_working()
}

#[tauri::command]
pub fn start_engine(
    sidecar: State<std::sync::Arc<SidecarManager>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    sidecar.start_engine(&app)
}

#[tauri::command]
pub fn stop_engine(
    sidecar: State<std::sync::Arc<SidecarManager>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    sidecar.stop_engine(&app)
}

#[tauri::command]
pub fn get_sidecar_status(
    sidecar: State<std::sync::Arc<SidecarManager>>,
) -> crate::sidecar::SidecarStatus {
    sidecar.get_status()
}

// --- Founding Commands ---

#[tauri::command]
pub fn start_founding(
    config: State<ConfigState>,
    founding: State<std::sync::Arc<crate::founding::FoundingServer>>,
    app: tauri::AppHandle,
) -> Result<u16, String> {
    let sp = soul_path(&config);
    founding.start(&app, &sp)
}

#[tauri::command]
pub fn stop_founding(
    founding: State<std::sync::Arc<crate::founding::FoundingServer>>,
) -> Result<(), String> {
    founding.stop()
}

#[tauri::command]
pub async fn founding_chat(
    founding: State<'_, std::sync::Arc<crate::founding::FoundingServer>>,
    message: String,
    history: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let port = founding.port();
    let url = format!("http://127.0.0.1:{}/chat", port);

    let body = serde_json::json!({
        "message": message,
        "history": history,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach founding server: {}", e))?;

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid response from founding server: {}", e))?;

    Ok(json)
}

#[tauri::command]
pub async fn founding_create(
    founding: State<'_, std::sync::Arc<crate::founding::FoundingServer>>,
    history: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let port = founding.port();
    let url = format!("http://127.0.0.1:{}/create", port);

    let body = serde_json::json!({ "history": history });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach founding server: {}", e))?;

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid response: {}", e))?;

    Ok(json)
}

// --- Engine Monitor Proxy ---

#[tauri::command]
pub async fn fetch_engine_subsystems(
    config: State<'_, ConfigState>,
) -> Result<serde_json::Value, String> {
    let sp = soul_path(&config);
    let env_path = sp.join(".env");

    // Read port and key from .env
    let mut port: u16 = 3001;
    let mut api_key = String::new();

    if let Ok(content) = fs::read_to_string(&env_path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(val) = trimmed.strip_prefix("API_PORT=") {
                if let Ok(p) = val.trim().trim_matches('"').parse::<u16>() {
                    port = p;
                }
            }
            if let Some(val) = trimmed.strip_prefix("API_KEY=") {
                api_key = val.trim().trim_matches('"').to_string();
            }
        }
    }

    let url = format!("http://127.0.0.1:{}/api/monitor", port);
    let client = reqwest::Client::new();
    let mut req = client.get(&url);
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }

    let resp = req
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await
        .map_err(|e| format!("Engine unreachable: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Engine returned {}", resp.status()));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    Ok(data)
}

// --- Chain Commands ---

#[tauri::command]
pub fn start_chain(
    sidecar: State<std::sync::Arc<SidecarManager>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    sidecar.start_chain(&app)
}

#[tauri::command]
pub fn stop_chain(
    sidecar: State<std::sync::Arc<SidecarManager>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    sidecar.stop_chain(&app)
}

#[tauri::command]
pub fn get_chain_status(
    sidecar: State<std::sync::Arc<SidecarManager>>,
) -> crate::sidecar::SidecarStatus {
    sidecar.get_chain_status()
}

// --- PTY Commands ---

#[tauri::command]
pub fn create_pty(
    pty: State<std::sync::Arc<PtyManager>>,
    app: tauri::AppHandle,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    pty.create(&app, cols, rows)
}

#[tauri::command]
pub fn write_pty(
    pty: State<std::sync::Arc<PtyManager>>,
    id: u32,
    data: String,
) -> Result<(), String> {
    pty.write(id, &data)
}

#[tauri::command]
pub fn resize_pty(
    pty: State<std::sync::Arc<PtyManager>>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty.resize(id, cols, rows)
}

#[tauri::command]
pub fn close_pty(
    pty: State<std::sync::Arc<PtyManager>>,
    id: u32,
) -> Result<(), String> {
    pty.close(id)
}

// --- State Versioning Commands (Git) ---

/// Find the git root: either soul_path itself or soul_path/seelen-protokoll
fn git_root(config: &State<ConfigState>) -> Option<PathBuf> {
    let sp = soul_path(config);
    if sp.join(".git").exists() {
        return Some(sp);
    }
    let proto = sp.join("seelen-protokoll");
    if proto.join(".git").exists() {
        return Some(proto);
    }
    None
}

#[tauri::command]
pub fn get_state_history(
    config: State<ConfigState>,
    limit: Option<u32>,
) -> Result<Vec<GitCommit>, String> {
    let repo = match git_root(&config) {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };

    let n = limit.unwrap_or(50);
    let output = Command::new("git")
        .args(["log", "--format=%H|%ai|%s", "-n", &n.to_string(), "--shortstat"])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("git log failed: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut commits = Vec::new();
    let mut current_commit: Option<(String, String, String)> = None;

    for line in text.lines() {
        if line.contains('|') && line.len() > 40 {
            // Flush previous commit
            if let Some((hash, date, msg)) = current_commit.take() {
                commits.push(GitCommit {
                    hash,
                    date,
                    message: msg,
                    files_changed: 0,
                });
            }
            let parts: Vec<&str> = line.splitn(3, '|').collect();
            if parts.len() >= 3 {
                current_commit = Some((
                    parts[0].to_string(),
                    parts[1].to_string(),
                    parts[2].to_string(),
                ));
            }
        } else if line.contains("file") && line.contains("changed") {
            let files = line
                .split_whitespace()
                .next()
                .and_then(|n| n.parse::<u32>().ok())
                .unwrap_or(0);
            if let Some((hash, date, msg)) = current_commit.take() {
                commits.push(GitCommit {
                    hash,
                    date,
                    message: msg,
                    files_changed: files,
                });
            }
        }
    }
    // Flush last
    if let Some((hash, date, msg)) = current_commit {
        commits.push(GitCommit {
            hash,
            date,
            message: msg,
            files_changed: 0,
        });
    }

    Ok(commits)
}

#[tauri::command]
pub fn get_state_diff(config: State<ConfigState>, hash: String) -> Result<String, String> {
    let repo = git_root(&config).ok_or_else(|| "No git repository found".to_string())?;
    if !hash.chars().all(|c| c.is_ascii_hexdigit()) || hash.len() < 7 {
        return Err("Invalid commit hash".to_string());
    }

    let output = Command::new("git")
        .args(["show", "--stat", "--patch", &hash])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("git show failed: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn rollback_state(config: State<ConfigState>, hash: String) -> Result<String, String> {
    let repo = git_root(&config).ok_or_else(|| "No git repository found".to_string())?;
    if !hash.chars().all(|c| c.is_ascii_hexdigit()) || hash.len() < 7 {
        return Err("Invalid commit hash".to_string());
    }

    let output = Command::new("git")
        .args(["revert", "--no-edit", &hash])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("git revert failed: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// --- Embedded Browser ---

const BROWSER_LABEL: &str = "soul-browser";

const BROWSER_POPUP_INIT: &str = r#"
(function() {
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') window.location.href = 'soul://close';
    });
    function addUI() {
        var btn = document.createElement('div');
        btn.innerHTML = '\u2715';
        Object.assign(btn.style, {
            position:'fixed', top:'10px', right:'10px', zIndex:'2147483647',
            width:'30px', height:'30px', borderRadius:'50%',
            background:'rgba(15,18,25,0.75)', color:'rgba(255,255,255,0.6)',
            display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', fontSize:'14px',
            backdropFilter:'blur(16px)', WebkitBackdropFilter:'blur(16px)',
            border:'1px solid rgba(100,200,255,0.15)',
            boxShadow:'0 2px 12px rgba(0,0,0,0.3),0 0 20px rgba(100,200,255,0.05)',
            transition:'all 0.25s cubic-bezier(0.4,0,0.2,1)',
            userSelect:'none', WebkitUserSelect:'none'
        });
        btn.onmouseenter = function(){
            this.style.background='rgba(255,50,80,0.85)';
            this.style.color='#fff';
            this.style.borderColor='rgba(255,50,80,0.4)';
            this.style.boxShadow='0 2px 12px rgba(0,0,0,0.3),0 0 20px rgba(255,50,80,0.2)';
        };
        btn.onmouseleave = function(){
            this.style.background='rgba(15,18,25,0.75)';
            this.style.color='rgba(255,255,255,0.6)';
            this.style.borderColor='rgba(100,200,255,0.15)';
            this.style.boxShadow='0 2px 12px rgba(0,0,0,0.3),0 0 20px rgba(100,200,255,0.05)';
        };
        btn.onclick = function(){ window.location.href = 'soul://close'; };
        document.body.appendChild(btn);
    }
    if (document.body) addUI();
    else document.addEventListener('DOMContentLoaded', addUI);
})();
"#;

#[tauri::command]
pub async fn open_browser(
    app: tauri::AppHandle,
    url: String,
    full_mode: bool,
) -> Result<(), String> {
    // Destroy existing browser window if any
    if let Some(existing) = app.get_webview_window(BROWSER_LABEL) {
        let _ = existing.destroy();
    }

    let url_parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;

    // Security: only allow http and https URLs
    match url_parsed.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("Blocked URL scheme: {}. Only http/https allowed.", scheme)),
    }

    let app_clone = app.clone();
    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        BROWSER_LABEL,
        tauri::WebviewUrl::External(url_parsed),
    )
    .title("SoulOS Browser")
    .center()
    .on_navigation(move |nav_url| {
        if nav_url.scheme() == "soul" {
            let app = app_clone.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(w) = app.get_webview_window(BROWSER_LABEL) {
                    let _ = w.destroy();
                }
            });
            return false;
        }
        true
    });

    if full_mode {
        builder = builder
            .inner_size(1100.0, 800.0)
            .decorations(true);
    } else {
        builder = builder
            .inner_size(900.0, 700.0)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .initialization_script(BROWSER_POPUP_INIT);
    }

    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn close_browser(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(BROWSER_LABEL) {
        w.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// --- Directory Listing ---

#[tauri::command]
pub fn list_directory(config: State<ConfigState>, name: String) -> Result<Vec<String>, String> {
    // Security: reject path traversal attempts
    if name.contains("..") {
        return Err("Access denied: path traversal not allowed".to_string());
    }

    let sp = soul_path(&config);
    let dir_path = sp.join(&name);

    // Security: verify resolved path stays within soul directory
    let sp_canonical = sp.canonicalize()
        .map_err(|e| format!("Cannot resolve soul directory: {}", e))?;
    let dir_canonical = dir_path.canonicalize()
        .map_err(|_| "Directory not found".to_string())?;
    if !dir_canonical.starts_with(&sp_canonical) {
        return Err("Access denied: path outside soul directory".to_string());
    }

    if !dir_path.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(&dir_path).map_err(|e| e.to_string())? {
        if let Ok(entry) = entry {
            if let Ok(name) = entry.file_name().into_string() {
                files.push(name);
            }
        }
    }
    files.sort();
    files.reverse(); // newest first (for date-based filenames)
    Ok(files)
}
