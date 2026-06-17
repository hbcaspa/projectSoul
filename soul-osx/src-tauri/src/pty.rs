// PTY-Manager — echte Pseudo-Terminals für soulOSX (portiert von soul-os, bewährt).
// Zwei-Thread-Architektur (Reader + Flusher): der Reader liest blockierend aus dem PTY
// in einen Puffer, der Flusher leert ihn alle 8ms → interaktive Prompts (Claude-Code-
// Permission etc.) hängen nicht. Emittiert "pty:data" {id,data} und "pty:exit" {id}.

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
    child: Box<dyn portable_pty::Child + Send>,
}

pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<u32, PtySession>>>,
    next_id: Arc<Mutex<u32>>,
    soul_path: String,
}

const FLUSH_INTERVAL: Duration = Duration::from_millis(8);
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
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("openpty: {}", e))?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");
        cmd.cwd(&self.soul_path);
        // Erlaubt verschachteltes `claude` (sonst: "cannot be launched inside another Claude Code session").
        cmd.env("CLAUDECODE", "");
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "soulOSX");
        cmd.env("LANG", std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string()));
        cmd.env("LC_CTYPE", std::env::var("LC_CTYPE").unwrap_or_else(|_| "en_US.UTF-8".to_string()));
        for key in &[
            "HOME", "USER", "LOGNAME", "PATH", "SHELL", "TMPDIR", "XDG_RUNTIME_DIR",
            "HOMEBREW_PREFIX", "HOMEBREW_CELLAR", "HOMEBREW_REPOSITORY", "SSH_AUTH_SOCK",
        ] {
            if let Ok(val) = std::env::var(key) {
                cmd.env(key, &val);
            }
        }
        cmd.env("SOUL_PATH", &self.soul_path);
        cmd.env("INSIDE_SOUL_OSX", "1");

        let child = pair.slave.spawn_command(cmd).map_err(|e| format!("spawn: {}", e))?;
        let master = pair.master;
        let writer = master.take_writer().map_err(|e| format!("writer: {}", e))?;
        let mut reader = master.try_clone_reader().map_err(|e| format!("reader: {}", e))?;

        let id = {
            let mut next = self.next_id.lock().unwrap();
            let id = *next;
            *next += 1;
            id
        };

        let buffer: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::with_capacity(MAX_FLUSH_BYTES)));
        let reader_done = Arc::new(AtomicBool::new(false));

        let buffer_r = buffer.clone();
        let done_r = reader_done.clone();
        std::thread::Builder::new()
            .name(format!("pty-reader-{}", id))
            .spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => { done_r.store(true, Ordering::SeqCst); break; }
                        Ok(n) => buffer_r.lock().unwrap().extend_from_slice(&buf[..n]),
                        Err(_) => { done_r.store(true, Ordering::SeqCst); break; }
                    }
                }
            })
            .map_err(|e| format!("reader thread: {}", e))?;

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
                            if done_f.load(Ordering::SeqCst) { break; }
                            continue;
                        }
                        std::mem::take(&mut *buf)
                    };
                    for chunk in data.chunks(MAX_FLUSH_BYTES) {
                        let text = String::from_utf8_lossy(chunk).to_string();
                        let _ = app_clone.emit("pty:data", serde_json::json!({ "id": pty_id, "data": text }));
                    }
                    if done_f.load(Ordering::SeqCst) { break; }
                }
                {
                    let buf = buffer_f.lock().unwrap();
                    if !buf.is_empty() {
                        let text = String::from_utf8_lossy(&buf).to_string();
                        let _ = app_clone.emit("pty:data", serde_json::json!({ "id": pty_id, "data": text }));
                    }
                }
                let _ = app_clone.emit("pty:exit", serde_json::json!({ "id": pty_id }));
            })
            .map_err(|e| format!("flusher thread: {}", e))?;

        self.sessions.lock().unwrap().insert(id, PtySession { master, writer, child });
        Ok(id)
    }

    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let s = sessions.get_mut(&id).ok_or_else(|| format!("PTY {} not found", id))?;
        s.writer.write_all(data.as_bytes()).map_err(|e| format!("write: {}", e))?;
        s.writer.flush().map_err(|e| format!("flush: {}", e))?;
        Ok(())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let s = sessions.get(&id).ok_or_else(|| format!("PTY {} not found", id))?;
        s.master
            .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("resize: {}", e))?;
        Ok(())
    }

    pub fn close(&self, id: u32) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(mut s) = sessions.remove(&id) {
            let _ = s.child.kill();
            let _ = s.child.wait();
        }
        Ok(())
    }

    pub fn shutdown(&self) {
        let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
        for (_id, mut s) in sessions.drain() {
            let _ = s.child.kill();
            let _ = s.child.wait();
        }
    }
}
