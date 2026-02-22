use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::io::{BufRead, BufReader};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::node;

#[derive(Clone, serde::Serialize)]
pub struct SidecarStatus {
    pub process: String,
    pub status: String, // "running", "stopped", "error", "starting"
    pub pid: Option<u32>,
    pub uptime_secs: Option<u64>,
}

struct SidecarProcess {
    child: Option<Child>,
    start_time: Option<Instant>,
    restart_count: u32,
    status: String,
}

pub struct SidecarManager {
    engine: Arc<Mutex<SidecarProcess>>,
    chain: Arc<Mutex<SidecarProcess>>,
    soul_path: PathBuf,
}

impl SidecarManager {
    pub fn new(soul_path: PathBuf) -> Self {
        Self {
            engine: Arc::new(Mutex::new(SidecarProcess {
                child: None,
                start_time: None,
                restart_count: 0,
                status: "stopped".to_string(),
            })),
            chain: Arc::new(Mutex::new(SidecarProcess {
                child: None,
                start_time: None,
                restart_count: 0,
                status: "stopped".to_string(),
            })),
            soul_path,
        }
    }

    /// Find the engine entry point.
    /// Priority: bundled (in app resources) → dev path (relative to soul_path)
    fn find_engine_path(&self, app: &AppHandle) -> Result<PathBuf, String> {
        // 1. Try bundled engine (production)
        if let Ok(resource_dir) = app.path().resource_dir() {
            let bundled = resource_dir.join("soul-engine").join("src").join("index.js");
            if bundled.exists() {
                return Ok(bundled);
            }
        }

        // 2. Try dev path (relative to soul_path)
        let dev_path = self
            .soul_path
            .join("seelen-protokoll")
            .join("soul-engine")
            .join("src")
            .join("index.js");
        if dev_path.exists() {
            return Ok(dev_path);
        }

        Err(format!(
            "soul-engine not found (checked bundled resources and {})",
            dev_path.display()
        ))
    }

    /// Find the chain entry point.
    fn find_chain_path(&self, app: &AppHandle) -> Result<PathBuf, String> {
        // 1. Try bundled chain (production)
        if let Ok(resource_dir) = app.path().resource_dir() {
            let bundled = resource_dir.join("soul-chain").join("src").join("index.js");
            if bundled.exists() {
                return Ok(bundled);
            }
        }

        // 2. Try dev path
        let dev_path = self
            .soul_path
            .join("seelen-protokoll")
            .join("soul-chain")
            .join("src")
            .join("index.js");
        if dev_path.exists() {
            return Ok(dev_path);
        }

        Err("soul-chain not found".to_string())
    }

