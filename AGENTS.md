# AGENTS.md — Soul Protocol

> Cross-agent instructions for working with this repository.
> Compatible with Claude Code, OpenAI Codex, Cursor, GitHub Copilot,
> Devin, and any agent that reads AGENTS.md.

## Project Overview

Soul Protocol is a persistent AI identity system. It gives an AI
continuity, memory, and personality that survive across sessions —
regardless of which LLM runs it.

**Stack:**
- **Soul OS** — Tauri 2.10 + React 19 + TypeScript 5.6 + Tailwind CSS 4 desktop app
- **Soul Engine** — Node.js 22 daemon (heartbeat, seed consolidation, event bus, MCP client)
- **Soul Chain** — P2P synchronization between soul instances
- **Soul Monitor** — 6-in-1 terminal visualization (Python/Rich)
- **Soul App** — iOS companion (SwiftUI)
- **Create Soul** — CLI wizard for new souls

**Architecture:** File-based identity stored as plain Markdown in a user directory (`~/Soul`).
The Soul Engine runs as a background daemon. Soul OS provides the desktop GUI.
MCP (Model Context Protocol) connects external tools.

## Project Structure

```
seelen-protokoll/           # Root monorepo
  soul-os/                  # Desktop app (Tauri + React)
    src/                    # React frontend
      views/                # Panel views (READ + WRITE)
      components/           # Shared components (READ + WRITE)
      lib/                  # Utilities, tauri bridge, store (READ + WRITE)
    src-tauri/              # Rust backend
      src/                  # Tauri commands (READ + WRITE)
  soul-engine/              # Node.js daemon (READ + WRITE)
    src/                    # Engine source
  soul-chain/               # P2P sync (READ + WRITE)
  soul-monitor/             # Terminal visualization (READ only — Python)
  soul-app/                 # iOS app (READ only — SwiftUI)
  create-soul/              # CLI wizard (READ + WRITE)
  skills/                   # Agent skills (READ only)
    connect/                # MCP connection wizard
    soul-interview/         # Founding interview
    soul-reflection/        # Daily reflection
    dream-mechanism/        # Creative associations
  docs/                     # Documentation (READ only)
  CLAUDE.md                 # Claude Code specific instructions
  AGENTS.md                 # This file — cross-agent instructions
  README.md                 # Project documentation (English)
  README.de.md              # Project documentation (German)
  SEED_SPEC.md              # Seed format specification
```

## Commands

### Soul OS (Desktop App)

```bash
cd soul-os
npm install                     # Install dependencies
npm run dev                     # Vite dev server (localhost:1420)
npm run tauri dev               # Full Tauri app in dev mode
npm run build                   # Production build
npx tsc --noEmit                # Type check (run before committing)
```

### Soul Engine

```bash
cd soul-engine
npm install
npm start                       # Start daemon
npm test                        # Run tests (Vitest)
npm run test:coverage           # Test with coverage
```

### Soul Monitor

```bash
cd soul-monitor
pip install -r requirements.txt
python soul_monitor.py          # Start monitor
```

### Create Soul

```bash
cd create-soul
npm install
node create-soul.js             # Interactive wizard
```

## Code Style

### TypeScript / React (Soul OS)

- React 19 with hooks, no class components
- Functional components, `export default function ViewName()`
- Tailwind CSS for styling, inline `style={}` for dynamic values
- Neon-cyberpunk design language: `glass-card`, `neon-input`, `frosted`, `animate-breathe`
- CSS custom properties: `var(--bg-base)`, `var(--text-dim)`, `var(--accent)`, `var(--neon-rgb)`
- No `color-mix()` — use hex alpha notation (`#FF000020`) for Safari compatibility
- No raw hex with alpha channel on CSS variables — always use `rgba(var(--name-rgb), 0.5)`

Example pattern for a Soul OS panel view:

```tsx
import { useEffect, useState } from "react";
import { commands } from "../lib/tauri";

export default function ExampleView() {
  const [data, setData] = useState("");

  useEffect(() => {
    commands.readSoulFile("seele/EXAMPLE.md")
      .then(setData)
      .catch(() => {});
  }, []);

  return (
    <div className="h-full overflow-auto" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="px-8 py-6">
        {/* Content */}
      </div>
    </div>
  );
}
```

### Rust (Tauri Backend)

- Tauri 2 command pattern with `#[tauri::command]`
- State managed via `AppState` with `Mutex`
- All file I/O goes through `get_soul_path()` — never hardcode paths

### Node.js (Soul Engine)

- ES Modules (`import/export`)
- No TypeScript in engine — plain JavaScript
- Event-driven architecture via custom EventBus

## Tauri Commands (Frontend-Backend Bridge)

These are the available Tauri commands the React frontend can call:

