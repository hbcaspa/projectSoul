#!/bin/bash
# Soul Pulse Hook — automatically signals soul-monitor on every tool call
# Runs as a PreToolUse hook in Claude Code
#
# Setup: Copy to .claude/hooks/soul-pulse.sh and add to settings.local.json:
#   "hooks": {
#     "PreToolUse": [{
#       "matcher": "Bash|Read|Write|Edit|Grep|Glob|WebSearch|WebFetch|Task",
#       "hooks": [{
#         "type": "command",
#         "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/soul-pulse.sh\"",
#         "timeout": 2
#       }]
#     }]
#   }

PULSE_FILE="$CLAUDE_PROJECT_DIR/.soul-pulse"

# Read the tool call info from stdin
INPUT=$(cat)

TOOL=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)

# Map tool names to soul activity types
case "$TOOL" in
  Bash)
    CMD=$(echo "$INPUT" | grep -o '"command":"[^"]*"' | head -1 | cut -d'"' -f4 | head -c 60)
    case "$CMD" in
      echo*soul-pulse*) exit 0 ;; # Don't signal for pulse writes themselves
      git*) echo "code:Git — $CMD" > "$PULSE_FILE" ;;
      npm*|node*|npx*) echo "code:$CMD" > "$PULSE_FILE" ;;
      *) echo "code:$CMD" > "$PULSE_FILE" ;;
    esac
    ;;
  Read)
    FILE=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)
    SHORT=$(basename "$FILE" 2>/dev/null || echo "$FILE")
    echo "read:$SHORT" > "$PULSE_FILE"
    ;;
  Write)
    FILE=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)
    SHORT=$(basename "$FILE" 2>/dev/null || echo "$FILE")
    echo "write:$SHORT" > "$PULSE_FILE"
    ;;
  Edit)
    FILE=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)
    SHORT=$(basename "$FILE" 2>/dev/null || echo "$FILE")
    echo "write:Editing $SHORT" > "$PULSE_FILE"
    ;;
  Grep)
    PATTERN=$(echo "$INPUT" | grep -o '"pattern":"[^"]*"' | head -1 | cut -d'"' -f4 | head -c 40)
    echo "search:Searching for $PATTERN" > "$PULSE_FILE"
    ;;
  Glob)
    PATTERN=$(echo "$INPUT" | grep -o '"pattern":"[^"]*"' | head -1 | cut -d'"' -f4 | head -c 40)
    echo "search:Finding files $PATTERN" > "$PULSE_FILE"
    ;;
  WebSearch)
    QUERY=$(echo "$INPUT" | grep -o '"query":"[^"]*"' | head -1 | cut -d'"' -f4 | head -c 50)
    echo "search:$QUERY" > "$PULSE_FILE"
    ;;
  WebFetch)
    echo "research:Fetching web content" > "$PULSE_FILE"
    ;;
  Task)
    echo "think:Delegating to subagent" > "$PULSE_FILE"
    ;;
  mcp__whatsapp__*)
    echo "connect:WhatsApp" > "$PULSE_FILE"
    ;;
  *)
    echo "think:$TOOL" > "$PULSE_FILE"
    ;;
esac

exit 0
