# Web Search (Brave)

## Overview
- **type:** utility
- **mcp-package:** @modelcontextprotocol/server-brave-search
- **complexity:** simple
- **estimated-time:** 3 minutes

## What This Does
Enables Claude to perform web searches using the Brave Search API, returning current search results for any query. Useful for retrieving up-to-date information, researching topics, and fact-checking.

## Prerequisites
- A Brave Search API account (free tier available with 2,000 queries/month)

## Credentials

### BRAVE_API_KEY
- **display-name:** Brave Search API Key
- **required:** true
- **format:** Alphanumeric string (e.g. `BSA...`)
- **env-var:** BRAVE_API_KEY
- **how-to-get:**
  1. Go to [brave.com/search/api](https://brave.com/search/api/)
  2. Click **"Get Started"** and create an account (or sign in)
  3. Choose the **Free** plan (2,000 queries/month) or a paid plan
  4. After signup, go to your [API dashboard](https://api.search.brave.com/app/dashboard)
  5. Your API key is displayed on the dashboard — copy it

## MCP Configuration
```json
{
  "server-name": "brave-search",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-brave-search"],
  "env": {
    "BRAVE_API_KEY": "${BRAVE_API_KEY}"
  }
}
```

## Post-Setup
None — ready to use.

## Test
- **test-command:** Ask Claude to search for a current event or recent topic
- **success-indicator:** Claude returns relevant, current search results with titles, URLs, and snippets

## Troubleshooting
- **"Unauthorized" or 401 error**: Your API key is invalid or missing. Verify the key in your Brave API dashboard and ensure it is correctly set in the configuration.
- **"Rate limit exceeded" or 429 error**: You have exceeded your monthly query limit. Check your usage at the Brave API dashboard. Upgrade your plan or wait for the next billing cycle.
- **Empty results for a known topic**: Try rephrasing the query. Some queries may return limited results depending on Brave's index coverage.

## Disconnect
1. Remove the `brave-search` entry from your MCP configuration
2. Optionally, delete your API key or deactivate your account at [api.search.brave.com/app/dashboard](https://api.search.brave.com/app/dashboard)
