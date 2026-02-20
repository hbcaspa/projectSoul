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

## Combined Configuration

To use both hooks together in `.claude/settings.local.json`:

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
    }]
  }
}
```
