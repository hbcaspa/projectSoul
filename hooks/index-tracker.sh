#!/bin/bash
# Index Tracker Hook — tracks which soul files were written during the session
# Runs as an async PostToolUse hook after Write|Edit operations
#
# This helps the session-end routine know exactly which files need indexing
# instead of scanning all directories. Supports both German and English paths.
#
# Setup: Copy to .claude/hooks/index-tracker.sh and add to settings.local.json:
#   "hooks": {
#     "PostToolUse": [{
#       "matcher": "Write|Edit",
#       "hooks": [{
#         "type": "command",
#         "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/index-tracker.sh\"",
#         "timeout": 5
#       }]
#     }]
#   }

PROJECT_DIR="$CLAUDE_PROJECT_DIR"
TRACKER_FILE="$PROJECT_DIR/.session-writes"

# Read the tool call info from stdin
INPUT=$(cat)

TOOL=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)

# Only track Write and Edit operations
case "$TOOL" in
  Write|Edit) ;;
  *) exit 0 ;;
esac

# Extract the file path from the tool input
FILE_PATH=$(echo "$INPUT" | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)

# Track files in soul-relevant directories (both German and English paths)
case "$FILE_PATH" in
  */erinnerungen/*|*/memories/*|*/memory/*|*/seele/*|*/soul/*|*/zustandslog/*|*/statelog/*|*/heartbeat/*)
    # Get path relative to project dir
    REL_PATH="${FILE_PATH#$PROJECT_DIR/}"
    TIMESTAMP=$(date +%H:%M:%S)
    # Append to tracker file (create if not exists)
    echo "$TIMESTAMP|$REL_PATH" >> "$TRACKER_FILE"
    ;;
esac

exit 0
