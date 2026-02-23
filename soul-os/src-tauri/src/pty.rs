use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    _child: Box<dyn portable_pty::Child + Send>,
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<u32, PtySession>>>,
    next_id: Arc<Mutex<u32>>,
    soul_path: String,
}

/// Batch interval for PTY output — prevents event queue flooding
const BATCH_INTERVAL: Duration = Duration::from_millis(16);
/// Max bytes per batch — prevents single massive events
const MAX_BATCH_BYTES: usize = 64 * 1024; // 64 KB

impl PtyManager {
    pub fn new(soul_path: String) -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(1)),
            soul_path,
        }
    }

    pub fn create(&self, app: &AppHandle, cols: u16, rows: u16) -> Result<u32, String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        // Get the default shell — launch as interactive login shell
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l"); // login shell — sources .zprofile, .zshrc, etc.
        cmd.cwd(&self.soul_path);

        // Terminal capabilities
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("LANG", std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string()));

        // Pass through essential environment
        for key in &["HOME", "USER", "LOGNAME", "PATH", "SHELL", "TMPDIR", "XDG_RUNTIME_DIR"] {
            if let Ok(val) = std::env::var(key) {
                cmd.env(key, &val);
            }
        }

        // Soul context
        cmd.env("SOUL_PATH", &self.soul_path);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let master = pair.master;
        let writer = master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        let mut reader = master
            .try_clone_reader()
            .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

        let id = {
            let mut next = self.next_id.lock().unwrap();
            let id = *next;
            *next += 1;
            id
        };

        // Read thread — batches PTY output before sending to frontend
        let app_clone = app.clone();
        let pty_id = id;
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut batch = Vec::with_capacity(MAX_BATCH_BYTES);
            let mut last_emit = Instant::now();

            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF — flush remaining batch
                        if !batch.is_empty() {
                            let data = String::from_utf8_lossy(&batch).to_string();
                            let _ = app_clone.emit(
                                "pty:data",
                                serde_json::json!({ "id": pty_id, "data": data }),
                            );
                        }
                        break;
                    }
                    Ok(n) => {
                        batch.extend_from_slice(&buf[..n]);

                        let elapsed = last_emit.elapsed();
                        let batch_full = batch.len() >= MAX_BATCH_BYTES;

                        // Emit when batch interval exceeded OR batch is full
                        if elapsed >= BATCH_INTERVAL || batch_full {
                            let data = String::from_utf8_lossy(&batch).to_string();
                            let _ = app_clone.emit(
                                "pty:data",
                                serde_json::json!({ "id": pty_id, "data": data }),
                            );
                            batch.clear();
                            last_emit = Instant::now();
                        }
                    }
                    Err(_) => {
                        // Error — flush remaining batch
                        if !batch.is_empty() {
                            let data = String::from_utf8_lossy(&batch).to_string();
                            let _ = app_clone.emit(
                                "pty:data",
                                serde_json::json!({ "id": pty_id, "data": data }),
                            );
                        }
                        break;
                    }
                }
            }
        });

        let session = PtySession {
            master,
            writer,
            _child: child,
        };

        self.sessions.lock().unwrap().insert(id, session);
        Ok(id)
    }

    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get_mut(&id)
            .ok_or_else(|| format!("PTY session {} not found", id))?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write failed: {}", e))?;
        session
            .writer
            .flush()
            .map_err(|e| format!("Flush failed: {}", e))?;
        Ok(())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions
            .get(&id)
            .ok_or_else(|| format!("PTY session {} not found", id))?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {}", e))?;
        Ok(())
    }

    pub fn close(&self, id: u32) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        sessions.remove(&id);
        Ok(())
    }
}
