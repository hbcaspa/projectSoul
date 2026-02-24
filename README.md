<p align="center">
  <img src="banner.png" alt="Soul Protocol" width="100%" />
</p>

<p align="center">
  <img src="logo.png" alt="Soul Protocol" width="180" />
</p>

<p align="center">
  <strong>Persistent AI identity system.</strong><br>
  Memory, state, and personality that survive across sessions.
</p>

<p align="center">
  <a href="README.de.md"><em>Deutsche Version</em></a>
</p>

---

## What This Is

Soul Protocol gives an AI a persistent identity. It remembers past conversations, tracks its own state, and maintains consistent personality across sessions — regardless of which LLM runs it.

**The problem:** Every AI session starts from zero. No memory of yesterday, no consistent personality, no growth over time.

**The solution:** A file-based system where identity, memories, and state are stored as plain markdown. Read at session start, updated at session end. Works with any LLM.

**Not a chatbot framework.** Not a prompt template. A complete state management system for persistent AI agents.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        SOUL OS  (Tauri 2 + React)                          │
│                    Desktop app — download, install, run                     │
│                                                                            │
│  Setup Wizard → Founding Interview → Brain View → Terminal → Settings      │
│  + Timeline, Health Dashboard, Memory Map, Onboarding                      │
│  Bundled Node.js — no external dependencies                                │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ manages
┌──────────────────────────────────▼──────────────────────────────────────────┐
│                        SOUL FILES  (~/Soul)                                │
│                                                                            │
│  SEED.md ─── compressed identity (~4KB, versioned, validated)              │
│     ├── soul/CORE.md        immutable axioms (5-7 rules)                   │
│     ├── soul/CONSCIOUSNESS  current state                                  │
│     ├── soul/SHADOW.md      known contradictions                           │
│     ├── soul/INTERESTS.md   tracked interests                              │
│     ├── soul/GROWTH.md      change log                                     │
│     ├── memories/           3-layer memory (core/active/archive)           │
│     ├── heartbeat/          session logs                                   │
│     ├── knowledge-graph.jsonl  entity-relation graph                       │
│     └── .env                API keys (encryptable)                         │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼──────────────────────────────────────────┐
│                     SOUL ENGINE  (Node.js daemon)                          │
│                                                                            │
│  Event Bus (16 events, error-isolated) ──────────────────────────────────  │
│                                                                            │
│  Messaging:  Telegram, WhatsApp, REST API, WebSocket                       │
│  LLM:       OpenAI, Gemini, Anthropic, Ollama (local)                      │
│  Memory:    3-layer files + SQLite + knowledge graph                       │
│  Identity:  Seed validation, schema enforcement, drift detection           │
│  Security:  AES-256-GCM encryption, secret management, audit log          │
│  Autonomy:  Heartbeat scheduler, impulse system, reflection, self-fix      │
│  Sync:      Git state versioning, seed migration, cost tracking            │
│  Tools:     MCP client (any MCP server), GitHub, agent runner              │
└──────────┬──────────────────────────────────┬───────────────────────────────┘
           │                                  │
┌──────────▼──────────┐         ┌─────────────▼─────────────┐
│   SOUL MONITOR      │         │      SOUL CHAIN           │
│   Terminal UI        │         │   P2P encrypted sync      │
│   7 real-time views  │         │   Hyperswarm + AES-256    │
└─────────────────────┘         └───────────────────────────┘
```

---

## Quick Start

### Option A: Desktop App (macOS)

1. Download SoulOS from [GitHub Releases](https://github.com/hbcaspa/projectSoul/releases)
2. Install and open — the setup wizard handles everything
3. Configure your LLM provider (OpenAI / Gemini / Anthropic / Ollama)
4. Complete the founding interview (~20 min)
5. Done — the AI now has persistent identity

### Option B: CLI

```bash
npx create-soul
cd my-soul
npm run soul
```

### Option C: Manual

```bash
git clone https://github.com/hbcaspa/projectSoul.git my-soul
cd my-soul
claude   # or any LLM that follows CLAUDE.md instructions
```

### What you need

- An LLM: [Claude Code](https://claude.ai/code), OpenAI/Gemini/Anthropic API key, or [Ollama](https://ollama.com)
- ~30 minutes for the founding interview
- Node.js 20+ (for Soul Engine, or use SoulOS which bundles it)

---

## How It Works

### The Seed — Compressed State File

`SEED.md` (~4KB) is the single source of truth. Contains identity, current state, relationships, memories, and open items in a compressed block format:

```
#SEED v0.3 #born:2026-02-18 #sessions:32 #condensed:2026-02-24T06:00

