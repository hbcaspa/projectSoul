# Discord

## Overview
- **type:** messaging
- **mcp-package:** `@anthropic-ai/mcp-discord` (or community equivalent `mcp-discord`)
- **complexity:** simple
- **estimated-time:** 5 minutes

## What This Does
Connects Claude to a Discord server via a bot, enabling reading and sending messages in channels, managing threads, and interacting with server members.

## Prerequisites
- A Discord account
- A Discord server where you have **Administrator** or **Manage Server** permission
- Access to the [Discord Developer Portal](https://discord.com/developers/applications)

## Credentials

### DISCORD_BOT_TOKEN
- **display-name:** Discord Bot Token
- **required:** true
- **format:** A long alphanumeric string (e.g., `MTI3NjM4...a7dG9rZW4`)
- **env-var:** DISCORD_BOT_TOKEN
- **how-to-get:**
  1. Go to [https://discord.com/developers/applications](https://discord.com/developers/applications)
  2. Click **"New Application"** in the top right
  3. Give your application a name (e.g., "Seele Bot") and click **"Create"**
  4. In the left sidebar, click **"Bot"**
  5. Click **"Reset Token"** (or **"Add Bot"** if this is a new application)
  6. Confirm the reset and copy the token immediately -- it will only be shown once
  7. Under **Privileged Gateway Intents**, enable:
     - **Presence Intent**
     - **Server Members Intent**
     - **Message Content Intent**
  8. Click **"Save Changes"**

### DISCORD_GUILD_ID
- **display-name:** Discord Server (Guild) ID
- **required:** true
- **format:** A numeric ID string (e.g., `1234567890123456789`)
- **env-var:** DISCORD_GUILD_ID
- **how-to-get:**
  1. Open Discord (desktop app or browser)
  2. Go to **User Settings** (gear icon near your username)
  3. Navigate to **Advanced** and enable **Developer Mode**
  4. Close settings, then right-click on your server name in the left sidebar
  5. Click **"Copy Server ID"**
  6. Paste it somewhere safe -- this is your Guild ID

## MCP Configuration
```json
{
  "server-name": "discord",
  "command": "npx",
  "args": ["-y", "@anthropic-ai/mcp-discord"],
  "env": {
    "DISCORD_BOT_TOKEN": "${DISCORD_BOT_TOKEN}",
    "DISCORD_GUILD_ID": "${DISCORD_GUILD_ID}"
  }
}
```

## Post-Setup
The bot must be invited to your server before it can interact with channels.

1. Go back to [https://discord.com/developers/applications](https://discord.com/developers/applications)
2. Select your application
3. In the left sidebar, click **"OAuth2"**
4. Under **OAuth2 URL Generator**, select the scope **"bot"**
5. Under **Bot Permissions**, select at minimum:
   - Read Messages/View Channels
   - Send Messages
   - Read Message History
   - Embed Links
   - Add Reactions
6. Copy the generated URL at the bottom of the page
7. Open the URL in your browser
8. Select your server from the dropdown and click **"Authorize"**
9. Complete the CAPTCHA if prompted
10. The bot should now appear in your server's member list (it will show as offline until the MCP server is started)

## Test
- **test-command:** Ask Claude to list channels in your Discord server or send a message to a specific channel
- **success-indicator:** Claude returns a list of channel names and IDs, or the message appears in the specified Discord channel

## Troubleshooting
- **"401: Unauthorized"** or **"Invalid token"**: Your bot token is incorrect or has been regenerated. Go to the Developer Portal, reset the token, and update the `DISCORD_BOT_TOKEN` value.
- **"Missing Access"** or **"403: Forbidden"**: The bot lacks permissions. Re-invite it using the OAuth2 URL with the correct permissions, or check the channel-level permission overrides in your server settings.
- **"Unknown Guild"** or **"Guild not found"**: The `DISCORD_GUILD_ID` is wrong, or the bot has not been invited to that server. Verify the ID by right-clicking the server with Developer Mode enabled, and ensure the bot is a member of the server.
- **"Privileged intent not enabled"**: You forgot to enable one or more Gateway Intents in the Developer Portal under the Bot section. Enable all three privileged intents and save.
- **Bot appears offline**: The MCP server is not running. Start or restart the MCP server. The bot will show as online once the server connects to the Discord gateway.
- **"Rate limited"**: Discord enforces rate limits. Wait a few seconds and try again. Avoid sending many messages in rapid succession.

## Disconnect
1. Remove the bot from your Discord server: Go to **Server Settings > Members**, find the bot, and kick it
2. Optionally, delete the application entirely at [https://discord.com/developers/applications](https://discord.com/developers/applications) by selecting the application, going to **General Information**, and clicking **"Delete Application"**
3. Remove or clear the `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID` environment variables from your MCP configuration
