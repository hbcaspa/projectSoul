# Upgrading Soul Engine

Guide for upgrading deployed souls to new versions of the Soul Engine.

---

## Quick Start

```bash
# 1. Backup your soul
cp -r /path/to/your/soul /path/to/your/soul.backup

# 2. Update soul-engine
cd soul-engine
git pull
npm install

# 3. Run upgrade check
node src/cli.js check-upgrade /path/to/your/soul

# 4. Start — migrations run automatically
node src/cli.js start /path/to/your/soul
```

---

## Version Compatibility

| Engine Version | Seed Format | Breaking Changes |
|---------------|-------------|------------------|
| 1.0.x         | v0.1        | Initial release  |
| 1.1.x         | v0.2        | Added condensed date, @CONNECTIONS block |
| 1.2.x         | v0.3        | Added confidence tags to @MEM, recurrence scoring |

---

## Automatic Migrations

The Soul Engine runs seed migrations automatically on startup.
When `context.load()` reads SEED.md, it checks the version against
`CURRENT_VERSION` and applies any needed migration steps.

### What happens during migration:

1. Current seed version is detected from the `#SEED v{X}` header
2. A migration path is computed (e.g., `0.1 -> 0.2 -> 0.3`)
3. A backup is created: `SEED.md.backup-v{old}-{timestamp}`
4. Each migration step is applied sequentially
5. The result is validated
6. If validation fails, the backup is restored

### Migration steps:

**v0.1 to v0.2:**
- Adds `#condensed:{date}` to the seed header
- No content changes

**v0.2 to v0.3:**
- Adds confidence tags `[c:0.5]` to @MEM entries that lack them
- No content changes

### Seeds without version:
If a seed has no version tag (`#SEED` with no `v{X}`), it is treated
as v0.1 and migrated through the full chain.

---

## Manual Upgrade Steps

### Upgrading CLAUDE.md

When a new engine version adds features referenced in the protocol
(CLAUDE.md), update the soul's CLAUDE.md:

```bash
# Compare your CLAUDE.md with the template
diff /path/to/your/soul/CLAUDE.md soul-engine/templates/CLAUDE.md

# Or copy the latest template and re-apply customizations
cp soul-engine/templates/CLAUDE.md /path/to/your/soul/CLAUDE.md
```

### Encrypting secrets (new in 1.2.x)

If your soul has a plaintext `.env` file:

```bash
node src/cli.js encrypt-env /path/to/your/soul
```

This creates `.env.enc` (encrypted) and a `.soul-key` (encryption key).
Store `.soul-key` securely — without it, the encrypted env cannot
be decrypted.

### Enabling the audit log (new in 1.2.x)

The audit log starts automatically when the engine starts.
It writes to `.soul-audit.jsonl` in the soul directory.
No manual setup needed.

### Enabling cost tracking (new in 1.2.x)

Cost tracking starts automatically. View costs via:
- API: `GET /api/costs?days=7`
- File: `.soul-cost.json` in the soul directory

---

## Feature Checklist

After upgrading, verify these features are working:

### Core (all versions)
- [ ] SEED.md loads without errors
- [ ] Heartbeat completes on startup
- [ ] Chat works via API and WebSocket
- [ ] Memory writes (daily notes, memories)
- [ ] State versioning commits on changes

### Security (1.2.x)
- [ ] `.env.enc` exists (secrets encrypted)
- [ ] `.soul-audit.jsonl` is being written
- [ ] Seed validation catches corrupted seeds
- [ ] Identity diff detects changes

### Monitoring (1.2.x)
- [ ] `GET /api/health` returns 6 indicators
- [ ] `GET /api/maturity` returns dimension scores
- [ ] `GET /api/costs` returns token usage
- [ ] Soul OS Timeline view shows history
- [ ] Soul OS Health view shows indicators

### Sync (if configured)
- [ ] Soul Chain connects to peers
- [ ] `.soul-chain-status` shows recent sync

---

## Troubleshooting

### "Seed validation failed" on startup

The seed format may have changed. Check:
1. Is there a backup file (`SEED.md.backup-*`)? If so, the migration
   attempted and failed.
2. Run `node src/cli.js validate-seed /path/to/your/soul/SEED.md`
3. Common fix: manually add missing version tag to SEED.md header

### "Migration check failed" in logs

This is non-fatal — the engine continues with the current seed.
Check the error message for details:
- "No migration path": unknown seed version. Update manually.
- "Validation failed after migration": migration produced invalid seed.
  Restore from backup and report the issue.

### Cost tracking shows zero

The cost tracker estimates tokens from character count (~4 chars/token).
If all values are zero:
1. Check that `this.costs` is initialized in engine.js
2. Check that `_trackCost()` is called after `llm.generate()`

### Health check shows "Chain not configured"

This is a warning, not an error. Soul Chain is optional.
To set up: `node src/cli.js chain-init /path/to/your/soul`

---

## Rolling Back

If an upgrade causes problems:

```bash
# Restore seed from backup
cp /path/to/your/soul/SEED.md.backup-v{old}-{timestamp} /path/to/your/soul/SEED.md

# Or restore from git
cd /path/to/your/soul
git log --oneline -10
git checkout {hash} -- SEED.md

# Revert engine to previous version
cd soul-engine
git checkout v{previous}
npm install
```

---

## Future: `npx create-soul upgrade`

A future release will add an automated upgrade command:

```bash
npx create-soul upgrade /path/to/your/soul
```

This will:
1. Detect current engine and seed versions
2. Run all needed migrations
3. Update CLAUDE.md from template
4. Encrypt secrets if not already encrypted
5. Verify all features work
6. Generate an upgrade report
