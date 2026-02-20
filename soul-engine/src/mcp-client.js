/**
 * MCP Client Manager — spawns and manages MCP servers,
 * collects their tools, and executes tool calls.
 *
 * Reads .mcp.json (same format as Claude Code) and connects
 * to each configured server via stdio JSON-RPC.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

export class MCPClientManager {
  constructor(soulPath) {
    this.soulPath = soulPath;
    this.clients = new Map();     // name → { client, transport }
    this.tools = new Map();       // toolName → { server, definition }
  }

  /**
   * Initialize all MCP servers from .mcp.json.
   * Returns the number of tools available.
   */
  async init() {
    const configPath = resolve(this.soulPath, '.mcp.json');
    if (!existsSync(configPath)) {
      console.log('  MCP:       no .mcp.json found');
      return 0;
    }

    let config;
    try {
      config = JSON.parse(await readFile(configPath, 'utf-8'));
    } catch (err) {
      console.error(`  MCP:       failed to parse .mcp.json: ${err.message}`);
      return 0;
    }

    const servers = config.mcpServers || {};
    const serverNames = Object.keys(servers);

    if (serverNames.length === 0) {
      console.log('  MCP:       no servers configured');
      return 0;
    }

    // Connect to each server
    for (const name of serverNames) {
      const serverConfig = servers[name];
      try {
        await this._connectServer(name, serverConfig);
      } catch (err) {
        console.error(`  MCP:       [${name}] failed to connect: ${err.message}`);
      }
    }

    console.log(`  MCP:       ${this.clients.size}/${serverNames.length} servers, ${this.tools.size} tools`);
    return this.tools.size;
  }

  /**
   * Connect to a single MCP server and collect its tools.
   */
  async _connectServer(name, config) {
    const { command, args = [], env = {} } = config;

    const transport = new StdioClientTransport({
      command,
      args,
      env: { ...process.env, ...env },
    });

    const client = new Client(
      { name: `soul-engine/${name}`, version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);

    // Collect tools
    const { tools = [] } = await client.listTools();
    for (const tool of tools) {
      this.tools.set(tool.name, {
        server: name,
        definition: tool,
      });
    }

    this.clients.set(name, { client, transport });
    console.log(`  MCP:       [${name}] connected — ${tools.length} tools`);
  }

  /**
   * Get all available tools formatted for LLM consumption.
   * Returns an array of { name, description, inputSchema }.
   */
  getTools() {
    return Array.from(this.tools.values()).map(({ definition }) => ({
      name: definition.name,
      description: definition.description || '',
      inputSchema: definition.inputSchema || { type: 'object', properties: {} },
    }));
  }

  /**
   * Get tool names grouped by server (for display/logging).
   */
  getToolsByServer() {
    const result = {};
    for (const [toolName, { server }] of this.tools) {
      if (!result[server]) result[server] = [];
      result[server].push(toolName);
    }
    return result;
  }

  /**
   * Execute a tool call. Returns the result text.
   *
   * @param {string} toolName  - The tool to call
   * @param {object} args      - The tool arguments
   * @returns {string} The tool result as text
   */
  async callTool(toolName, args = {}) {
    const entry = this.tools.get(toolName);
    if (!entry) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    const { server } = entry;
    const { client } = this.clients.get(server);

    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });

    // MCP returns content as array of { type, text } blocks
    if (result.content && Array.isArray(result.content)) {
      return result.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
    }

    return String(result.content || '');
  }

  /**
   * Check if any tools are available.
   */
  hasTools() {
    return this.tools.size > 0;
  }

  /**
   * Shut down all MCP servers cleanly.
   */
  async shutdown() {
    for (const [name, { client, transport }] of this.clients) {
      try {
        await client.close();
      } catch {
        // transport may already be closed
      }
      try {
        await transport.close();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.tools.clear();
  }
}
