use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoulStatus {
    pub name: String,
    pub born: String,
    pub sessions: u32,
    pub model: String,
    pub state: String,
    pub mood: String,
    pub seed_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoulPulse {
    pub activity_type: String,
    pub label: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoulActivity {
    pub node: String,
    pub file: String,
    pub event_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoulMood {
    pub valence: Option<f64>,
    pub energy: Option<f64>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommit {
    pub hash: String,
    pub date: String,
    pub message: String,
    pub files_changed: u32,
}
