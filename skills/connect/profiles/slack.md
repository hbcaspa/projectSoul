# Slack

## Overview
- **type:** messaging
- **mcp-package:** `@anthropic-ai/mcp-slack` (or community equivalent `mcp-slack`)
- **complexity:** moderate
- **estimated-time:** 10 minutes

## What This Does
Connects Claude to a Slack workspace via a custom Slack App, enabling reading and sending messages in channels, responding to threads, listing channels and users, and managing basic workspace interactions.

## Prerequisites
- A Slack account
- A Slack workspace where you have **admin permissions** (or permission to install apps)
- Access to [https://api.slack.com/apps](https://api.slack.com/apps) (Slack API portal)

## Credentials

### SLACK_BOT_TOKEN
- **display-name:** Slack Bot Token
- **required:** true
- **format:** Starts with `xoxb-` followed by numbers and alphanumeric segments separated by dashes
- **env-var:** SLACK_BOT_TOKEN
- **how-to-get:**
  1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
  2. Click **"Create New App"**
  3. Choose **"From scratch"**
  4. Enter an app name (e.g., "Seele Bot") and select your workspace, then click **"Create App"**
  5. In the left sidebar, click **"OAuth & Permissions"**
  6. Scroll down to **"Bot Token Scopes"** and add the following scopes:
     - `channels:history` -- View messages in public channels
     - `channels:read` -- View basic channel info
     - `chat:write` -- Send messages
     - `groups:history` -- View messages in private channels the bot is in
     - `groups:read` -- View basic private channel info
     - `im:history` -- View direct messages the bot is in
     - `im:read` -- View basic direct message info
     - `im:write` -- Start direct messages
     - `users:read` -- View basic user info
     - `reactions:read` -- View emoji reactions
     - `reactions:write` -- Add emoji reactions
  7. Scroll back up to **"OAuth Tokens for Your Workspace"** and click **"Install to Workspace"**
  8. Review the permissions and click **"Allow"**
  9. Copy the **"Bot User OAuth Token"** that appears -- it starts with `xoxb-`

### SLACK_SIGNING_SECRET
- **display-name:** Slack Signing Secret
- **required:** true
- **format:** A 32-character hexadecimal string (e.g., `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6`)
- **env-var:** SLACK_SIGNING_SECRET
- **how-to-get:**
  1. Go to [https://api.slack.com/apps](https://api.slack.com/apps) and select your app
  2. In the left sidebar, click **"Basic Information"**
  3. Scroll down to **"App Credentials"**
  4. Under **"Signing Secret"**, click **"Show"** and copy the value

## MCP Configuration
```json
{
  "server-name": "slack",
  "command": "npx",
  "args": ["-y", "@anthropic-ai/mcp-slack"],
  "env": {
    "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}",
    "SLACK_SIGNING_SECRET": "${SLACK_SIGNING_SECRET}"
  }
}
```

## Post-Setup
After installing the app to your workspace, the bot must be explicitly added to each channel where you want it to operate.

1. Open Slack and navigate to the channel where you want the bot
2. Type `/invite @Seele Bot` (use whatever name you gave your app) and press Enter
3. Alternatively: click the channel name at the top, go to **"Integrations"** (or **"Settings"** > **"Integrations"**), and click **"Add an App"**
4. The bot will now appear as a member of that channel and can read and send messages there
5. Repeat for each channel you want the bot to access

**For direct messages:**
- The bot can receive direct messages without any additional setup once it is installed in the workspace
- Users can find the bot in Slack under **"Apps"** in the left sidebar, or by searching for its name

**For private channels:**
- A member of the private channel must invite the bot using `/invite @Seele Bot`
- The bot cannot discover or join private channels on its own

## Test
- **test-command:** Ask Claude to list the channels in your Slack workspace, or send a test message to a channel where the bot has been invited
- **success-indicator:** Claude returns a list of channels (at minimum the ones the bot is a member of), or the test message appears in the specified Slack channel

## Troubleshooting
- **"invalid_auth"** or **"not_authed"**: The `SLACK_BOT_TOKEN` is incorrect or expired. Go to [api.slack.com/apps](https://api.slack.com/apps), select your app, navigate to **OAuth & Permissions**, and verify the token. If it looks wrong, reinstall the app to your workspace to generate a new token.
- **"missing_scope"**: The bot token does not have the required OAuth scope for the action you are trying to perform. Go to **OAuth & Permissions** in the app settings, add the missing scope under **Bot Token Scopes**, then scroll up and click **"Reinstall to Workspace"** to apply the new scopes. You will get a new token -- update your configuration.
- **"channel_not_found"**: The bot is not a member of the channel, or the channel ID is incorrect. Invite the bot to the channel with `/invite @BotName`. For private channels, a member must send the invite.
- **"not_in_channel"**: The bot has not been invited to this channel. Use `/invite @BotName` in the channel to add it.
- **"account_inactive"**: The Slack app has been disabled or the workspace has deactivated the bot. Go to your app settings and check that the app is still installed. Reinstall if necessary.
- **"ratelimited"**: Slack enforces rate limits on API calls. The response will include a `Retry-After` header indicating how many seconds to wait. Reduce the frequency of requests.
- **Bot cannot see messages in a channel it has joined**: Check that the `channels:history` scope (or `groups:history` for private channels) is included in the bot token scopes. After adding missing scopes, you must reinstall the app to the workspace.
- **Signing secret verification fails**: The `SLACK_SIGNING_SECRET` does not match. Go to **Basic Information** in the app settings, reveal the signing secret, and verify it matches the value in your configuration exactly. Be careful not to include extra whitespace when copying.

## Disconnect
1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Select your app
3. In the left sidebar, click **"Basic Information"**
4. Scroll to the bottom and click **"Delete App"** -- this permanently removes the app and invalidates all tokens
5. Remove or clear the `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` environment variables from your MCP configuration
6. Alternatively, to keep the app but disconnect temporarily: go to **"Manage Distribution"** or simply stop the MCP server. To uninstall without deleting, a workspace admin can go to Slack **Administration** > **Manage Apps** > find the app > **Remove**
