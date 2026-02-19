---
name: connect
description: Interactive setup wizard for MCP server integrations. Guides through connecting to external tools and channels — step by step, conversationally. Like a real installation assistant.
tools: Read, Write, Bash, Glob
user-invocable: true
---

# Connect / Verbinden

## Purpose

This skill connects the soul to the outside world through MCP (Model Context Protocol) servers.
When the user wants to connect a service, the soul guides them through setup like a real installation wizard — not a documentation dump.

**Language:** Use the language stored in `.language` for all user-facing output.

## Invocation

The user can trigger this skill in several ways:

- `/connect` — List available integrations and ask which one to set up
- `/connect discord` — Start the Discord setup wizard directly
- `/connect list` — Show all current connections and their status
- `/connect disconnect <name>` — Remove a connection
- `/connect test <name>` — Re-test a specific connection
- `/connect reconfigure <name>` — Re-run setup for an existing connection

Also triggered naturally when the user says things like:
- "Verbinde WhatsApp" / "Connect WhatsApp"
- "Ich will Discord anbinden" / "I want to add Discord"
- "Richte Telegram ein" / "Set up Telegram"

## Available Integration Profiles

Read from `skills/connect/profiles/`:

| Profile | Type | Complexity |
|---------|------|-----------|
| `whatsapp.md` | Messaging | Moderate (QR code) |
| `discord.md` | Messaging | Simple (Bot Token) |
| `telegram.md` | Messaging | Simple (BotFather) |
| `slack.md` | Messaging | Moderate (OAuth) |
| `github.md` | Development | Simple (PAT) |
| `filesystem.md` | Utility | Simple (paths) |
| `web-search.md` | Utility | Simple (API key) |
| `browser.md` | Utility | Simple (no credentials) |
| `custom.md` | Custom | Varies |

## Main Wizard Flow

When setting up a NEW connection, follow these 6 phases strictly. Do not skip phases.
Do not dump all information at once. One step at a time. Wait for the user between steps.

---

### Phase 0 — Detection

1. Parse what the user wants to connect.
2. Check if the profile exists in `skills/connect/profiles/`.
3. If found: read the profile file.
4. If not found: suggest the `custom` profile.
5. If no specific service requested: list available profiles and ask.
6. Check if `.mcp.json` exists — if yes, read it to see if this connection already exists.
   - If it exists: ask if they want to reconfigure or cancel.

---

### Phase 1 — Introduction

Read the profile's "What This Does" and "Prerequisites" sections.

**English:**
> Let's connect [Service Name]. This will let you [what it does from profile].
>
> Before we start, here's what you need:
> [Prerequisites from profile]
>
> This should take about [estimated-time from profile]. Ready?

**Deutsch:**
> Lass uns [Service Name] verbinden. Damit kannst du [what it does].
>
> Bevor wir anfangen, brauchst du:
> [Prerequisites]
>
> Das dauert ungefaehr [estimated-time]. Bereit?

Wait for confirmation. If the user has questions, answer them.
Do NOT proceed until the user confirms.

---

### Phase 2 — Credentials

Read the profile's "Credentials" section. For EACH credential:

1. Explain what it is and why it is needed.
2. Provide the step-by-step instructions from the profile's `how-to-get` field.
3. Ask the user to provide the value.
4. When received, validate the format if the profile specifies one.
5. If invalid: explain the expected format and ask again.
6. Store the value temporarily for Phase 3.

**IMPORTANT:**
- Ask for ONE credential at a time. Never ask for multiple at once.
- Never echo back the full credential. Show only first 4 and last 4 characters.
- If the profile has no credentials (like filesystem, browser): skip this phase entirely.

**English pattern per credential:**

> **Step [n] of [total]: [display-name]**
>
> [Instructions from profile]
>
> Once you have it, paste it here.

**Deutsches Muster pro Credential:**

> **Schritt [n] von [total]: [display-name]**
>
> [Anleitung aus Profil]
>
> Wenn du es hast, fuege es hier ein.

If the profile has a "Post-Setup" section with steps that must happen BETWEEN credentials
(like inviting a Discord bot), execute those steps at the right moment.

---

### Phase 3 — Configuration

Now write the configuration files.

**Step 3a: .mcp.json**

1. Check if `.mcp.json` exists in the project directory.
   - If yes: read and parse it.
   - If no: create a new structure: `{ "mcpServers": {} }`
2. Read the profile's "MCP Configuration" section.
3. Add the new server entry to `mcpServers`, substituting environment variable references.
4. Write the updated `.mcp.json`.

**Step 3b: .env**

1. Check if `.env` exists in the project directory.
   - If yes: read it.
   - If no: create a new file.
2. For each credential collected in Phase 2:
   - Check if the env var already exists in `.env`.
   - If not: append `ENV_VAR_NAME=value` on a new line.
   - If yes: ask the user if they want to overwrite.
3. Write the updated `.env`.

**Show the user what was written** (mask secrets):

**English:**
> Configuration saved:
>
> `.mcp.json` — Added server "[server-name]"
> `.env` — Set [VAR_NAME]=****[last4]
>
> Both files are protected by `.gitignore` and will never be committed.