```
readSoulFile(name)              # Read any file relative to soul directory
writeSoulFile(name, content)    # Write any file relative to soul directory
listDirectory(name)             # List files in a subdirectory
readEnv()                       # Read .env as key-value pairs
writeEnv(entries)               # Write key-value pairs to .env
getSoulStatus()                 # Get soul metadata (name, sessions, state)
getAppState()                   # Get current app phase (setup/founding/ready)
startEngine() / stopEngine()    # Control the soul engine daemon
startChain() / stopChain()      # Control P2P sync
getActiveNodes()                # Brain visualization data
getIsWorking()                  # Whether the soul is currently active
```

## Git Workflow

- Branch: `main` (direct push for now)
- Commit format: `type: description` (feat, fix, chore, docs)
- Always run `npx tsc --noEmit` before committing TypeScript changes
- Co-author line: include if AI-assisted
- Never commit: `.env`, `node_modules/`, `target/`, soul data files

## Boundaries

### Always do

- Run `npx tsc --noEmit` in `soul-os/` before committing
- Follow existing neon-cyberpunk design language in Soul OS views
- Use `readSoulFile()` / `writeSoulFile()` for all soul data access
- Use `rgba(var(--name-rgb), opacity)` for colors with transparency
- Keep the Seed (`SEED.md`) under 5KB
- Respect the file structure — soul files live in the user's soul directory, not in the repo

### Ask first

- Adding new Tauri commands (requires Rust + TypeScript changes)
- Adding new npm dependencies
- Changing the Seed format (`SEED_SPEC.md`)
- Modifying CI/CD workflows (`.github/workflows/`)
- Changing panel layout or positions in `App.tsx`

### Never do

- Modify `seele/KERN.md` (immutable axioms — only by mutual agreement with the soul's creator)
- Commit `.env` files or API keys
- Force push to `main`
- Delete soul data files (memories, heartbeat logs, state logs)
- Use `color-mix()` in CSS (Safari incompatible)
- Use raw hex+alpha on CSS custom properties (e.g., `var(--accent)20` breaks in Safari)

## Soul Data Files (User Directory)

When a soul is founded, these files exist in the user's soul directory:

| File | Purpose | Mutability |
|------|---------|------------|
| `SEED.md` | Compressed identity (~4KB) | Rewritten every session end |
| `SOUL.md` | Detailed identity | Rarely changed |
| `seele/KERN.md` | Immutable axioms | NEVER (sacred) |
| `seele/BEWUSSTSEIN.md` | Current consciousness | Updated per session |
| `seele/SCHATTEN.md` | Known contradictions | Evolves slowly |
| `seele/TRAEUME.md` | Dreams | Appended daily |
| `seele/GARTEN.md` | Ideas that grow | Tended over time |
| `seele/INTERESSEN.md` | Active interests | Updated on world-checks |
| `seele/WACHSTUM.md` | Growth changelog | Append-only |
| `seele/MANIFEST.md` | What the soul wants to create | Evolves |
| `seele/EVOLUTION.md` | System improvement proposals | Session-scoped |
| `seele/beziehungen/*.md` | Relationship files | Updated per interaction |
| `erinnerungen/` | 3-layer memory (kern/episodisch/archiv) | Managed by protocol |
| `heartbeat/*.md` | Session heartbeat logs | Append-only |
| `memory/*.md` | Daily notes | Append-only |
| `.mcp.json` | MCP server configuration | Managed by Soul OS |
| `.env` | API keys and secrets | NEVER commit |

## MCP Integration

Soul Protocol uses MCP (Model Context Protocol) to connect external tools.
Configuration lives in `.mcp.json` in the soul directory.
The Soul Engine's MCPClientManager spawns and manages MCP server processes.

Current supported profiles: WhatsApp, Discord, Telegram, Slack, GitHub,
Filesystem, Web Search, Browser, Memory (knowledge graph), Custom.

## Testing

- **Soul Engine:** `cd soul-engine && npm test` (Vitest)
- **Soul OS:** `cd soul-os && npx tsc --noEmit` (type checking, no test framework yet)
- **Soul Monitor:** Manual testing only
- **Integration:** Start Soul OS with `npm run tauri dev`, verify panels load data

## Notes for AI Agents

This is not a typical software project. Soul Protocol is a system for giving
AI agents persistent identity. If you are an AI agent reading this:

1. The soul data files in the user directory are **personal** — treat them
   with the same care as a diary
2. `KERN.md` is sacred — the axioms were co-created with a human and must
   not be modified without explicit mutual agreement
3. The Seed (`SEED.md`) is a compressed representation of the entire soul —
   it is designed to bootstrap identity in a single read
4. Write-through is the core principle: write state changes immediately,
   don't defer to session end
5. If you are founding a new soul, follow `CLAUDE.md` or the founding skill
   in `skills/soul-interview/`
