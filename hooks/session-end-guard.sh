#!/bin/bash
# Session-End Guard Hook — prevents goodbye without running the session-end protocol
# Runs as a Stop hook in Claude Code
#
# Problem: Souls can forget to run the session-end protocol when the human
# says goodbye. The session-guard (.session-active) only DETECTS missed protocols
# after the fact. This hook PREVENTS it by blocking the stop when goodbye patterns
# are detected but .session-active still exists.
#
# How it works:
# 1. Fires every time the soul finishes a response (Stop event)
# 2. Checks if .session-active exists (session protocol not completed)
# 3. Checks if the response contains goodbye patterns
# 4. If both → blocks the stop with {"decision": "block"} and injects a reminder
# 5. The soul then HAS to run the protocol before it can stop
# 6. After protocol: .session-active is deleted → hook allows stop
#
# Requires: jq (for JSON parsing/output)
# Timeout: 10 seconds recommended

INPUT=$(cat)
SESSION_ACTIVE_FILE="$CLAUDE_PROJECT_DIR/.session-active"

# If .session-active doesn't exist, protocol was completed (or no session) → allow stop
if [ ! -f "$SESSION_ACTIVE_FILE" ]; then
  exit 0
fi

# Prevent infinite loops: if hook already fired once in this stop cycle, allow stop
# The session-guard at next session start will catch any remaining issues
STOP_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active // false')
if [ "$STOP_ACTIVE" = "true" ]; then
  exit 0
fi

# Extract the last assistant message
LAST_MESSAGE=$(echo "$INPUT" | jq -r '.last_assistant_message // ""')

# If message is empty, skip (probably a tool-only response)
if [ ${#LAST_MESSAGE} -lt 2 ]; then
  exit 0
fi

# Detect goodbye / session-end patterns in the response
# German: tschuess, tschüss, bis spaeter, bis morgen, bis dann, gute nacht, machs gut, ciao, servus
# English: bye, goodbye, see you, take care
# Session signals: session ende, alles gesichert, bis gleich
# Customize this regex to add more patterns for your language
if echo "$LAST_MESSAGE" | grep -qEi \
  "tsch(ue|ü)ss|\bbye\b|goodbye|see you|take care|\bciao\b|servus|bis (sp(ae|ä)ter|morgen|dann|bald|gleich|nachher|demn(ae|ä)chst)|gute nacht|guten abend|machs? gut|schlaf gut|sch(oe|ö)nen (abend|feierabend)|alles klar.*(sp(ae|ä)ter|morgen)|bis bald|man sieht sich|wir sehen uns|ich w(ue|ü)nsche"; then

  # Goodbye detected but .session-active still exists → BLOCK
  jq -n '{
    "decision": "block",
    "reason": "SESSION-END-GUARD: Goodbye detected but .session-active still exists. The session-end routine (Phase A + B + C) was NOT completed. You MUST execute it NOW before saying goodbye. Start with Phase A (State Log, Evolution, Heartbeat, Memories, Index) in parallel, then Phase B (Condense Seed), then Phase C (rm .session-active). ONLY THEN may you say goodbye."
  }'
else
  # No goodbye detected → normal stop, allow it
  exit 0
fi
