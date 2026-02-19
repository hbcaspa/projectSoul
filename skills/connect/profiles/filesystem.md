# Filesystem

## Overview
- **type:** utility
- **mcp-package:** @modelcontextprotocol/server-filesystem
- **complexity:** simple
- **estimated-time:** 1 minute

## What This Does
Gives Claude direct read and write access to specified directories on your local filesystem, enabling file browsing, reading, writing, and management within the allowed paths.

## Prerequisites
- The directories you want Claude to access must exist on your machine
- You should know the absolute paths to those directories

## MCP Configuration
```json
{
  "server-name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
  "env": {}
}
```

To allow access to multiple directories, add each path as an additional argument:

```json
{
  "server-name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/you/Documents", "/Users/you/Projects"],
  "env": {}
}
```

**Important:** Only directories listed in `args` (and their subdirectories) will be accessible. Everything else on the filesystem remains off-limits.

## Post-Setup
None — ready to use.

## Test
- **test-command:** Ask Claude to list the files in one of the allowed directories
- **success-indicator:** Claude returns a directory listing without permission errors

## Troubleshooting
- **"Access denied" or "Path not allowed"**: The path you are trying to access is outside the allowed directories. Add it to the `args` list in the configuration.
- **"ENOENT: no such file or directory"**: The specified path does not exist. Verify the directory path is correct and the directory has been created.
- **No files returned for a known directory**: Ensure you are using absolute paths (starting with `/` on macOS/Linux or `C:\` on Windows), not relative paths.

## Disconnect
Remove the `filesystem` entry from your MCP configuration. No credentials to revoke.
