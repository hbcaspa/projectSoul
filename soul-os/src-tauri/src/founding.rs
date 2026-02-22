use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::node;

pub struct FoundingServer {
    child: Mutex<Option<Child>>,
    port: u16,
}

impl FoundingServer {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            port: 17433,
        }
    }

    pub fn start(&self, app: &AppHandle, soul_path: &PathBuf) -> Result<u16, String> {
        let mut child_lock = self.child.lock().map_err(|e| e.to_string())?;

        // Kill existing if running
        if let Some(ref mut child) = *child_lock {
            let _ = child.kill();
            let _ = child.wait();
        }

        let node_path = node::find_node(Some(app))
            .ok_or_else(|| "Node.js not found".to_string())?;

        // Find founding-server.js (bundled or dev)
        let server_path = Self::find_server_js(app, soul_path)?;

        let mut child = Command::new(&node_path)
            .arg(&server_path)
            .env("SOUL_PATH", soul_path)
            .env("FOUNDING_PORT", self.port.to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start founding server: {}", e))?;

        // Capture stderr for debugging
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        eprintln!("[founding-server] {}", line);
                    }
                }
            });
        }

        // Capture stdout
        if let Some(stdout) = child.stdout.take() {
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        println!("[founding-server] {}", line);
                    }
                }
            });
        }

        *child_lock = Some(child);

        // Wait briefly for server to start
        std::thread::sleep(std::time::Duration::from_millis(1500));

        Ok(self.port)
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut child_lock = self.child.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut child) = *child_lock {
            #[cfg(unix)]
            unsafe {
                libc::kill(child.id() as i32, libc::SIGTERM);
            }
            std::thread::sleep(std::time::Duration::from_secs(1));
            let _ = child.kill();
            let _ = child.wait();
        }
        *child_lock = None;
        Ok(())
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    fn find_server_js(app: &AppHandle, soul_path: &PathBuf) -> Result<PathBuf, String> {
        // 1. Bundled (production)
        if let Ok(resource_dir) = app.path().resource_dir() {
            let bundled = resource_dir
                .join("soul-engine")
                .join("src")
                .join("founding-server.js");
            if bundled.exists() {
                return Ok(bundled);
            }
        }

        // 2. Dev path
        let dev_path = soul_path
            .join("seelen-protokoll")
            .join("soul-engine")
            .join("src")
            .join("founding-server.js");
        if dev_path.exists() {
            return Ok(dev_path);
        }

        Err("founding-server.js not found".to_string())
    }
}

impl Drop for FoundingServer {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}
