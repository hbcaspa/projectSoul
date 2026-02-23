mod commands;
mod config;
mod founding;
mod node;
mod pty;
mod sidecar;
mod types;
mod watcher;

use std::sync::{Arc, Mutex};

use tauri::Manager;

use config::AppConfig;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            #[cfg(debug_assertions)]
            window.open_devtools();

            // macOS vibrancy effect on the window
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None)
                    .ok();
            }

            // Load config
            let config = AppConfig::load();
            let soul_path = config.soul_path.clone();
            app.manage(Arc::new(Mutex::new(config)));

            // Start file watcher (only if soul_path exists)
            if soul_path.exists() {
                let _watcher = watcher::start_watcher(&app.handle(), &soul_path)
                    .expect("Failed to start soul watcher");
                app.manage(_watcher);
            }

            // Create founding server manager
            let founding_mgr = Arc::new(founding::FoundingServer::new());
            app.manage(founding_mgr);

            // Create sidecar manager
            let sidecar_mgr = Arc::new(sidecar::SidecarManager::new(soul_path.clone()));
            app.manage(sidecar_mgr);

            // Create PTY manager
            let pty_mgr = Arc::new(pty::PtyManager::new(
                soul_path.to_string_lossy().to_string(),
            ));
            app.manage(pty_mgr);

            Ok(())
        })
        .on_window_event(|window, event| {
            // Graceful shutdown: stop sidecar when window closes
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(sidecar) = window.try_state::<Arc<sidecar::SidecarManager>>() {
                    sidecar.shutdown();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_soul_status,
            commands::read_soul_file,
            commands::write_soul_file,
            commands::get_soul_path,
            commands::set_soul_path,
            commands::get_active_nodes,
            commands::get_is_working,
            commands::start_engine,
            commands::stop_engine,
            commands::get_sidecar_status,
            commands::create_pty,
            commands::write_pty,
            commands::resize_pty,
            commands::close_pty,
            commands::get_state_history,
            commands::get_state_diff,
            commands::rollback_state,
            commands::list_directory,
            commands::read_env,
            commands::write_env,
            commands::get_app_state,
            commands::check_node,
            commands::create_soul_directories,
            commands::start_chain,
            commands::stop_chain,
            commands::get_chain_status,
            commands::start_founding,
            commands::stop_founding,
            commands::founding_chat,
            commands::founding_create,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SoulOS");
}
