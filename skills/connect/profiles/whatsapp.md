# WhatsApp

## Overview
- **type:** messaging
- **mcp-package:** `whatsapp-mcp` (maintained fork with auto-install and updated WhatsApp library)
- **complexity:** low (dependencies are installed automatically)
- **estimated-time:** 3 minutes

## What This Does
Connects Claude to your WhatsApp account via the WhatsApp Web multi-device protocol, enabling reading and sending messages, viewing contacts, and interacting with individual and group chats.

## Prerequisites
- A WhatsApp account with an active phone number
- A smartphone with WhatsApp installed and running
- Node.js / npm installed
- The phone must be connected to the internet during the QR code pairing step (it does not need to stay connected after pairing completes)

**Note:** Go and UV (Python package manager) are installed automatically if missing. No manual setup needed.

## Credentials

### WHATSAPP_AUTH
- **display-name:** WhatsApp QR Code Authentication
- **required:** true
- **format:** No token or key needed -- authentication happens via QR code scan
- **env-var:** _(none -- session is stored locally after first pairing)_
- **how-to-get:**
  1. When the bridge starts for the first time, a **QR code will appear** -- both in the terminal and as a PNG image opened in your default viewer
  2. Open WhatsApp on your phone
  3. Go to **Settings** (or tap the three dots menu on Android)
  4. Tap **"Linked Devices"**
  5. Tap **"Link a Device"**
  6. Scan the QR code (from terminal or from the PNG image)
  7. Wait for the pairing to complete -- the terminal will confirm a successful connection
  8. The session is now stored locally. You will not need to scan the QR code again unless you log out or the session expires

**Important:** The QR code expires after approximately 60 seconds. If it expires before you scan it, the server will automatically generate a new one. The QR code is also saved as `store/qr.png` and opened in your default image viewer, which works in environments where the terminal QR code is hard to scan (e.g., Claude Code).

## MCP Configuration
```json
{
  "server-name": "whatsapp",
  "command": "npx",
  "args": ["-y", "whatsapp-mcp", "start"],
  "env": {}
}
```

**Note:** This configuration starts the Go bridge (which connects to WhatsApp and stores messages). The MCP server (Python) runs separately. For a full setup that configures both automatically, use:

```bash
npx whatsapp-mcp setup --target claude-code
```

This installs all dependencies, pairs WhatsApp, and writes the `.mcp.json` configuration.

## Post-Setup
After scanning the QR code and confirming the connection:

1. Verify the linked device appears in your WhatsApp **Linked Devices** list on your phone
2. The bridge will maintain the session across restarts. If the session expires (typically after 14 days of inactivity), you will need to scan a new QR code
3. You can check linked devices anytime: WhatsApp > Settings > Linked Devices

## Test
- **test-command:** Ask Claude to list your recent WhatsApp conversations or send a test message to yourself (if you have a "Message Yourself" chat)
- **success-indicator:** Claude returns a list of your recent chats with contact names and last message previews, or the test message appears in your WhatsApp

## Troubleshooting
- **QR code not visible in terminal**: The QR code is also saved as a PNG image and opened automatically in your default viewer. Look for the image viewer window. If using Claude Code, the QR code appears in the tool output but may be distorted -- use the PNG image instead.
- **QR code expired before scanning**: This is normal -- QR codes are valid for about 60 seconds. Wait for a new QR code to appear and scan it promptly. Have WhatsApp > Linked Devices > Link a Device ready before starting.
- **"Client outdated" error**: You may be using the original (unmaintained) `whatsapp-mcp` package. This fork includes an updated WhatsApp library.
- **"Unable to connect" or QR code does not appear**: Ensure your internet connection is stable. The bridge needs outbound access to WhatsApp's servers.
- **Session expired / asked to scan QR again**: WhatsApp sessions expire after approximately 14 days of inactivity. This is normal. Simply scan a new QR code.
- **"Already linked to the maximum number of devices"**: WhatsApp allows up to 4 linked devices. Remove a device you no longer use, then try again.
- **Messages not sending or receiving**: Check that the linked device still appears in your WhatsApp settings. If removed, re-pair by restarting the bridge.
- **Phone number changed**: All linked devices are disconnected when you change your phone number. Re-pair by scanning a new QR code.

## Disconnect
1. On your phone, open WhatsApp > **Settings** > **Linked Devices**
2. Tap on the linked device corresponding to the MCP bridge
3. Tap **"Log Out"**
4. The bridge will lose its session and stop functioning
5. Optionally, delete `whatsapp-bridge/store/whatsapp.db` to remove the local session
