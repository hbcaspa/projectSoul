#!/bin/bash
# Download Node.js LTS binary for the current platform
# Stores in src-tauri/resources/node/

set -euo pipefail

NODE_VERSION="v20.18.1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESOURCES_DIR="$PROJECT_DIR/src-tauri/resources"
NODE_DIR="$RESOURCES_DIR/node"

# Detect platform
PLATFORM="$(uname -s)"
ARCH="$(uname -m)"

case "$PLATFORM" in
  Darwin)
    case "$ARCH" in
      arm64) NODE_ARCH="darwin-arm64" ;;
      x86_64) NODE_ARCH="darwin-x64" ;;
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      aarch64) NODE_ARCH="linux-arm64" ;;
      x86_64) NODE_ARCH="linux-x64" ;;
      *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported platform: $PLATFORM"
    exit 1
    ;;
esac

NODE_FILENAME="node-${NODE_VERSION}-${NODE_ARCH}"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_FILENAME}.tar.gz"

# Skip if already downloaded
if [ -f "$NODE_DIR/bin/node" ]; then
  EXISTING_VERSION=$("$NODE_DIR/bin/node" --version 2>/dev/null || echo "")
  if [ "$EXISTING_VERSION" = "$NODE_VERSION" ]; then
    echo "Node.js $NODE_VERSION already downloaded for $NODE_ARCH"
    exit 0
  fi
fi

echo "Downloading Node.js $NODE_VERSION for $NODE_ARCH..."
mkdir -p "$NODE_DIR"

# Download and extract
TEMP_FILE=$(mktemp)
curl -fsSL "$NODE_URL" -o "$TEMP_FILE"

echo "Extracting..."
tar xzf "$TEMP_FILE" -C "$RESOURCES_DIR"

# Move to clean location
rm -rf "$NODE_DIR"
mv "$RESOURCES_DIR/$NODE_FILENAME" "$NODE_DIR"

# Clean up unnecessary files to reduce bundle size
rm -rf "$NODE_DIR/include" "$NODE_DIR/share" "$NODE_DIR/lib/node_modules/npm"
rm -f "$NODE_DIR/bin/npm" "$NODE_DIR/bin/npx" "$NODE_DIR/bin/corepack"
rm -f "$TEMP_FILE"

# Verify
NODE_ACTUAL=$("$NODE_DIR/bin/node" --version)
echo "Node.js $NODE_ACTUAL ready at $NODE_DIR/bin/node"

# Print size
SIZE=$(du -sh "$NODE_DIR" | cut -f1)
echo "Bundle size: $SIZE"
