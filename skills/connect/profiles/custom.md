# Custom MCP Server

## Overview
- **type:** custom
- **mcp-package:** (user-specified)
- **complexity:** varies
- **estimated-time:** varies

## What This Does
This is a template for connecting any MCP-compatible server that does not have a built-in profile. It guides you through the information needed to configure an arbitrary MCP server.

## Prerequisites
- The name or npm package of the MCP server you want to connect
- Any credentials or API keys required by that server
- Knowledge of the server's expected arguments and environment variables

## Finding MCP Servers

MCP servers are available from several sources:
- **npm:** Search [npmjs.com](https://www.npmjs.com/search?q=mcp-server) for `mcp-server` or `modelcontextprotocol`
- **GitHub:** Browse [github.com/modelcontextprotocol](https://github.com/modelcontextprotocol) for official servers
- **MCP Directory:** Check the community directory at [modelcontextprotocol.io](https://modelcontextprotocol.io) for a curated list
- **Custom/Private:** Any server that implements the MCP protocol can be connected, including locally built ones

## Information Needed

The connect wizard will ask you for the following:

| Field | Description | Example |
|-------|-------------|---------|
| **Server name** | A short identifier for this connection | `my-database` |
| **Command** | The command to launch the server | `npx`, `node`, `python` |
| **Args** | Arguments passed to the command | `["-y", "@some/mcp-server"]` |
| **Environment variables** | Key-value pairs the server needs | `{"API_KEY": "sk-..."}` |

## MCP Configuration Template
```json
{
  "server-name": "<your-server-name>",
  "command": "<command>",
  "args": ["<arg1>", "<arg2>"],
  "env": {
    "<ENV_VAR_1>": "<value1>",
    "<ENV_VAR_2>": "<value2>"
  }
}
```

### Common Patterns

**npm package (most common):**
```json
{
  "server-name": "example",
  "command": "npx",
  "args": ["-y", "@example/mcp-server"],
  "env": {
    "API_KEY": "${API_KEY}"
  }
}
```

**Local Node.js script:**
```json
{
  "server-name": "my-local-server",
  "command": "node",
  "args": ["/path/to/my-server/index.js"],
  "env": {}
}
```

**Python server:**
```json
{
  "server-name": "my-python-server",
  "command": "python",
  "args": ["-m", "my_mcp_server"],
  "env": {
    "CONFIG_PATH": "/path/to/config.json"
  }
}
```

**Docker container:**
```json
{
  "server-name": "my-docker-server",
  "command": "docker",
  "args": ["run", "--rm", "-i", "my-mcp-image:latest"],
  "env": {}
}
```

## Post-Setup
Depends on the server. Check the server's documentation for any additional setup steps (database migrations, initial configuration, etc.).

## Test
- **test-command:** Ask Claude to use one of the tools provided by the connected server
- **success-indicator:** The server responds without errors and Claude can use its capabilities

## Troubleshooting
- **"Server not found" or "command not found"**: The command specified in the configuration is not installed or not in your PATH. Verify the command exists (e.g. `which npx`, `which python`).
- **"Connection refused" or timeout**: The server failed to start. Check that all required environment variables are set and that the package name or script path is correct.
- **"Unknown tool" errors**: The server started but Claude is requesting a tool that does not exist. Verify you are using the correct version of the MCP server package.
- **npm package errors**: Try running the npx command manually in your terminal to see the full error output: `npx -y @example/mcp-server`

## Disconnect
1. Remove the server entry from your MCP configuration
2. Revoke any API keys or credentials you created for this server
3. Consult the server's documentation for any additional cleanup steps
