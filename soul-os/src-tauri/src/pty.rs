use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

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

/// Flush interval for PTY output — guarantees data is delivered within this window
/// even when no further output follows (fixes interactive prompt hang)
const FLUSH_INTERVAL: Duration = Duration::from_millis(8);
/// Max bytes per emission to prevent oversized events
const MAX_FLUSH_BYTES: usize = 64 * 1024;

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

        // Remove Claude Code nesting guard — SoulOS terminal is independent,
        // not a nested session. Without this, `claude` refuses to start with
        // "cannot be launched inside another Claude Code session".
        // Note: use cmd.env() with empty value instead of std::env::remove_var()
        // to avoid modifying global process environment (unsound in multithreaded code)
        cmd.env("CLAUDECODE", "");

        // Terminal identification — helps CLIs detect capabilities
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "SoulOS");
        cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));

        // Locale — ensures proper Unicode handling
        cmd.env(
            "LANG",
            std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string()),
        );
        cmd.env(
            "LC_CTYPE",
            std::env::var("LC_CTYPE").unwrap_or_else(|_| "en_US.UTF-8".to_string()),
        );

        // Pass through essential environment
        for key in &[
            "HOME",
            "USER",
            "LOGNAME",
            "PATH",
            "SHELL",
            "TMPDIR",
            "XDG_RUNTIME_DIR",
            // Development tools
            "HOMEBREW_PREFIX",
            "HOMEBREW_CELLAR",
            "HOMEBREW_REPOSITORY",
            // SSH agent for git operations
            "SSH_AUTH_SOCK",
            // Note: API keys (ANTHROPIC_API_KEY etc.) are NOT passed to the terminal
            // to prevent accidental exposure to arbitrary commands run by the user
        ] {
            if let Ok(val) = std::env::var(key) {
                cmd.env(key, &val);
            }
        }

        // Soul context
        cmd.env("SOUL_PATH", &self.soul_path);
        cmd.env("INSIDE_SOUL_OS", "1");

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

        // ── Two-thread architecture: Reader + Flusher ──────────────────
        //
        // Previous bug: single thread with blocking read() + timer check.
        // If read() blocked (waiting for more PTY output) while data sat
        // in the batch buffer, that data was never flushed to the frontend.
        // This caused interactive prompts (like Claude Code's permission
        // prompt) to hang because the last output bytes never arrived.
        //
        // Fix: separate the reading from the flushing. The reader thread
        // pushes data into a shared buffer. The flusher thread drains the
        // buffer every FLUSH_INTERVAL, guaranteeing delivery even when
        // the PTY goes quiet (waiting for input).

        let buffer: Arc<Mutex<Vec<u8>>> =
            Arc::new(Mutex::new(Vec::with_capacity(MAX_FLUSH_BYTES)));
        let reader_done = Arc::new(AtomicBool::new(false));

        // Reader thread — reads from PTY into shared buffer (never delays)
        let buffer_r = buffer.clone();
        let done_r = reader_done.clone();
        std::thread::Builder::new()
            .name(format!("pty-reader-{}", id))
            .spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => {
                            done_r.store(true, Ordering::SeqCst);
                            break;
                        }
                        Ok(n) => {
                            buffer_r.lock().unwrap().extend_from_slice(&buf[..n]);
                        }
                        Err(_) => {
                            done_r.store(true, Ordering::SeqCst);
                            break;
                        }
                    }
                }
            })
            .map_err(|e| format!("Failed to spawn reader thread: {}", e))?;

        // Flusher thread — drains buffer at fixed interval, emits to frontend
        let buffer_f = buffer.clone();
        let done_f = reader_done.clone();
        let app_clone = app.clone();
        let pty_id = id;
        std::thread::Builder::new()
            .name(format!("pty-flusher-{}", id))
            .spawn(move || {
                loop {
                    std::thread::sleep(FLUSH_INTERVAL);

                    let data = {
                        let mut buf = buffer_f.lock().unwrap();
                        if buf.is_empty() {
                            if done_f.load(Ordering::SeqCst) {
                                break;
                            }
                            continue;
                        }
                        std::mem::take(&mut *buf)
                    };

                    // Emit in chunks to prevent oversized events
                    for chunk in data.chunks(MAX_FLUSH_BYTES) {
                        let text = String::from_utf8_lossy(chunk).to_string();
                        let _ = app_clone.emit(
                            "pty:data",
                            serde_json::json!({ "id": pty_id, "data": text }),
                        );
                    }

                    if done_f.load(Ordering::SeqCst) {
                        break;
                    }
                }

                // Final flush — drain anything remaining after reader EOF
                {
                    let buf = buffer_f.lock().unwrap();
                    if !buf.is_empty() {
                        let text = String::from_utf8_lossy(&buf).to_string();
                        let _ = app_clone.emit(
                            "pty:data",
                            serde_json::json!({ "id": pty_id, "data": text }),
                        );
                    }
                }

                // Notify frontend that the process exited
                let _ = app_clone.emit("pty:exit", serde_json::json!({ "id": pty_id }));
            })
            .map_err(|e| format!("Failed to spawn flusher thread: {}", e))?;

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
        if let Some(mut session) = sessions.remove(&id) {
            // Kill the child process to prevent orphans
            let _ = session._child.kill();
            let _ = session._child.wait();
        }
        Ok(())
    }

    /// Shutdown all PTY sessions — called on application exit
    pub fn shutdown(&self) {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        for (_id, mut session) in sessions.drain() {
            let _ = session._child.kill();
            let _ = session._child.wait();
        }
    }
}
