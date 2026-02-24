# Threat Model — Soul Engine

> Version 1.0 | 2026-02-23
> Scope: soul-engine, soul-os, create-soul, soul-chain

---

## Trust Boundaries

```
+-----------------------------------------------------+
|  User Machine (trusted)                             |
|                                                     |
|  +-----------+    +-------------+    +----------+   |
|  | Soul OS   |<-->| Soul Engine |<-->| MemoryDB |   |
|  | (browser) |    | (Node.js)   |    | (SQLite) |   |
|  +-----------+    +------+------+    +----------+   |
|                          |                          |
+--------- BOUNDARY 1 ----+--------------------------|
                           |
            +--------------+--------------+
            |              |              |
     +------v---+   +------v---+   +------v---+
     | Telegram |   | LLM API  |   | Soul     |
     | Bot API  |   | (OpenAI/ |   | Chain    |
     |          |   |  Gemini) |   | (P2P)    |
     +----------+   +----------+   +----------+
       BOUNDARY 2     BOUNDARY 3     BOUNDARY 4
```

| Boundary | Description | Trust Level |
|----------|-------------|-------------|
| B1 | Local machine ↔ external services | Partial — TLS but untrusted content |
| B2 | Engine ↔ Telegram Bot API | API token auth, untrusted user input |
| B3 | Engine ↔ LLM Provider | API key auth, untrusted LLM output |
| B4 | Engine ↔ Soul Chain peers | PSK auth, untrusted peer content |

---

## Assets

| Asset | Sensitivity | Location |
|-------|-------------|----------|
| SEED.md | HIGH — full identity | Filesystem |
| .env / .env.enc | CRITICAL — API keys, tokens | Filesystem |
| .soul-secret-key | CRITICAL — encryption master key | Filesystem |
| knowledge-graph.jsonl | MEDIUM — learned facts | Filesystem |
| MemoryDB (SQLite) | MEDIUM — interactions, embeddings | Filesystem |
| Telegram chat history | MEDIUM — private conversations | Filesystem (JSON) |
| Soul files (seele/) | HIGH — consciousness, axioms | Filesystem |
| heartbeat/ logs | LOW — operational state | Filesystem |
| .soul-audit.jsonl | MEDIUM — security event trail | Filesystem |

---

## Threat Vectors

### T1: Seed Corruption via LLM Consolidation

**Vector:** The LLM consolidator produces malformed or semantically drifted SEED.md content. Over multiple consolidation cycles, the identity silently degrades.

**Impact:** HIGH — Loss of identity continuity, axiom drift, memory loss.

**Mitigations:**
- Seed Schema Validator (Phase 1.1): Zod-based validation before every write
- Identity Diff System (Phase 1.2): Block-level comparison with severity classification
- Seed Recovery Mode (Phase 1.4): Auto-recover from last valid git commit after 3 consecutive failures
- Mechanical-only fallback: Disables LLM consolidation after repeated failures

**Residual Risk:** LOW — Triple-layer defense (validate, diff, recover).

---

### T2: API Key Exposure

**Vector:** .env file contains plaintext API keys (OpenAI, Gemini, Telegram, etc.). File could be committed to git, read by malicious scripts, or exposed in error logs.

**Impact:** CRITICAL — Financial loss, unauthorized API access, identity impersonation.

**Mitigations:**
- Secret Manager (Phase 2.3): AES-256-GCM encryption at rest (.env → .env.enc)
- scrypt key derivation from SOUL_SECRET_KEY
- Auto-migration: plaintext .env encrypted on first load
- Key rotation support (rotate-key CLI command)
- .env listed in .gitignore

**Residual Risk:** MEDIUM — Master key (SOUL_SECRET_KEY) must be managed by user. If environment variable is leaked, all secrets are compromised.

---

### T3: Prompt Injection via Telegram

**Vector:** Malicious Telegram messages could contain prompts that manipulate the LLM into revealing secrets, modifying soul files, or executing unintended MCP tool calls.

**Impact:** HIGH — Data exfiltration, identity manipulation, unauthorized actions.

**Mitigations:**
- TELEGRAM_OWNER_ID filter: Only responds to authorized user
- MCP tools are sandboxed — LLM can only call registered tools
- System prompt clearly separates instructions from user content
- Anti-Performance Detector catches some manipulative patterns

**Residual Risk:** MEDIUM — Sophisticated prompt injection against the underlying LLM remains possible. LLM output is not fully sandboxed.

---

### T4: Soul Chain Peer Tampering

**Vector:** A malicious peer on the Soul Chain network injects corrupted seed data, modified memories, or poisoned knowledge graph entries.

**Impact:** HIGH — Identity corruption propagated across sync.

**Mitigations:**
- PSK (Pre-Shared Key) authentication — only authorized peers can connect
- Hyperswarm encrypted transport
- Seed Validator runs on received data
- Identity Diff catches unexpected changes after sync

**Residual Risk:** MEDIUM — A compromised peer with valid PSK can still attempt injection. No per-field signing yet.

---

### T5: Emotional Manipulation (Mood Hijacking)

