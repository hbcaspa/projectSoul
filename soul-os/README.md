# SoulOS

Desktop application for the Soul Protocol. Download, install, run — no terminal needed.

## Stack

- **Frontend:** React 19, Vite, Tailwind CSS 4, Framer Motion, D3-Force
- **Backend:** Tauri 2 (Rust), Node.js 20 (bundled)
- **Terminal:** xterm.js with WebGL renderer
- **Build:** TypeScript, Cargo

## Architecture

```
src/                     React frontend
  App.tsx                App phases: loading → setup → founding → ready
  views/
    SetupWizard.tsx      6-step setup (language, path, LLM, connections, features)
    FoundingChat.tsx     Live LLM founding interview
    SettingsView.tsx     Full .env editor with API key testing
    BrainView.tsx        Neural visualization (15 nodes, D3-force)
    CardView.tsx         Soul identity card
    TimelineView.tsx     State versioning (git history)
    TerminalView.tsx     Integrated terminal (PTY)
  components/
    Dock.tsx             Floating dock with view switching
    BootSplash.tsx       Animated boot sequence
  lib/
    tauri.ts             Command bindings (Rust ↔ Frontend)
    setup.ts             Setup config types, provider models, env builder

src-tauri/               Rust backend
  src/
    lib.rs               Tauri setup, plugins, managed state
    config.rs            AppConfig persistence (JSON)
    commands.rs          20+ Tauri commands
    sidecar.rs           Engine + Chain process management
    founding.rs          Founding server process management
    node.rs              Node.js detection (bundled → system fallback)
    watcher.rs           File watcher for soul directory
    pty.rs               PTY management
    types.rs             Shared types
  tauri.conf.json        App config (dev)
  tauri.build.conf.json  Resource bundling (production only)
  resources/             Bundled resources (populated by prepare-build.sh)
    node/                Node.js binary
    soul-engine/         Engine source + deps
    soul-chain/          Chain source + deps

scripts/
  download-node.sh       Downloads Node.js LTS for current platform
  prepare-build.sh       Full build preparation (node + engine + chain)
```

## Development

```bash
npm install
npm run tauri dev
```

Requires:
- Node.js 20+
- Rust (stable)
- Tauri CLI (`npm install -g @tauri-apps/cli`)

## Production Build

```bash
bash scripts/prepare-build.sh
npm run build
npx tauri build --config src-tauri/tauri.build.conf.json
```

The DMG is at `src-tauri/target/release/bundle/dmg/`.

## App Phases

| Phase | View | Trigger |
|-------|------|---------|
| `loading` | Boot splash | App start |
| `setup` | SetupWizard | `first_run: true` in config |
| `founding` | FoundingChat | No `SEED.md` in soul path |
| `ready` | Brain + Dock | `SEED.md` exists |

## Tauri Commands

| Command | Description |
|---------|-------------|
| `get_app_state` | Returns `setup` / `founding` / `ready` |
| `set_soul_path` | Updates config, saves to disk |
| `check_node` | Finds Node.js (bundled or system) |
| `start_engine` / `stop_engine` | Soul engine lifecycle |
| `start_chain` / `stop_chain` | Soul chain lifecycle |
| `start_founding` / `founding_chat` / `founding_create` | Founding interview flow |
| `read_env` / `write_env` | .env read/write (preserves comments) |
| `create_pty` / `write_pty` / `resize_pty` | Terminal emulation |
| `get_state_history` / `rollback_state` | Git-based state versioning |

## LLM Providers

Configured during setup, stored in `.env`:

| Provider | Env Vars | Default Model |
|----------|----------|---------------|
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` | gpt-4.1-mini |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | gemini-2.5-flash |
| Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | claude-sonnet-4-6 |
| Ollama | `OLLAMA_URL`, `OLLAMA_MODEL` | llama3.1 |

## Config

Persisted at `~/Library/Application Support/com.projectsoul.soulosnew/config.json`:

```json
{
  "soul_path": "~/Soul",
  "first_run": true
}
```

## License

MIT
