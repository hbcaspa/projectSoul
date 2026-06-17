// soulOSX — Rust-Backend.
//
// Bewusst minimal: ein einziges Command `engine_fetch`, das HTTP-Requests an die
// Soul-Engine(n) serverseitig (reqwest) ausführt — damit umgeht das Cockpit jede
// Browser-CORS-/Mixed-Content-/Zertifikats-Hürde und kann BEIDE Nodes (lokaler Mac
// :3002 UND alm-Server) direkt ansprechen, ohne nginx-Key-Proxy. Der API-Key wird
// vom Frontend pro Request mitgegeben (liegt lokal, nie im Bundle).
//
// SSE (Live-Event-Stream) läuft separat webview-seitig (EventSource) für den lokalen
// Node; Remote-Nodes werden via engine_fetch(/api/events?since=) gepollt.

use std::time::Duration;

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
        .user_agent("soulOSX/0.1")
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![engine_fetch])
        .run(tauri::generate_context!())
        .expect("error while running soulOSX");
}
