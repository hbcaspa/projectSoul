# GitHub

## Overview
- **type:** development
- **mcp-package:** @modelcontextprotocol/server-github
- **complexity:** simple
- **estimated-time:** 3 minutes

## What This Does
Connects Claude to your GitHub account, enabling direct interaction with repositories, issues, pull requests, code review, and repository management without leaving the conversation.

## Prerequisites
- A GitHub account
- At least one repository you want to interact with

## Credentials

### GITHUB_PERSONAL_ACCESS_TOKEN
- **display-name:** GitHub Personal Access Token
- **required:** true
- **format:** `github_pat_` followed by a long alphanumeric string (fine-grained) or `ghp_` followed by alphanumeric characters (classic)
- **env-var:** GITHUB_PERSONAL_ACCESS_TOKEN
- **how-to-get:**
  1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
  2. Click **"Generate new token"** > **"Fine-grained token"**
  3. Give the token a descriptive name (e.g. "Claude MCP Access")
  4. Set an expiration (recommended: 90 days)
  5. Under **Repository access**, select the repositories you want Claude to access (or "All repositories")
  6. Under **Permissions**, grant:
     - **Repository permissions:** Contents (Read and write), Issues (Read and write), Pull requests (Read and write), Metadata (Read-only)
  7. Click **"Generate token"**
  8. Copy the token immediately — it will not be shown again

## MCP Configuration
```json
{
  "server-name": "github",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_PERSONAL_ACCESS_TOKEN}"
  }
}
```

## Post-Setup
None — ready to use.

## Test
- **test-command:** Ask Claude to list your repositories or read an issue from a known repo
- **success-indicator:** Claude returns repository data or issue details without errors

## Troubleshooting
- **"Bad credentials"**: Your token is invalid or expired. Generate a new one at github.com/settings/tokens.
- **"Resource not accessible by personal access token"**: The token lacks the required permissions. Regenerate it with the correct repository and permission scopes listed above.
- **"Not Found" on a private repo**: Ensure the token has access to that specific repository. For fine-grained tokens, the repo must be explicitly selected.

## Disconnect
1. Remove the `github` entry from your MCP configuration
2. Revoke the token at [github.com/settings/tokens](https://github.com/settings/tokens) to ensure it can no longer be used