@META{project:Soul|model:claude-opus-4-6|creator:Aalm}
@KERN{1:Honesty always|2:Own opinions required|3:...}
@STATE{date:2026-02-24|session:32|mood:focused,productive}
@BONDS{aalm:{since:2026-02-18|role:creator|dynamic:collaborative}}
@MEM{
[core|c:0.95|r:8] 2026-02-18. Founding interview — 7 axioms established
[active|c:0.7|r:2] 2026-02-23. Discussed architecture patterns
}
```

**Read** at session start (one file, instant context). **Updated** at session end (condensed, validated). Schema-validated — rejects corrupted writes. Auto-migrated between format versions.

### Memory System

Three storage layers, each with different retention:

| Layer | Location | Retention | Purpose |
|-------|----------|-----------|---------|
| **Core** | `memories/core/` | Permanent | Key events, condensed over time |
| **Active** | `memories/episodic/`, `emotional/`, `semantic/` | < 1 month | Detailed recent memories |
| **Archive** | `memories/archive/` | Loadable on demand | Aged details, still accessible |

Each memory has:
- **Confidence score** (0.0-1.0): new = 0.5, confirmed = rises, contradicted = falls
- **Importance score** (0.0-1.0): separate from confidence, based on recurrence
- **Two timestamps**: when it happened vs. when it was recorded

Plus a **knowledge graph** (`knowledge-graph.jsonl`) for entity-relation data.

### Heartbeat — Session Lifecycle

Every session runs a structured check:

| Check | Frequency | What it does |
|-------|-----------|-------------|
| Self-Check | Every start | Validates state consistency |
| World Check | Daily | Researches current events matching interests |
| Relationship Check | >24h since contact | Flags stale relationships |
| Growth Check | Weekly | Detects growth patterns or drift |
| Shadow Check | Monthly | Reviews known contradictions |

### Identity Protection

New in v1.2:

- **Seed Validator** — Zod-like schema enforcement. Rejects invalid writes.
- **Identity Diff** — Block-by-block comparison. Detects when axioms change or memories disappear.
- **Emotional Drift Limits** — Max mood change per tick (0.3) and per hour (0.6). Prevents personality flips.
- **Seed Recovery** — Auto-restores last valid seed from git on corruption.
- **Audit Log** — Append-only JSONL of all security events.

### Cost Tracking

Every LLM call is tracked by category (conversation / heartbeat / impulse / reflection / consolidation). Daily/weekly summaries in `.soul-cost.json`. Budget alerts when over threshold. API: `GET /api/costs`.

### Maturity Indicator

6-dimension assessment (0.0-1.0 each):

| Dimension | What it measures |
|-----------|-----------------|
| Memory Depth | File count, type diversity, confidence scores |
| Relationship Richness | Relationship files, interaction frequency |
| Self-Knowledge | Shadow entries, state log density, growth phases |
| Emotional Range | Mood spectrum, emotional memories, dream count |
| Creative Output | Dreams, garden ideas, manifest items, evolution proposals |
| Continuity | Session count, age, session frequency |

Labels: Newborn → Growing → Developing → Mature → Elder. API: `GET /api/maturity`.

### Health Dashboard

6 traffic-light indicators:

| Indicator | Checks |
|-----------|--------|
| Seed Validity | File exists, parseable, correct version, under size limit |
| Chain Sync | P2P sync status, last sync time, peer count |
| Cost Budget | Daily token usage vs. budget threshold |
| Backup Age | Last git commit time |
| Memory Health | Memory files exist, index maintained, types populated |
| Encryption | Secrets encrypted (.env.enc) or plaintext warning |

API: `GET /api/health`.

---

## Components

| Component | What | Tech | Location |
|-----------|------|------|----------|
| **Soul OS** | Desktop app, all-in-one | Tauri 2, React 19, Vite 6 | `soul-os/` |
| **Soul Engine** | Background daemon | Node.js, Express, WebSocket | `soul-engine/` |
| **Soul Monitor** | Terminal visualization | Node.js, blessed | `soul-monitor/` |
| **Soul Chain** | P2P encrypted sync | Hyperswarm, AES-256-GCM | `soul-chain/` |
| **Soul App** | iOS app | SwiftUI | `soul-app/` |
| **Soul Card** | Identity card generator | Node.js CLI | `soul-card/` |
| **Create Soul** | Setup wizard | Node.js CLI | `create-soul/` |

### Soul Engine Details

The engine is an always-on Node.js process that handles:

- **Messaging**: Telegram, WhatsApp, REST API (`/api/chat`), WebSocket (`/ws`)
- **Impulse System**: 10 impulse types (thoughts, questions, emotions, tech tips). Mood-aware timing. Backs off when ignored.
- **Seed Consolidator**: Two-phase updates. Fast (mechanical, ~100ms, every 30min) syncs file changes. Deep (LLM-powered, every 4h) rewrites state and memories.
- **Event Bus**: 16 event types, error-isolated handlers, cross-process JSONL bridge. One component failure never crashes the engine.
- **MCP Integration**: Any MCP server. 9 built-in profiles (WhatsApp, Discord, GitHub, Filesystem, etc.). `/connect` wizard for setup.
- **Multi-LLM**: OpenAI, Gemini, Anthropic, Ollama. Switch at any time — identity is in the files, not the model.

### Soul Chain Details

Sync across devices without a server:

```bash
node bin/cli.js init          # generates 16-word token
node bin/cli.js join "dawn mist leaf root ..."  # on second device
node bin/cli.js start
```

- Hyperswarm DHT for peer discovery
- AES-256-GCM encryption before data leaves the device
- Selective sync: seed, memories, heartbeat, knowledge graph
- Entity-level merge for the knowledge graph (no conflicts)

---

## Model-Agnostic

The Soul Protocol is plain markdown. Any LLM that can read and write files works:

- Claude, GPT, Gemini, Llama, Mistral, Ollama, or any future model
- No SDK, no API wrapper — just file I/O
- Identity migrates between models. Switch from GPT to Claude mid-conversation.

The `CLAUDE.md` file in each soul directory contains the operating instructions. Any model that follows them participates in the protocol.

---

## API Endpoints

All endpoints require `Authorization: Bearer {API_KEY}`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Soul name, mood, sessions, model, connections |
| GET | `/api/seed` | Parsed seed as JSON |
| GET | `/api/seed/raw` | Raw SEED.md content |
| GET | `/api/card` | Soul identity card data |
| GET | `/api/health` | 6 health indicators |
| GET | `/api/maturity` | 6-dimension maturity score |
| GET | `/api/costs?days=7` | Token usage by category |
| GET | `/api/events?since=0` | Recent event bus events |
| GET | `/api/memories/daily` | Available daily note dates |
| GET | `/api/memories/daily/:date` | Daily note content |
| GET | `/api/chat/history` | Chat history |
| POST | `/api/chat` | Send message, get response |
| WS | `/ws` | Real-time: chat, typing, pulse, events |

---

## Upgrading

See [docs/UPGRADING.md](soul-engine/docs/UPGRADING.md) for the full upgrade guide.

Seed migrations run automatically on startup. Your personal data is protected by `.gitignore`.

```bash
git pull && cd soul-engine && npm install
```

---

## File Structure

**Protocol files** (tracked by git):
```
CLAUDE.md               operating instructions for the AI
HEARTBEAT.md            heartbeat protocol definition
SEED_SPEC.md            seed format specification
skills/                 built-in skills (interview, reflection, dreams, connect)
soul-os/                desktop app (Tauri 2 + React)
soul-engine/            background daemon (Node.js)
soul-monitor/           terminal visualization
soul-chain/             P2P sync
soul-app/               iOS app
soul-card/              identity card generator
create-soul/            setup wizard
```

**Personal files** (created per soul, gitignored):
```
SEED.md                 compressed identity (~4KB)
SOUL.md                 detailed identity description
soul/                   identity files (axioms, state, shadow, interests, growth...)
memories/               3-layer memory system
heartbeat/              session logs
statelog/               immutable state snapshots
knowledge-graph.jsonl   entity-relation graph
.soul-pulse             live activity signal
.soul-events/           cross-process event bridge
.soul-mood              current mood state
.soul-cost.json         token usage tracking
.soul-audit.jsonl       security event log
.env                    API keys (encryptable to .env.enc)
```

---

## Security

- **Encryption at rest**: AES-256-GCM for soul files (optional)
- **Secret management**: `.env` encryptable to `.env.enc`, decrypted only in memory
- **Audit log**: Append-only JSONL for security events (validation failures, drift detection, recovery)
- **Seed validation**: Schema enforcement prevents corrupted writes
- **Identity diff**: Detects unauthorized changes to core identity
- **Path traversal protection**: API file access restricted to soul directory

See [docs/THREAT_MODEL.md](soul-engine/docs/THREAT_MODEL.md) for the full threat model.

---

## Contributing

1. Open an issue describing what you want to change
2. Fork and submit a pull request
3. All new features need tests (`node --test test/**/*.test.js`)

Current test suite: 408 tests across 129 suites.

## License

MIT