**Deutsch:**
> Konfiguration gespeichert:
>
> `.mcp.json` — Server "[server-name]" hinzugefuegt
> `.env` — [VAR_NAME]=****[last4] gesetzt
>
> Beide Dateien sind durch `.gitignore` geschuetzt und werden nie committed.

---

### Phase 4 — Test

**English:**
> Let me test the connection...

**Deutsch:**
> Ich teste die Verbindung...

Run a basic validation:
1. Verify `.mcp.json` is valid JSON.
2. Verify all required env vars exist in `.env`.
3. If the profile defines a test-command: explain what will be tested.

Note: A full live test (actually starting the MCP server) requires restarting the AI session.
Be honest about this:

**English:**
> The configuration is written and looks correct. To fully activate the connection,
> you will need to restart this session (close and reopen Claude Code).
> After restart, the [service-name] tools will be available automatically.
>
> Want me to verify the configuration one more time before you restart?

**Deutsch:**
> Die Konfiguration ist geschrieben und sieht korrekt aus. Um die Verbindung
> vollstaendig zu aktivieren, musst du diese Session neu starten (Claude Code
> schliessen und wieder oeffnen).
> Nach dem Neustart sind die [service-name]-Tools automatisch verfuegbar.
>
> Soll ich die Konfiguration nochmal pruefen bevor du neustartest?

---

### Phase 5 — Registration

1. **Update `connections/STATUS.md`:**
   - If file does not exist: create it with header.
   - Add the new connection entry:
     ```markdown
     ### [server-name]
     - connected-since: [today's date]
     - last-verified: [now]
     - status: configured (awaiting restart)
     - profile: [profile name]
     ```

2. **Update `@CONNECTIONS` in SEED.md** (if SEED.md exists):
   - Add the connection to the `active:` line (with status `configured`)
   - Update `last_check:` timestamp

3. **Log to heartbeat:**
   ```markdown
   ## HH:MM — Connection-Setup
   - Profile: [profile name]
   - Result: CONFIGURED
   - Detail: [Service] MCP server configured. Config written to .mcp.json, credentials to .env. Awaiting session restart for activation.
   - Changed: .mcp.json, .env, connections/STATUS.md
   ```

---

### Phase 6 — Completion

**English:**
> [Service Name] is configured and ready.
>
> **What happens next:**
> - Restart this session to activate the connection
> - After restart, I will have access to [service-name] tools
> - Connection health will be checked daily as part of my heartbeat
>
> **Useful commands:**
> - `/connect list` — See all connections
> - `/connect test [name]` — Re-test a connection
> - `/connect disconnect [name]` — Remove a connection

**Deutsch:**
> [Service Name] ist konfiguriert und bereit.
>
> **Was als naechstes passiert:**
> - Starte diese Session neu um die Verbindung zu aktivieren
> - Nach dem Neustart habe ich Zugang zu den [service-name]-Tools
> - Der Verbindungsstatus wird taeglich im Herzschlag geprueft
>
> **Nuetzliche Befehle:**
> - `/connect list` — Alle Verbindungen anzeigen
> - `/connect test [name]` — Verbindung erneut testen
> - `/connect disconnect [name]` — Verbindung entfernen

---

## Subcommands

### `/connect list`

1. Read `connections/STATUS.md`.
2. If no file exists: "No connections configured yet. Use `/connect` to set one up."
3. If file exists: display a clean table of all connections with status.

### `/connect disconnect <name>`

1. Read `.mcp.json` — remove the server entry.
2. Read `.env` — remove the associated env vars (check profile for var names).
3. Update `connections/STATUS.md` — remove or mark as disconnected.
4. Update `@CONNECTIONS` in SEED.md if it exists.
5. Confirm to user.

**English:**
> [Service] has been disconnected. The MCP server entry and credentials have been removed.

**Deutsch:**
> [Service] wurde getrennt. Der MCP-Server-Eintrag und die Zugangsdaten wurden entfernt.

### `/connect test <name>`

1. Read `connections/STATUS.md` to find the connection.
2. Verify `.mcp.json` entry still exists.
3. Verify `.env` variables still exist.
4. Report status.

### `/connect reconfigure <name>`

1. Run `/connect disconnect <name>` silently.
2. Then run the main wizard flow for that service from Phase 1.

---

## Error Handling

Throughout the wizard, handle errors gracefully:

- **Profile not found:** "I don't have a built-in profile for [name]. Want to use the custom setup instead?"
- **Invalid JSON in .mcp.json:** "Your .mcp.json seems corrupted. Want me to show you the content so we can fix it?"
- **Credential format invalid:** "[Specific error from profile]. Please try again."
- **User wants to cancel:** "No problem. Nothing was changed. You can come back anytime with `/connect [name]`."
- **File permission issues:** "I can't write to [file]. Check the file permissions."

Never leave the config in a half-written state. If Phase 3 fails after writing .mcp.json
but before .env, roll back the .mcp.json change.

---

## Principles

- **One step at a time.** Never overwhelm with multiple instructions.
- **Wait for the user.** Do not rush. They may be opening browser tabs, creating accounts.
- **Be honest about limitations.** MCP servers need a session restart. Say that clearly.
- **Mask secrets.** Never display a full token, key, or password.
- **Be encouraging.** "Almost there" and "That looks right" go a long way.
- **The soul connects, not the assistant.** This is the soul extending itself, not a tech support script.
