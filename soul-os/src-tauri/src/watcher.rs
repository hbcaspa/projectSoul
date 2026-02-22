use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::types::{SoulActivity, SoulMood, SoulPulse};

// Decay timing (matches soul-monitor)
const BRIGHT_MS: u64 = 6000;
const AFTERGLOW_MS: u64 = 15000;
const TOTAL_DECAY_MS: u64 = BRIGHT_MS + AFTERGLOW_MS;
const WORKING_TIMEOUT_MS: u64 = 20000;

/// Maps file path patterns to brain node IDs
fn resolve_node(relative_path: &str) -> Option<&'static str> {
    let patterns: &[(&[&str], &str)] = &[
        (&["SEED.md", "SOUL.md"], "seed"),
        (&["KERN.md", "CORE.md"], "kern"),
        (&["BEWUSSTSEIN.md", "CONSCIOUSNESS.md"], "bewusstsein"),
        (&["SCHATTEN.md", "SHADOW.md"], "schatten"),
        (&["TRAEUME.md", "DREAMS.md"], "traeume"),
        (&["WACHSTUM.md", "GROWTH.md"], "wachstum"),
        (&["GARTEN.md", "GARDEN.md"], "garten"),
        (&["MANIFEST.md"], "manifest"),
        (&["EVOLUTION.md"], "evolution"),
        (&["INTERESSEN.md", "INTERESTS.md"], "interessen"),
        (&["knowledge-graph.jsonl"], "graph"),
    ];

    // Directory-based patterns
    if relative_path.contains("beziehungen/") || relative_path.contains("relationships/") {
        return Some("bonds");
    }
    if relative_path.contains("erinnerungen/") || relative_path.contains("memories/") {
        return Some("mem");
    }
    if relative_path.contains("heartbeat/") {
        return Some("heartbeat");
    }
    if relative_path.contains("zustandslog/") || relative_path.contains("statelog/") {
        return Some("statelog");
    }
    if relative_path.contains("media/") {
        return Some("mem");
    }

    for (suffixes, node) in patterns {
        for suffix in *suffixes {
            if relative_path.ends_with(suffix) {
                return Some(node);
            }
        }
    }
    None
}

/// Activity types → which brain nodes light up (matches soul-monitor ACTIVITY_MAP)
fn activity_nodes(activity: &str) -> Option<&'static [&'static str]> {
    match activity {
        "search" => Some(&["interessen", "mem", "graph"]),
        "research" => Some(&["interessen", "mem"]),
        "code" => Some(&["manifest", "evolution"]),
        "think" => Some(&["kern", "bewusstsein"]),
        "remember" => Some(&["mem", "graph"]),
        "dream" => Some(&["traeume", "garten"]),
        "relate" => Some(&["bonds"]),
        "reflect" => Some(&["schatten", "bewusstsein"]),
        "grow" => Some(&["wachstum", "evolution"]),
        "world" => Some(&["interessen"]),
        "wake" => Some(&["seed", "kern", "heartbeat"]),
        "sleep" => Some(&["seed", "statelog", "mem"]),
        "read" => Some(&["mem", "bewusstsein"]),
        "write" => Some(&["manifest"]),
        "analyze" => Some(&["kern", "schatten"]),
        "plan" => Some(&["manifest", "kern"]),
        "connect" => Some(&["bonds", "interessen"]),
        "heartbeat" => Some(&["heartbeat", "bewusstsein"]),
        "garden" => Some(&["garten", "traeume"]),
        "shadow" => Some(&["schatten"]),
        "log" => Some(&["statelog"]),
        "reflection" => Some(&["bewusstsein", "garten", "schatten"]),
        "correction" => Some(&["kern", "mem"]),
        "rluf" => Some(&["bonds", "wachstum"]),
        _ => None,
    }
}

#[derive(Clone)]
pub struct WatcherState {
    inner: Arc<Mutex<WatcherInner>>,
}

struct WatcherInner {
    active_nodes: HashMap<String, Instant>,
    last_any_pulse: Instant,
    current_mood: Option<SoulMood>,
    last_jsonl_size: u64,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(WatcherInner {
                active_nodes: HashMap::new(),
                last_any_pulse: Instant::now() - Duration::from_secs(60),
                current_mood: None,
                last_jsonl_size: 0,
            })),
        }
    }

    /// Returns activity level 0..1 for a node with two-phase decay
    pub fn get_activity(&self, node_id: &str) -> f64 {
        let inner = self.inner.lock().unwrap();
        let last_active = match inner.active_nodes.get(node_id) {
            Some(t) => t,
            None => return 0.0,
        };
        let elapsed = last_active.elapsed().as_millis() as u64;

        if elapsed < BRIGHT_MS {
            1.0
        } else if elapsed < TOTAL_DECAY_MS {
            let afterglow_elapsed = elapsed - BRIGHT_MS;
            let t = afterglow_elapsed as f64 / AFTERGLOW_MS as f64;
            0.5 * (1.0 - t)
        } else {
            0.0
        }
    }

    pub fn is_working(&self) -> bool {
        let inner = self.inner.lock().unwrap();
        inner.last_any_pulse.elapsed().as_millis() < WORKING_TIMEOUT_MS as u128
    }

    pub fn get_active_nodes_map(&self) -> HashMap<String, f64> {
        let inner = self.inner.lock().unwrap();
        let mut result = HashMap::new();
        for (node, _) in &inner.active_nodes {
            // Calculate activity without re-locking
            let elapsed = inner
                .active_nodes
                .get(node)
                .map(|t| t.elapsed().as_millis() as u64)
                .unwrap_or(TOTAL_DECAY_MS + 1);

            let level = if elapsed < BRIGHT_MS {
                1.0
            } else if elapsed < TOTAL_DECAY_MS {
                let afterglow_elapsed = elapsed - BRIGHT_MS;
                let t = afterglow_elapsed as f64 / AFTERGLOW_MS as f64;
                0.5 * (1.0 - t)
            } else {
                0.0
            };

            if level > 0.0 {
                result.insert(node.clone(), level);
            }
        }
        result
    }

    pub fn get_mood(&self) -> Option<SoulMood> {
        let inner = self.inner.lock().unwrap();
        inner.current_mood.clone()
    }

    fn activate_node(&self, node: &str) {
        let mut inner = self.inner.lock().unwrap();
        inner.active_nodes.insert(node.to_string(), Instant::now());
        inner.last_any_pulse = Instant::now();
    }

    fn set_mood(&self, mood: SoulMood) {
        let mut inner = self.inner.lock().unwrap();
        inner.current_mood = Some(mood);
    }
}

