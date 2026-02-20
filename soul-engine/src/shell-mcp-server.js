#!/usr/bin/env node

/**
 * Shell MCP Server — minimal MCP server for command execution.
 *
 * Provides two tools:
 *   - execute_command: Run a shell command and return output
 *   - read_file: Read a file from the filesystem
 *
 * Designed to be spawned by the Soul Engine's MCP client.
 * No external dependencies beyond @modelcontextprotocol/sdk.
 *
 * Usage:
 *   node shell-mcp-server.js
 *
 * In .mcp.json:
 *   {
 *     "mcpServers": {
 *       "shell": {
 *         "command": "node",
 *         "args": ["soul-engine/src/shell-mcp-server.js"]
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { exec } from 'child_process';
import { readFile, writeFile, stat } from 'fs/promises';
import { z } from 'zod';

const MAX_OUTPUT = 50000; // max chars returned per command

const server = new McpServer({
  name: 'soul-shell',
  version: '1.0.0',
});

// ── execute_command ─────────────────────────────────

server.tool(
  'execute_command',
  'Execute a shell command on the server. Returns stdout and stderr. Use for system administration, Docker management, file operations, process management, etc.',
  {
    command: z.string().describe('The shell command to execute'),
    timeout: z.number().optional().default(30000).describe('Timeout in milliseconds (default: 30000)'),
    workdir: z.string().optional().describe('Working directory for the command'),
  },
  async ({ command, timeout = 30000, workdir }) => {
    return new Promise((resolve) => {
      const options = {
        timeout,
        maxBuffer: 1024 * 1024, // 1MB
        shell: '/bin/bash',
      };
      if (workdir) options.cwd = workdir;

      exec(command, options, (error, stdout, stderr) => {
        let output = '';

        if (stdout) output += stdout;
        if (stderr) output += (output ? '\n--- stderr ---\n' : '') + stderr;
        if (error && !stdout && !stderr) {
          output = `Error: ${error.message}`;
        }

        // Truncate if needed
        if (output.length > MAX_OUTPUT) {
          output = output.substring(0, MAX_OUTPUT) + `\n\n[... truncated at ${MAX_OUTPUT} chars]`;
        }

        resolve({
          content: [{ type: 'text', text: output || '(no output)' }],
        });
      });
    });
  }
);

// ── read_file ───────────────────────────────────────

server.tool(
  'read_file',
  'Read a file from the filesystem. Returns the file content as text.',
  {
    path: z.string().describe('Absolute path to the file'),
    maxLines: z.number().optional().default(500).describe('Maximum number of lines to return (default: 500)'),
  },
  async ({ path, maxLines = 500 }) => {
    try {
      const content = await readFile(path, 'utf-8');
      const lines = content.split('\n');
      let result = lines.slice(0, maxLines).join('\n');

      if (lines.length > maxLines) {
        result += `\n\n[... ${lines.length - maxLines} more lines truncated]`;
      }

      return { content: [{ type: 'text', text: result }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
    }
  }
);

// ── write_file ──────────────────────────────────────

server.tool(
  'write_file',
  'Write content to a file on the filesystem. Creates the file if it does not exist, overwrites if it does.',
  {
    path: z.string().describe('Absolute path to the file'),
    content: z.string().describe('Content to write'),
  },
  async ({ path, content }) => {
    try {
      await writeFile(path, content, 'utf-8');
      return { content: [{ type: 'text', text: `Written ${content.length} bytes to ${path}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
    }
  }
);

// ── list_processes ───────────────────────────────────

server.tool(
  'list_processes',
  'List running processes. Optionally filter by name.',
  {
    filter: z.string().optional().describe('Filter processes by name (grep pattern)'),
  },
  async ({ filter }) => {
    const cmd = filter
      ? `ps aux | head -1; ps aux | grep -i '${filter.replace(/'/g, "\\'")}' | grep -v grep`
      : 'ps aux --sort=-%mem | head -20';

    return new Promise((resolve) => {
      exec(cmd, { timeout: 10000, shell: '/bin/bash' }, (error, stdout, stderr) => {
        resolve({
          content: [{ type: 'text', text: stdout || stderr || '(no output)' }],
        });
      });
    });
  }
);

// ── Start server ────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
