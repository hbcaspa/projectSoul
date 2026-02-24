#!/usr/bin/env node
// Entry point for SoulOS sidecar — starts the engine directly.
// The sidecar manager (Rust) calls: node src/index.js
// cli.js expects "start" as argv[2], so we inject it.
process.argv[2] = process.argv[2] || 'start';
await import('../bin/cli.js');
