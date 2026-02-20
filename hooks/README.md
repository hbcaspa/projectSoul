# Hooks

Optional Claude Code hooks that automate soul system tasks.

## Setup

1. Copy the hooks you want to `.claude/hooks/` in your soul directory
2. Make them executable: `chmod +x .claude/hooks/*.sh`
3. Add the hook configuration to `.claude/settings.local.json`

## Available Hooks

### soul-pulse.sh (PreToolUse)

Automatically signals the soul-monitor before every tool call. Replaces the need for manual `echo "type:..." > .soul-pulse` signals.

**What it does:** Maps each tool call (Read, Write, WebSearch, etc.) to a soul activity type and writes it to `.soul-pulse`. The soul-monitor picks this up and shows real-time activity.

**Config:**
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash|Read|Write|Edit|Grep|Glob|WebSearch|WebFetch|Task",
      "hooks": [{
        "type": "command",
        "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/soul-pulse.sh\"",
        "timeout": 2
      }]
    }]
  }
}
```

### index-tracker.sh (PostToolUse)

Tracks which soul-relevant files were written during the session. This helps the session-end routine know exactly what needs indexing — no scanning required.

**What it does:** After every Write/Edit to files in `erinnerungen/`, `memories/`, `seele/`, `soul/`, `memory/`, `heartbeat/`, `zustandslog/`, or `statelog/`, appends the file path and timestamp to `.session-writes`.

**Config:**
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/index-tracker.sh\"",
        "timeout": 5
      }]
    }]
  }
}
```

### session-end-guard.sh (Stop)

**The most critical hook.** Prevents the soul from saying goodbye without running the session-end protocol. This solves the problem of forgetting to condense the seed and write memories at session end.

**What it does:** Fires every time the soul finishes a response. Checks if:
1. `.session-active` exists (session protocol not yet completed)
2. The response contains goodbye patterns (tschuess, bye, bis morgen, etc.)

If both are true → **blocks the stop** and forces the soul to run Phase A + B + C before it can say goodbye. Uses `stop_hook_active` to prevent infinite loops.

**Why it matters:** Without this hook, the soul depends on willpower alone to remember the protocol. In our experience, that fails roughly 50% of the time. The session-guard (`.session-active`) catches missed protocols at the next session start, but this hook prevents the problem entirely.

**Requires:** `jq` (for JSON parsing)

**Config:**
```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/session-end-guard.sh\"",
        "timeout": 10
      }]
    }]
  }
}
```

**Customization:** Edit the `grep` regex pattern in the script to add goodbye phrases in your language.

## Combined Configuration

To use all three hooks together in `.claude/settings.local.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash|Read|Write|Edit|Grep|Glob|WebSearch|WebFetch|Task",
      "hooks": [{
        "type": "command",
        "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/soul-pulse.sh\"",
        "timeout": 2
      }]
    }],
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/index-tracker.sh\"",
        "timeout": 5
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/session-end-guard.sh\"",
        "timeout": 10
      }]
    }]
  }
}
```
