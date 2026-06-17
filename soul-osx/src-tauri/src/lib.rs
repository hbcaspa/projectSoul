// soulOSX — Rust-Backend.
//
// Zwei Verantwortlichkeiten:
//  1. PTY-Terminals (pty.rs) — das Herzstück: echte Shells, in denen die Seele (claude) läuft.
//  2. engine_fetch — HTTP an beide Soul-Engines (reqwest, kein CORS, beide Nodes).
//
// Plus: echtes macOS-Vibrancy-Material (NSVisualEffect) für den nativen Apple-Look.

mod pty;

use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;

#[tauri::command]
async fn engine_fetch(
    base: String,
    path: String,
    key: Option<String>,
    method: Option<String>,
    body: Option<String>,
) -> Result<String, String> {
    let url = format!("{}{}", base.trim_end_matches('/'), path);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("soulOSX/0.2")
        .build()
        .map_err(|e| e.to_string())?;
    let m = method.unwrap_or_else(|| "GET".into()).to_uppercase();
    let mut req = match m.as_str() {
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        _ => client.get(&url),
    };
    if let Some(k) = key {
        if !k.is_empty() {
            req = req.bearer_auth(k);
        }
    }
    if let Some(b) = body {
        req = req.header("content-type", "application/json").body(b);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let snippet: String = text.chars().take(240).collect();
        return Err(format!("HTTP {}: {}", status.as_u16(), snippet));
    }
    Ok(text)
}

#[tauri::command]
fn create_pty(pty: tauri::State<Arc<pty::PtyManager>>, app: tauri::AppHandle, cols: u16, rows: u16) -> Result<u32, String> {
    pty.create(&app, cols, rows)
}

#[tauri::command]
fn write_pty(pty: tauri::State<Arc<pty::PtyManager>>, id: u32, data: String) -> Result<(), String> {
    pty.write(id, &data)
}

#[tauri::command]
fn resize_pty(pty: tauri::State<Arc<pty::PtyManager>>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    pty.resize(id, cols, rows)
}

#[tauri::command]
fn close_pty(pty: tauri::State<Arc<pty::PtyManager>>, id: u32) -> Result<(), String> {
    pty.close(id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let soul_path = std::env::var("SOUL_PATH")
        .ok()
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/Users".into());
            format!("{}/Projects/soul", home)
        });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Arc::new(pty::PtyManager::new(soul_path)))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                if let Some(window) = app.get_webview_window("main") {
                    let _ = apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::UnderWindowBackground,
                        Some(NSVisualEffectState::Active),
                        Some(16.0),
                    );
                }
            }
            // PTY sauber beenden, wenn die App schließt.
            let handle = app.handle().clone();
            let main = app.get_webview_window("main");
            if let Some(win) = main {
                win.on_window_event(move |ev| {
                    if let tauri::WindowEvent::CloseRequested { .. } = ev {
                        if let Some(p) = handle.try_state::<Arc<pty::PtyManager>>() {
                            p.shutdown();
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine_fetch,
            create_pty,
            write_pty,
            resize_pty,
            close_pty
        ])
        .run(tauri::generate_context!())
        .expect("error while running soulOSX");
}
