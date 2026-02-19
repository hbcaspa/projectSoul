# Telegram

## Overview
- **type:** messaging
- **mcp-package:** `mcp-telegram` (community MCP server for Telegram Bot API)
- **complexity:** simple
- **estimated-time:** 3 minutes

## What This Does
Connects Claude to Telegram via a bot, enabling reading and sending messages, receiving updates, and interacting with users and groups that message the bot.

## Prerequisites
- A Telegram account
- The Telegram app installed on your phone or desktop (needed to interact with @BotFather)

## Credentials

### TELEGRAM_BOT_TOKEN
- **display-name:** Telegram Bot Token
- **required:** true
- **format:** A string in the format `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ` (numeric bot ID, colon, alphanumeric secret)
- **env-var:** TELEGRAM_BOT_TOKEN
- **how-to-get:**
  1. Open Telegram and search for **@BotFather** (the official Telegram bot for creating bots -- it has a blue verified checkmark)
  2. Start a conversation with @BotFather by tapping **"Start"**
  3. Send the command `/newbot`
  4. @BotFather will ask you for a **display name** for your bot (e.g., "Seele Bot") -- this can be anything
  5. Next, it will ask for a **username** -- this must end in `bot` (e.g., `seele_soul_bot`) and must be unique across all of Telegram
  6. Once the username is accepted, @BotFather will respond with your **bot token** -- it looks like `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`
  7. Copy this token immediately and store it securely

**Optional but recommended settings via @BotFather:**
- Send `/setprivacy` and select your bot, then choose **"Disable"** -- this allows the bot to see all messages in group chats (not just commands)
- Send `/setdescription` to add a description visible to users who discover your bot

## MCP Configuration
```json
{
  "server-name": "telegram",
  "command": "npx",
  "args": ["-y", "mcp-telegram"],
  "env": {
    "TELEGRAM_BOT_TOKEN": "${TELEGRAM_BOT_TOKEN}"
  }
}
```

## Post-Setup
Telegram bots cannot initiate conversations. A user must message the bot first before the bot can respond.

1. Open Telegram and search for your bot by its username (e.g., `@seele_soul_bot`)
2. Tap **"Start"** to begin a conversation with the bot
3. Send any message (e.g., "Hello") -- this registers the chat with the bot
4. The bot can now send messages to this chat

**For group chats:**
1. Open the group where you want the bot
2. Tap the group name to open group info
3. Tap **"Add Members"** (or **"Add"**)
4. Search for your bot by username and add it
5. If you want the bot to read all messages (not just `/commands`), make sure you disabled privacy mode via @BotFather (see optional settings above)

## Test
- **test-command:** Ask Claude to send a message to your Telegram chat, or ask it to list recent messages
- **success-indicator:** The message appears in your Telegram conversation with the bot, or Claude returns recent messages from the chat

## Troubleshooting
- **"401: Unauthorized"** or **"Invalid token"**: The bot token is incorrect. Go to @BotFather, send `/mybots`, select your bot, then tap **"API Token"** to view or regenerate it. Update the `TELEGRAM_BOT_TOKEN` value.
- **"Bot not started"** or **"Chat not found"**: The user has not sent a message to the bot yet. Telegram requires that a user initiates contact with the bot first. Open Telegram, find your bot, and tap "Start" then send a message.
- **"Forbidden: bot was blocked by the user"**: The user has blocked the bot. The user must unblock the bot in Telegram (open the chat with the bot > tap the bot name > "Unblock") before the bot can send messages again.
- **"Bad Request: chat not found"** for group messages: The bot is not a member of the group. Add the bot to the group first. If it is a member but still fails, check that the chat ID is correct (group IDs are negative numbers in Telegram).
- **Bot does not receive messages in groups**: Privacy mode is enabled by default. Send `/setprivacy` to @BotFather, select your bot, and choose "Disable" to let the bot see all group messages.
- **"Conflict: terminated by other getUpdates request"**: Another instance of the MCP server (or another program) is polling the same bot. Only one process can use `getUpdates` at a time. Stop any other instances before starting the MCP server.
- **Token regenerated and old one stopped working**: When you regenerate a token via @BotFather, the old token is immediately invalidated. Update your configuration with the new token.

## Disconnect
1. Open Telegram and start a conversation with **@BotFather**
2. Send `/deletebot`
3. Select the bot you want to remove
4. Confirm the deletion -- this permanently removes the bot and invalidates the token
5. Remove or clear the `TELEGRAM_BOT_TOKEN` environment variable from your MCP configuration
6. Alternatively, if you want to keep the bot but just disconnect: simply stop the MCP server and remove the token from your configuration. The bot will remain on Telegram but will not respond to messages.