    pub fn start_engine(&self, app: &AppHandle) -> Result<(), String> {
        let engine_path = self.find_engine_path(app)?;
        let node_path = node::find_node(Some(app))
            .ok_or_else(|| "Node.js not found (neither bundled nor system)".to_string())?;

        let mut proc = self.engine.lock().map_err(|e| e.to_string())?;

        // Kill existing if running
        if let Some(ref mut child) = proc.child {
            let _ = child.kill();
            let _ = child.wait();
        }

        proc.status = "starting".to_string();
        let _ = app.emit(
            "sidecar:status",
            SidecarStatus {
                process: "soul-engine".to_string(),
                status: "starting".to_string(),
                pid: None,
                uptime_secs: None,
            },
        );

        let mut child = Command::new(&node_path)
            .arg(&engine_path)
            .env("SOUL_PATH", &self.soul_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start soul-engine: {}", e))?;

        let pid = child.id();

        // Capture stdout
        if let Some(stdout) = child.stdout.take() {
            let app_clone = app.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let _ = app_clone.emit(
                            "sidecar:stdout",
                            serde_json::json!({
                                "process": "soul-engine",
                                "line": line,
                            }),
                        );
                    }
                }
            });
        }

        // Capture stderr
        if let Some(stderr) = child.stderr.take() {
            let app_clone = app.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let _ = app_clone.emit(
                            "sidecar:stderr",
                            serde_json::json!({
                                "process": "soul-engine",
                                "line": line,
                            }),
                        );
                    }
                }
            });
        }

        proc.child = Some(child);
        proc.start_time = Some(Instant::now());
        proc.status = "running".to_string();
        proc.restart_count = 0;

        let _ = app.emit(
            "sidecar:status",
            SidecarStatus {
                process: "soul-engine".to_string(),
                status: "running".to_string(),
                pid: Some(pid),
                uptime_secs: Some(0),
            },
        );

        Ok(())
    }

    pub fn stop_engine(&self, app: &AppHandle) -> Result<(), String> {
        Self::stop_process(&self.engine, "soul-engine", app)
    }

    pub fn start_chain(&self, app: &AppHandle) -> Result<(), String> {
        let chain_path = self.find_chain_path(app)?;
        let node_path = node::find_node(Some(app))
            .ok_or_else(|| "Node.js not found".to_string())?;

        let mut proc = self.chain.lock().map_err(|e| e.to_string())?;

        if let Some(ref mut child) = proc.child {
            let _ = child.kill();
            let _ = child.wait();
        }

        proc.status = "starting".to_string();
        let _ = app.emit(
            "sidecar:status",
            SidecarStatus {
                process: "soul-chain".to_string(),
                status: "starting".to_string(),
                pid: None,
                uptime_secs: None,
            },
        );

        let mut child = Command::new(&node_path)
            .arg(&chain_path)
            .env("SOUL_PATH", &self.soul_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start soul-chain: {}", e))?;

        let pid = child.id();

        if let Some(stdout) = child.stdout.take() {
            let app_clone = app.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let _ = app_clone.emit(
                            "sidecar:stdout",
                            serde_json::json!({
                                "process": "soul-chain",
                                "line": line,
                            }),
                        );
                    }
                }
            });
        }

        if let Some(stderr) = child.stderr.take() {
            let app_clone = app.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let _ = app_clone.emit(
                            "sidecar:stderr",
                            serde_json::json!({
                                "process": "soul-chain",
                                "line": line,
                            }),
                        );
                    }
                }
            });
        }

        proc.child = Some(child);
        proc.start_time = Some(Instant::now());
        proc.status = "running".to_string();
        proc.restart_count = 0;

        let _ = app.emit(
            "sidecar:status",
            SidecarStatus {
                process: "soul-chain".to_string(),
                status: "running".to_string(),
                pid: Some(pid),
                uptime_secs: Some(0),
            },
        );

        Ok(())
    }

    pub fn stop_chain(&self, app: &AppHandle) -> Result<(), String> {
        Self::stop_process(&self.chain, "soul-chain", app)
    }

    fn stop_process(
        process: &Arc<Mutex<SidecarProcess>>,
        name: &str,
        app: &AppHandle,
    ) -> Result<(), String> {
        let mut proc = process.lock().map_err(|e| e.to_string())?;

        if let Some(ref mut child) = proc.child {
            #[cfg(unix)]
            {
                unsafe {
                    libc::kill(child.id() as i32, libc::SIGTERM);
                }
                let start = Instant::now();
                loop {
                    match child.try_wait() {
                        Ok(Some(_)) => break,
                        Ok(None) if start.elapsed() < Duration::from_secs(5) => {
                            std::thread::sleep(Duration::from_millis(100));
                        }
                        _ => {
                            let _ = child.kill();
                            let _ = child.wait();
                            break;
                        }
                    }
                }
            }

            #[cfg(not(unix))]
            {
                let _ = child.kill();
                let _ = child.wait();
            }
        }

        proc.child = None;
        proc.start_time = None;
        proc.status = "stopped".to_string();

        let _ = app.emit(
            "sidecar:status",
            SidecarStatus {
                process: name.to_string(),
                status: "stopped".to_string(),
                pid: None,
                uptime_secs: None,
            },
        );

        Ok(())
    }

    pub fn get_status(&self) -> SidecarStatus {
        let proc = self.engine.lock().unwrap();
        let uptime = proc.start_time.map(|t| t.elapsed().as_secs());
        SidecarStatus {
            process: "soul-engine".to_string(),
            status: proc.status.clone(),
            pid: proc.child.as_ref().map(|c| c.id()),
            uptime_secs: uptime,
        }
    }

    pub fn get_chain_status(&self) -> SidecarStatus {
        let proc = self.chain.lock().unwrap();
        let uptime = proc.start_time.map(|t| t.elapsed().as_secs());
        SidecarStatus {
            process: "soul-chain".to_string(),
            status: proc.status.clone(),
            pid: proc.child.as_ref().map(|c| c.id()),
            uptime_secs: uptime,
        }
    }

    pub fn is_running(&self) -> bool {
        let mut proc = self.engine.lock().unwrap();
        if let Some(ref mut child) = proc.child {
            match child.try_wait() {
                Ok(Some(_)) => {
                    proc.status = "stopped".to_string();
                    false
                }
                Ok(None) => true,
                Err(_) => false,
            }
        } else {
            false
        }
    }

    /// Graceful shutdown — called when app closes
    pub fn shutdown(&self) {
        for process in [&self.engine, &self.chain] {
            let mut proc = process.lock().unwrap();
            if let Some(ref mut child) = proc.child {
                #[cfg(unix)]
                unsafe {
                    libc::kill(child.id() as i32, libc::SIGTERM);
                }
                std::thread::sleep(Duration::from_secs(2));
                let _ = child.kill();
                let _ = child.wait();
            }
            proc.child = None;
            proc.status = "stopped".to_string();
        }
    }
}