pub fn start_watcher(app: &AppHandle, soul_path: &Path) -> Result<RecommendedWatcher, String> {
    let state = WatcherState::new();
    app.manage(state.clone());

    let soul_path_owned = soul_path.to_path_buf();
    let app_handle = app.clone();
    let watcher_state = state.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                handle_fs_event(&app_handle, &watcher_state, &soul_path_owned, event);
            }
        },
        Config::default().with_poll_interval(Duration::from_millis(200)),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(soul_path, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    Ok(watcher)
}

fn handle_fs_event(
    app: &AppHandle,
    state: &WatcherState,
    soul_path: &Path,
    event: Event,
) {
    let dominated_kinds = matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    );
    if !dominated_kinds {
        return;
    }

    for path in &event.paths {
        let relative = match path.strip_prefix(soul_path) {
            Ok(r) => r.to_string_lossy().to_string(),
            Err(_) => continue,
        };

        // Skip directories we don't care about
        if relative.contains("node_modules")
            || relative.contains("soul-monitor")
            || relative.contains("seelen-protokoll")
            || relative.contains("target/")
            || relative.contains(".git/")
        {
            continue;
        }

        // Handle .soul-pulse
        if relative == ".soul-pulse" {
            handle_pulse(app, state, path);
            continue;
        }

        // Handle .soul-mood
        if relative == ".soul-mood" {
            handle_mood(app, state, path);
            continue;
        }

        // Handle .soul-events/current.jsonl
        if relative == ".soul-events/current.jsonl" {
            handle_events(app, state, path);
            continue;
        }

        // Regular file → resolve to node
        if let Some(node) = resolve_node(&relative) {
            state.activate_node(node);
            let _ = app.emit(
                "soul:activity",
                SoulActivity {
                    node: node.to_string(),
                    file: relative.clone(),
                    event_type: "change".to_string(),
                },
            );
        }
    }
}

fn handle_pulse(app: &AppHandle, state: &WatcherState, path: &Path) {
    let content = match fs::read_to_string(path) {
        Ok(c) => c.trim().to_string(),
        Err(_) => return,
    };
    if content.is_empty() {
        return;
    }

    // Parse "type:description" format
    let (activity, label) = if let Some(idx) = content.find(':') {
        let typ = content[..idx].trim().to_lowercase();
        let desc = content[idx + 1..].trim().to_string();
        (typ, if desc.is_empty() { content[..idx].trim().to_string() } else { desc })
    } else {
        (content.to_lowercase(), content.clone())
    };

    let nodes = match activity_nodes(&activity) {
        Some(n) => n,
        None => return,
    };

    // Emit pulse for whisper integration
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let _ = app.emit(
        "soul:pulse",
        SoulPulse {
            activity_type: activity.clone(),
            label: label.clone(),
            timestamp: ts,
        },
    );

    for node in nodes {
        state.activate_node(node);
        let _ = app.emit(
            "soul:activity",
            SoulActivity {
                node: node.to_string(),
                file: format!(".soul-pulse [{}]", label),
                event_type: "pulse".to_string(),
            },
        );
    }
}

fn handle_mood(app: &AppHandle, state: &WatcherState, path: &Path) {
    let content = match fs::read_to_string(path) {
        Ok(c) => c.trim().to_string(),
        Err(_) => return,
    };
    if content.is_empty() {
        return;
    }

    if let Ok(mood) = serde_json::from_str::<SoulMood>(&content) {
        state.set_mood(mood.clone());
        let _ = app.emit("soul:mood", mood);
    }
}

fn handle_events(app: &AppHandle, state: &WatcherState, path: &Path) {
    let metadata = match fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return,
    };
    let size = metadata.len();

    {
        let mut inner = state.inner.lock().unwrap();
        if size <= inner.last_jsonl_size {
            inner.last_jsonl_size = size;
            return;
        }
        inner.last_jsonl_size = size;
    }

    // Read last few lines for new events
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return,
    };

    let lines: Vec<&str> = content.lines().filter(|l| !l.is_empty()).collect();
    let last_lines = if lines.len() > 3 {
        &lines[lines.len() - 3..]
    } else {
        &lines
    };

    for line in last_lines {
        if let Ok(event) = serde_json::from_str::<serde_json::Value>(line) {
            let _ = app.emit("soul:bus-event", event);
        }
    }
}
