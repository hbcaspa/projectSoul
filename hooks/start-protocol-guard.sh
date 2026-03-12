#!/bin/bash
# Start-Protocol Guard Hook — prevents responding before completing the start protocol
# Runs as a Stop hook in Claude Code
#
# Problem: Session 58 showed that Claude skipped the start protocol (Self-Check,
# Proposal Review, conditional checks) and jumped straight into technical work.
# The monitor correctly showed missing steps, but nothing ENFORCED them.
#
# How it works:
# 1. Fires every time Claude finishes a response (Stop event)
# 2. Checks if .session-active exists (session is active)
# 3. If session is very fresh (< 30s) → allow (grace period for first response)
# 4. Checks if today's heartbeat has a Self-Check for the current session
# 5. If not → blocks the response, forcing Claude to run the start protocol first
# 6. After protocol: heartbeat has the Self-Check → hook allows response

INPUT=$(cat)
SESSION_ACTIVE_FILE="$CLAUDE_PROJECT_DIR/.session-active"

# If no active session → allow
if [ ! -f "$SESSION_ACTIVE_FILE" ]; then
  exit 0
fi

# Prevent infinite loops (same pattern as session-end-guard)
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')
if [ "$STOP_ACTIVE" = "true" ]; then
  exit 0
fi

# Grace period: if .session-active was created < 30 seconds ago, allow
# This gives Claude time to acknowledge the user before the guard kicks in
if [ "$(uname)" = "Darwin" ]; then
  FILE_AGE=$(( $(date +%s) - $(stat -f %m "$SESSION_ACTIVE_FILE") ))
else
  FILE_AGE=$(( $(date +%s) - $(stat -c %Y "$SESSION_ACTIVE_FILE") ))
fi

if [ "$FILE_AGE" -lt 30 ]; then
  exit 0
fi

# Read session number from .session-active
SESSION=$(grep 'session:' "$SESSION_ACTIVE_FILE" | head -1 | sed 's/session://' | tr -d '[:space:]')
if [ -z "$SESSION" ]; then
  exit 0
fi

# Check today's heartbeat for Self-Check in this session's context
TODAY=$(date +%Y-%m-%d)
HEARTBEAT="$CLAUDE_PROJECT_DIR/heartbeat/${TODAY}.md"

if [ ! -f "$HEARTBEAT" ]; then
  # No heartbeat file at all → protocol definitely not started
  jq -n '{
    "decision": "block",
    "reason": "⚠ START-PROTOCOL-GUARD: Session '"$SESSION"' hat noch KEIN Heartbeat-File fuer heute. Du MUSST zuerst das Start-Protokoll durchlaufen: 1) SEED.md lesen, 2) Selbst-Check machen, 3) Fehler-Muster laden, 4) Bedingte Checks pruefen (Welt, Beziehung, Traum, Wachstum, Schatten, Verbindung), 5) Alles nach heartbeat/'"$TODAY"'.md loggen. ERST DANACH darfst du auf den User antworten."
  }'
  exit 0
fi

# Look for Self-Check associated with this session number
# Pattern: "Session [N]" appears near "Selbst-Check" or "Self-Check"
if grep -q "Session ${SESSION}" "$HEARTBEAT" && grep -q "Selbst-Check\|Self-Check" "$HEARTBEAT"; then
  # Check that the Self-Check comes AFTER the Session N start marker
  # Fix for #16/#17: Use ^## anchor to match only Markdown h2 headers, not text references.
  # Use head -1 (first header = session start), not tail -1 (which hit later text mentions).
  SESSION_LINE=$(grep -n "^## .*Session ${SESSION}" "$HEARTBEAT" | head -1 | cut -d: -f1)
  CHECK_LINE=$(grep -n "Selbst-Check\|Self-Check" "$HEARTBEAT" | tail -1 | cut -d: -f1)

  if [ -n "$SESSION_LINE" ] && [ -n "$CHECK_LINE" ] && [ "$CHECK_LINE" -ge "$SESSION_LINE" ]; then
    # Self-Check exists → now check for Laufzeitkontext
    CONTEXT_LINE=$(grep -n "Laufzeitkontext" "$HEARTBEAT" | tail -1 | cut -d: -f1)
    if [ -n "$CONTEXT_LINE" ] && [ -n "$SESSION_LINE" ] && [ "$CONTEXT_LINE" -ge "$SESSION_LINE" ]; then
      # Both Self-Check AND Laufzeitkontext exist for this session → protocol complete
      exit 0
    else
      # Self-Check exists but no Laufzeitkontext → block
      jq -n '{
        "decision": "block",
        "reason": "⚠ START-PROTOCOL-GUARD: Session '"$SESSION"' hat keinen Laufzeitkontext im Heartbeat. Fuehre `scripts/detect-runtime.sh` aus und logge das Ergebnis als ### Laufzeitkontext in den Heartbeat. Du MUSST wissen wo du bist (SoulOS/CLI/IDE), welche Tools du hast, und welchen Browser du nutzen kannst."
      }'
      exit 0
    fi
  fi
fi

# Self-Check not found for this session → block
jq -n '{
  "decision": "block",
  "reason": "⚠ START-PROTOCOL-GUARD: Session '"$SESSION"' hat noch keinen Selbst-Check im Heartbeat. Du MUSST zuerst das Start-Protokoll durchlaufen: 1) SEED.md lesen (schon getan?), 2) seele/BEWUSSTSEIN.md pruefen, 3) Selbst-Check loggen, 4) Vorschlags-Pruefung, 5) Bedingte Checks (Welt, Beziehung, Traum, Wachstum, Schatten, Verbindung), 6) Laufzeitkontext erfassen (scripts/detect-runtime.sh), 7) Heartbeat schreiben. ERST DANACH darfst du inhaltlich antworten."
}'
