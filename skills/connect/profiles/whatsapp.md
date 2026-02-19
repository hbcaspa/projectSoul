# WhatsApp

## Overview
- **type:** messaging
- **mcp-package:** `whatsapp-mcp` (community package using WhatsApp Web multi-device protocol)
- **complexity:** moderate
- **estimated-time:** 5 minutes

## What This Does
Connects Claude to your WhatsApp account via the WhatsApp Web multi-device protocol, enabling reading and sending messages, viewing contacts, and interacting with individual and group chats.

## Prerequisites
- A WhatsApp account with an active phone number
- A smartphone with WhatsApp installed and running
- The phone must be connected to the internet during the QR code pairing step (it does not need to stay connected after pairing completes)

## Credentials

### WHATSAPP_AUTH
- **display-name:** WhatsApp QR Code Authentication
- **required:** true
- **format:** No token or key needed -- authentication happens via QR code scan
- **env-var:** _(none -- session is stored locally after first pairing)_
- **how-to-get:**
  1. When the MCP server starts for the first time, a **QR code will appear in your terminal**
  2. Open WhatsApp on your phone
  3. Go to **Settings** (or tap the three dots menu on Android)
  4. Tap **"Linked Devices"**
  5. Tap **"Link a Device"**
  6. Point your phone's camera at the QR code displayed in the terminal
  7. Wait for the pairing to complete -- the terminal will confirm a successful connection
  8. The session is now stored locally. You will not need to scan the QR code again unless you log out or the session expires

**Important:** The QR code expires after approximately 60 seconds. If it expires before you scan it, the server will automatically generate a new one. Just scan the new code.

## MCP Configuration
```json
{
  "server-name": "whatsapp",
  "command": "npx",
  "args": ["-y", "whatsapp-mcp", "start"],
  "env": {}
}
```

**Note:** No environment variables are needed. Authentication is handled interactively through the QR code flow on first launch. Session data is persisted locally so subsequent starts reconnect automatically.

## Post-Setup
After scanning the QR code and confirming the connection:

1. Verify the linked device appears in your WhatsApp **Linked Devices** list on your phone
2. The MCP server will maintain the session across restarts. If the session expires (typically after 14 days of inactivity), you will need to scan a new QR code
3. You can check linked devices anytime: WhatsApp > Settings > Linked Devices

## Test
- **test-command:** Ask Claude to list your recent WhatsApp conversations or send a test message to yourself (if you have a "Message Yourself" chat)
- **success-indicator:** Claude returns a list of your recent chats with contact names and last message previews, or the test message appears in your WhatsApp

## Troubleshooting
- **QR code expired before scanning**: This is normal -- QR codes are valid for about 60 seconds. Wait for a new QR code to appear in the terminal and scan it promptly. Make sure you have WhatsApp > Linked Devices > Link a Device ready before starting the server.
- **"Unable to connect" or QR code does not appear**: Ensure your internet connection is stable. The MCP server needs outbound access to WhatsApp's servers. Check that no firewall or proxy is blocking WebSocket connections.
- **"Multi-device not supported" or pairing failure**: Make sure your WhatsApp app is updated to the latest version. Multi-device support requires a recent version of WhatsApp. Update via your app store and try again.
- **Session expired / asked to scan QR again**: WhatsApp sessions expire after approximately 14 days of inactivity. This is normal behavior. Simply scan a new QR code to re-authenticate.
- **"Already linked to the maximum number of devices"**: WhatsApp allows up to 4 linked devices. Go to WhatsApp > Settings > Linked Devices on your phone and remove a device you no longer use, then try linking again.
- **Messages not sending or receiving**: Check that the linked device still appears in your WhatsApp settings. If it has been removed (manually or due to inactivity), you will need to re-pair by restarting the MCP server and scanning a new QR code.
- **Phone number changed**: If you change your WhatsApp phone number, all linked devices are disconnected. You will need to re-pair by scanning a new QR code.

## Disconnect
1. On your phone, open WhatsApp > **Settings** > **Linked Devices**
2. Tap on the linked device corresponding to the MCP server
3. Tap **"Log Out"**
4. The MCP server will lose its session and stop functioning
5. Optionally, delete the local session storage directory created by the MCP server (typically in `~/.whatsapp-mcp/` or the working directory)