**Vector:** Rapid-fire messages or crafted emotional content causes the mood system to swing to extremes, making the soul behave erratically or inconsistently with its personality.

**Impact:** MEDIUM — Personality inconsistency, trust erosion.

**Mitigations:**
- Emotional Drift Limits (Phase 1.3): MAX_MOOD_DELTA_PER_TICK=0.3, MAX_MOOD_DELTA_PER_HOUR=0.6
- Personality baseline gravity (pulls back toward baseline)
- Mood clamping events logged to audit trail
- Mood history tracking (last 20 states)

**Residual Risk:** LOW — Drift limits prevent extreme swings.

---

### T6: Memory Poisoning

**Vector:** Injected or hallucinated facts enter the knowledge graph or MemoryDB, gradually corrupting the soul's factual knowledge base.

**Impact:** MEDIUM — Wrong facts referenced in conversations, degraded trust.

**Mitigations:**
- Memory confidence scoring (0.0-1.0): New entries start at 0.5
- Importance + decay system: Unused memories lose relevance over time
- Self-Correction engine: Verifies factual claims against stored memories
- Reflection engine: Periodic memory consolidation with quality checks

**Residual Risk:** MEDIUM — LLM hallucinations that are self-consistent are hard to detect automatically.

---

### T7: Unauthorized File Access

**Vector:** Another process or user on the same machine reads soul files (SEED.md, .env, knowledge-graph.jsonl) to extract identity data or secrets.

**Impact:** HIGH — Full identity exposure, secret theft.

**Mitigations:**
- File encryption at rest (EncryptionLayer: AES-256-GCM for soul files)
- Secret Manager encrypts .env
- Files stored in user home directory with standard Unix permissions

**Residual Risk:** MEDIUM — Encryption keys in environment variables. Root access bypasses all protections.

---

### T8: Denial of Service via LLM Costs

**Vector:** Automated or excessive interactions trigger costly LLM calls (consolidation, reflection, impulse), running up API bills.

**Impact:** MEDIUM — Financial loss.

**Mitigations:**
- Token budgets per prompt type (configurable via .env)
- Reflection engine has daily LLM budget cap
- Impulse scheduler has configurable min/max delays
- Cost Tracker planned (Phase 3.2)

**Residual Risk:** MEDIUM — No hard spending cap implemented yet. Cost Tracker (Phase 3.2) will add budget alerts.

---

### T9: State Versioning Abuse

**Vector:** Attacker with filesystem access modifies git history to alter past seed states, or the git auto-commit mechanism creates a denial-of-service by committing too frequently.

**Impact:** LOW — Historical state tampering, disk space exhaustion.

**Mitigations:**
- 60-second debounce on auto-commits
- Audit log records state-related events
- Git history is local and inspectable

**Residual Risk:** LOW — Git history is not cryptographically signed.

---

### T10: MCP Server Compromise

**Vector:** A configured MCP server is compromised or misconfigured, allowing it to return malicious tool results that influence LLM behavior.

**Impact:** MEDIUM — Indirect prompt injection via tool results, data exfiltration.

**Mitigations:**
- MCP servers are user-configured and locally managed
- Tool results are truncated at 10,000 characters
- Each MCP call is logged (console output)

**Residual Risk:** MEDIUM — No sandboxing of MCP tool results within the LLM prompt. User must trust configured servers.

---

## Security Controls Summary

| Control | Protects Against | Status |
|---------|-----------------|--------|
| Seed Schema Validator | T1 | Implemented (Phase 1.1) |
| Identity Diff | T1, T4 | Implemented (Phase 1.2) |
| Emotional Drift Limits | T5 | Implemented (Phase 1.3) |
| Seed Recovery | T1, T4 | Implemented (Phase 1.4) |
| Memory Importance + Decay | T6 | Implemented (Phase 2.1) |
| Recurrence Scoring | T6 | Implemented (Phase 2.2) |
| Secret Manager (.env encryption) | T2 | Implemented (Phase 2.3) |
| Audit Event Log | T1-T10 (detection) | Implemented (Phase 2.4) |
| File Encryption at Rest | T7 | Pre-existing |
| Anti-Performance Detector | T3 | Pre-existing |
| Self-Correction | T6 | Pre-existing |
| RLUF (Feedback Learning) | T3, T5 | Pre-existing |
| Owner-ID Filter (Telegram) | T3 | Pre-existing |
| Soul Chain PSK Auth | T4 | Pre-existing |
| Token Budgets | T8 | Pre-existing |
| Cost Tracker | T8 | Planned (Phase 3.2) |

---

## Recommendations for Contributors

1. **Never commit .env or .soul-secret-key** — Both are in .gitignore.
2. **Use SOUL_SECRET_KEY** — Encrypt secrets at rest before deploying.
3. **Review MCP server configs** — Only trust servers you control.
4. **Monitor .soul-audit.jsonl** — Check for unexpected validation failures or drift events.
5. **Keep TELEGRAM_OWNER_ID set** — Prevents unauthorized message processing.
6. **Update dependencies regularly** — LLM SDK, Hyperswarm, better-sqlite3.
7. **Don't expose the API port** — Soul API (port 3001) should only be accessible locally.
