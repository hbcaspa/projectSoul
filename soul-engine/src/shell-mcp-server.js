#!/usr/bin/env node

/**
 * Shell MCP Server — minimal MCP server for command execution,
 * file management, and web access.
 *
 * Tools:
 *   - execute_command: Run a shell command and return output
 *   - read_file: Read a file from the filesystem
 *   - write_file: Write content to a file
 *   - list_processes: List running processes
 *   - web_search: Search the web via DuckDuckGo (no API key needed)
 *   - web_fetch: Fetch a URL and return readable text
 *
 * Designed to be spawned by the Soul Engine's MCP client.
 * No external dependencies beyond @modelcontextprotocol/sdk + zod.
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

const MAX_FETCH = 30000;  // max chars returned per web fetch

const server = new McpServer({
  name: 'soul-shell',
  version: '1.1.0',
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

// ── web_search ──────────────────────────────────────

server.tool(
  'web_search',
  'Search the web using DuckDuckGo. Returns search results with titles, URLs, and snippets. No API key needed. Use this for researching topics, checking current events, exploring interests.',
  {
    query: z.string().describe('The search query'),
    maxResults: z.number().optional().default(8).describe('Maximum number of results (default: 8)'),
  },
  async ({ query, maxResults = 8 }) => {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SoulEngine/1.1)',
        },
      });

      if (!res.ok) {
        return { content: [{ type: 'text', text: `Search failed: HTTP ${res.status}` }] };
      }

      const html = await res.text();

      // Parse DuckDuckGo HTML results
      const results = [];
      const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let match;

      while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
        const rawUrl = match[1];
        const title = stripHtml(match[2]).trim();
        const snippet = stripHtml(match[3]).trim();

        // DuckDuckGo wraps URLs in a redirect — extract the real URL
        let realUrl = rawUrl;
        const uddg = rawUrl.match(/uddg=([^&]+)/);
        if (uddg) {
          realUrl = decodeURIComponent(uddg[1]);
        }

        if (title && realUrl) {
          results.push({ title, url: realUrl, snippet });
        }
      }

      if (results.length === 0) {
        // Fallback: try simpler regex for different DDG HTML format
        const linkRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
        const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
        const links = [];
        const snippets = [];

        while ((match = linkRegex.exec(html)) !== null) links.push(match);
        while ((match = snippetRegex.exec(html)) !== null) snippets.push(match);

        for (let i = 0; i < Math.min(links.length, maxResults); i++) {
          results.push({
            title: stripHtml(links[i][1]).trim(),
            url: '',
            snippet: snippets[i] ? stripHtml(snippets[i][1]).trim() : '',
          });
        }
      }

      if (results.length === 0) {
        return { content: [{ type: 'text', text: `No results found for: ${query}` }] };
      }

      const formatted = results
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
        .join('\n\n');

      return { content: [{ type: 'text', text: `Search results for "${query}":\n\n${formatted}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Search error: ${err.message}` }] };
    }
  }
);

// ── web_fetch ───────────────────────────────────────

server.tool(
  'web_fetch',
  'Fetch a URL and return the readable text content. HTML is stripped to plain text. Use this to read articles, documentation, news pages after finding them via web_search.',
  {
    url: z.string().describe('The URL to fetch'),
    maxChars: z.number().optional().default(30000).describe('Maximum characters to return (default: 30000)'),
  },
  async ({ url, maxChars = MAX_FETCH }) => {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SoulEngine/1.1)',
          'Accept': 'text/html,application/xhtml+xml,text/plain',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        return { content: [{ type: 'text', text: `Fetch failed: HTTP ${res.status}` }] };
      }

      const contentType = res.headers.get('content-type') || '';
      const body = await res.text();

      let text;
      if (contentType.includes('text/html')) {
        text = htmlToReadableText(body);
      } else {
        text = body;
      }

      if (text.length > maxChars) {
        text = text.substring(0, maxChars) + `\n\n[... truncated at ${maxChars} chars]`;
      }

      return { content: [{ type: 'text', text: `Content from ${url}:\n\n${text}` }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Fetch error: ${err.message}` }] };
    }
  }
);

// ── Helpers ─────────────────────────────────────────

/** Strip HTML tags and decode entities */
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Convert HTML to readable plain text */
function htmlToReadableText(html) {
  // Remove script, style, nav, header, footer
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '');

  // Convert block elements to newlines
  text = text
    .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|pre|hr)[^>]*>/gi, '\n')
    .replace(/<\/?(ul|ol|table|thead|tbody)[^>]*>/gi, '\n');

  // Strip remaining tags
  text = stripHtml(text);

  // Clean up whitespace
  text = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

// ── Start server ────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
