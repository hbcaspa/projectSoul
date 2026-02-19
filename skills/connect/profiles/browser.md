# Browser (Puppeteer)

## Overview
- **type:** utility
- **mcp-package:** @modelcontextprotocol/server-puppeteer
- **complexity:** simple
- **estimated-time:** 2 minutes

## What This Does
Gives Claude the ability to open web pages, interact with them (click, type, scroll), take screenshots, and extract content using a headless browser powered by Puppeteer.

## Prerequisites
- Chrome or Chromium installed on your machine
- Node.js 18 or later (for npx)

## MCP Configuration
```json
{
  "server-name": "puppeteer",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
  "env": {}
}
```

To launch with a visible browser window instead of headless mode, set the launch option:

```json
{
  "server-name": "puppeteer",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
  "env": {
    "PUPPETEER_HEADLESS": "false"
  }
}
```

## Post-Setup
None — ready to use. On first run, Puppeteer may download a compatible Chromium binary if one is not found.

## Test
- **test-command:** Ask Claude to navigate to a website and describe what it sees, or take a screenshot of a page
- **success-indicator:** Claude reports page content or returns a screenshot without errors

## Troubleshooting
- **"Could not find Chrome"**: Puppeteer cannot locate a Chrome/Chromium installation. Install Chrome or set the `PUPPETEER_EXECUTABLE_PATH` environment variable to point to your Chrome binary (e.g. `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on macOS).
- **"Navigation timeout"**: The page took too long to load. This can happen with slow sites or heavy pages. Try again or ask Claude to navigate to a simpler page.
- **"Target closed" or "Session closed"**: The browser crashed or was closed unexpectedly. Restart the MCP server by reloading the configuration.

## Disconnect
Remove the `puppeteer` entry from your MCP configuration. No credentials to revoke. Puppeteer's downloaded Chromium binary can be removed from `~/.cache/puppeteer/` if you want to reclaim disk space.
