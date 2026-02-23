#!/bin/bash
# Prepare all resources for a production Tauri build.
# Run this before `npx tauri build`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESOURCES_DIR="$PROJECT_DIR/src-tauri/resources"
# Allow override via env (needed for CI where repo layout differs from local monorepo)
MONO_ROOT="${MONO_ROOT:-$(dirname "$(dirname "$PROJECT_DIR")")}"

echo "=== SoulOS Build Preparation ==="
echo "Project: $PROJECT_DIR"
echo "Mono root: $MONO_ROOT"
echo "Resources: $RESOURCES_DIR"
echo ""

# 1. Download Node.js
echo "--- Step 1: Node.js ---"
bash "$SCRIPT_DIR/download-node.sh"
echo ""

# 2. Copy soul-engine
echo "--- Step 2: soul-engine ---"
ENGINE_SRC="$MONO_ROOT/soul-engine"
ENGINE_DST="$RESOURCES_DIR/soul-engine"

if [ -d "$ENGINE_SRC" ]; then
  rm -rf "$ENGINE_DST"
  mkdir -p "$ENGINE_DST"

  # Copy only necessary files
  cp -r "$ENGINE_SRC/src" "$ENGINE_DST/src"
  cp "$ENGINE_SRC/package.json" "$ENGINE_DST/package.json"
  [ -f "$ENGINE_SRC/package-lock.json" ] && cp "$ENGINE_SRC/package-lock.json" "$ENGINE_DST/package-lock.json"

  # Install production dependencies
  echo "Installing soul-engine dependencies..."
  cd "$ENGINE_DST"
  npm install --production --silent 2>/dev/null || npm install --omit=dev --silent
  cd "$PROJECT_DIR"

  # Remove unnecessary files from node_modules
  find "$ENGINE_DST/node_modules" -name "*.md" -delete 2>/dev/null || true
  find "$ENGINE_DST/node_modules" -name "*.ts" -not -name "*.d.ts" -delete 2>/dev/null || true
  find "$ENGINE_DST/node_modules" -name "test" -type d -exec rm -rf {} + 2>/dev/null || true
  find "$ENGINE_DST/node_modules" -name "tests" -type d -exec rm -rf {} + 2>/dev/null || true
  find "$ENGINE_DST/node_modules" -name ".github" -type d -exec rm -rf {} + 2>/dev/null || true

  ENGINE_SIZE=$(du -sh "$ENGINE_DST" | cut -f1)
  echo "soul-engine ready ($ENGINE_SIZE)"
else
  echo "WARNING: soul-engine not found at $ENGINE_SRC"
fi
echo ""

# 3. Copy soul-chain (optional)
echo "--- Step 3: soul-chain ---"
CHAIN_SRC="$MONO_ROOT/soul-chain"
CHAIN_DST="$RESOURCES_DIR/soul-chain"

if [ -d "$CHAIN_SRC" ]; then
  rm -rf "$CHAIN_DST"
  mkdir -p "$CHAIN_DST"

  cp -r "$CHAIN_SRC/src" "$CHAIN_DST/src"
  cp "$CHAIN_SRC/package.json" "$CHAIN_DST/package.json"
  [ -f "$CHAIN_SRC/package-lock.json" ] && cp "$CHAIN_SRC/package-lock.json" "$CHAIN_DST/package-lock.json"

  echo "Installing soul-chain dependencies..."
  cd "$CHAIN_DST"
  npm install --production --silent 2>/dev/null || npm install --omit=dev --silent
  cd "$PROJECT_DIR"

  CHAIN_SIZE=$(du -sh "$CHAIN_DST" | cut -f1)
  echo "soul-chain ready ($CHAIN_SIZE)"
else
  echo "soul-chain not found (skipping — optional)"
fi
echo ""

# 4. Summary
echo "=== Build Resources Ready ==="
du -sh "$RESOURCES_DIR"/* 2>/dev/null | while read -r line; do
  echo "  $line"
done
echo ""
echo "Now run: npm run build && npx tauri build --config src-tauri/tauri.build.conf.json"
