mod commands;
mod config;
mod founding;
mod node;
mod pty;
mod sidecar;
mod types;
mod watcher;

use std::sync::{Arc, Mutex};

use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

use config::AppConfig;

/// Start the breathing animation for the tray icon.
/// Alternates between bright and dim frames every 1.5 seconds.
fn start_tray_breathing(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let bright = include_bytes!("../icons/tray-bright.png");
        let dim = include_bytes!("../icons/tray-dim.png");
        let mut is_bright = true;

        loop {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            is_bright = !is_bright;
            let bytes: &[u8] = if is_bright { bright } else { dim };

            if let Some(tray) = app_handle.tray_by_id("soul-tray") {
                if let Ok(img) = Image::from_bytes(bytes) {
                    let _ = tray.set_icon(Some(img));
                    #[cfg(target_os = "macos")]
                    let _ = tray.set_icon_as_template(true);
                }
            }
        }
    });
}

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

            // ── System Tray (Ambient Presence) ─────────────────────
            let show_i = MenuItem::with_id(app, "show", "Show SoulOS", true, None::<&str>)?;
            let hide_i = MenuItem::with_id(app, "hide", "Hide to Tray", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit SoulOS", true, None::<&str>)?;

            let tray_menu = MenuBuilder::new(app)
                .item(&show_i)
                .item(&hide_i)
                .separator()
                .item(&quit_i)
                .build()?;

            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

            let _tray = TrayIconBuilder::with_id("soul-tray")
                .icon(tray_icon)
                .tooltip("SoulOS — Ambient Presence")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "quit" => {
                        // Graceful shutdown
                        if let Some(sidecar) = app.try_state::<Arc<sidecar::SidecarManager>>() {
                            sidecar.shutdown();
                        }
                        if let Some(pty) = app.try_state::<Arc<pty::PtyManager>>() {
                            pty.shutdown();
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click toggles window visibility
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            #[cfg(target_os = "macos")]
            let _ = _tray.set_icon_as_template(true);

            // Start breathing animation
            start_tray_breathing(app.handle().clone());

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
            match event {
                // Close to tray instead of quitting (main window only)
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if window.label() == "main" {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                // Graceful shutdown on actual destroy (via Quit menu)
                tauri::WindowEvent::Destroyed => {
                    if window.label() == "main" {
                        if let Some(sidecar) = window.try_state::<Arc<sidecar::SidecarManager>>() {
                            sidecar.shutdown();
                        }
                        if let Some(pty) = window.try_state::<Arc<pty::PtyManager>>() {
                            pty.shutdown();
                        }
                    }
                }
                _ => {}
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
            commands::open_browser,
            commands::close_browser,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SoulOS");
}
