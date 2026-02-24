/**
 * MCP Server Profile Definitions
 *
 * Structured data for the MCP Manager panel.
 * Source: skills/connect/profiles/*.md
 */

export interface MCPCredential {
  id: string;
  displayName: string;
  envVar: string;
  format: string;
  howToGet: string[];
  isPassword: boolean;
}

export interface MCPProfile {
  id: string;
  name: string;
  icon: string; // SVG path
  color: string;
  category: "messaging" | "development" | "utility";
  complexity: "simple" | "moderate";
  estimatedTime: string;
  description: string;
  prerequisites: string[];
  credentials: MCPCredential[];
  mcpConfig: {
    serverName: string;
    command: string;
    args: string[];
    env: Record<string, string>;
  };
  postSetup?: string;
}

// SVG icon paths
const ICONS = {
  whatsapp: "M12 2C6.48 2 2 6.48 2 12c0 1.77.47 3.44 1.29 4.88L2 22l5.23-1.26A9.94 9.94 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm.03 17.75c-1.65 0-3.18-.5-4.46-1.35l-.32-.19-3.31.8.83-3.22-.21-.34A7.7 7.7 0 014.25 12c0-4.28 3.47-7.75 7.75-7.75S19.75 7.72 19.75 12s-3.47 7.75-7.72 7.75zm4.24-5.8c-.23-.12-1.37-.68-1.58-.76-.21-.07-.37-.11-.52.12-.16.23-.6.76-.74.91-.13.16-.27.18-.5.06-.23-.12-.97-.36-1.85-1.14-.68-.61-1.14-1.36-1.28-1.59-.13-.23-.01-.36.1-.47.1-.1.23-.27.35-.4.12-.13.16-.23.23-.38.08-.16.04-.29-.02-.41-.06-.12-.52-1.27-.72-1.74-.19-.46-.38-.39-.52-.4h-.45c-.16 0-.4.06-.62.29-.21.23-.81.79-.81 1.94s.83 2.25.95 2.4c.12.16 1.63 2.49 3.95 3.49.55.24.98.38 1.32.49.55.18 1.06.15 1.46.09.44-.07 1.37-.56 1.56-1.1.2-.54.2-1 .14-1.1-.06-.1-.22-.16-.46-.27z",
  discord: "M20.32 4.37a19.8 19.8 0 00-4.93-1.51.07.07 0 00-.08.04c-.21.38-.45.87-.61 1.26a18.27 18.27 0 00-5.4 0 12.64 12.64 0 00-.62-1.26.08.08 0 00-.08-.04 19.74 19.74 0 00-4.93 1.51.07.07 0 00-.03.03C1.11 8.39.34 12.27.74 16.1a.08.08 0 00.03.06 19.9 19.9 0 005.99 3.03.08.08 0 00.08-.03c.46-.63.87-1.3 1.22-2a.08.08 0 00-.04-.11 13.1 13.1 0 01-1.87-.9.08.08 0 01-.01-.13c.13-.09.25-.19.37-.29a.08.08 0 01.08-.01c3.93 1.79 8.18 1.79 12.07 0a.08.08 0 01.08.01c.12.1.25.2.37.29a.08.08 0 01-.01.13c-.6.35-1.22.65-1.87.9a.08.08 0 00-.04.1c.36.7.77 1.37 1.22 2a.08.08 0 00.08.03 19.83 19.83 0 006-3.03.08.08 0 00.03-.05c.47-4.87-.79-9.1-3.35-12.84a.06.06 0 00-.03-.03zM8.02 13.62c-1.11 0-2.03-1.02-2.03-2.28s.9-2.28 2.03-2.28c1.14 0 2.04 1.03 2.03 2.28 0 1.26-.9 2.28-2.03 2.28zm7.5 0c-1.11 0-2.03-1.02-2.03-2.28s.9-2.28 2.03-2.28c1.14 0 2.04 1.03 2.03 2.28 0 1.26-.89 2.28-2.03 2.28z",
  telegram: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z",
  slack: "M5.04 15.04a2.52 2.52 0 01-2.52 2.52A2.52 2.52 0 010 15.04a2.52 2.52 0 012.52-2.52h2.52v2.52zm1.27 0a2.52 2.52 0 012.52-2.52 2.52 2.52 0 012.52 2.52v6.31A2.52 2.52 0 018.83 24a2.52 2.52 0 01-2.52-2.52v-6.44zM8.83 5.04a2.52 2.52 0 01-2.52-2.52A2.52 2.52 0 018.83 0a2.52 2.52 0 012.52 2.52v2.52H8.83zm0 1.27a2.52 2.52 0 012.52 2.52 2.52 2.52 0 01-2.52 2.52H2.52A2.52 2.52 0 010 8.83a2.52 2.52 0 012.52-2.52h6.31zM18.96 8.83a2.52 2.52 0 012.52-2.52A2.52 2.52 0 0124 8.83a2.52 2.52 0 01-2.52 2.52h-2.52V8.83zm-1.27 0a2.52 2.52 0 01-2.52 2.52 2.52 2.52 0 01-2.52-2.52V2.52A2.52 2.52 0 0115.17 0a2.52 2.52 0 012.52 2.52v6.31zM15.17 18.96a2.52 2.52 0 012.52 2.52A2.52 2.52 0 0115.17 24a2.52 2.52 0 01-2.52-2.52v-2.52h2.52zm0-1.27a2.52 2.52 0 01-2.52-2.52 2.52 2.52 0 012.52-2.52h6.31A2.52 2.52 0 0124 15.17a2.52 2.52 0 01-2.52 2.52h-6.31z",
  github: "M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z",
  filesystem: "M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z",
  search: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  browser: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z",
  custom: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1115.6 12 3.61 3.61 0 0112 15.6z",
};

export const MCP_PROFILES: MCPProfile[] = [
  // ── Messaging ────────────────────────────────────────────
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: ICONS.whatsapp,
    color: "#25D366",
    category: "messaging",
    complexity: "moderate",
    estimatedTime: "3 min",
    description: "Read and send WhatsApp messages, view contacts and group chats.",
    prerequisites: ["WhatsApp account with active phone number", "Smartphone with WhatsApp installed"],
    credentials: [],
    mcpConfig: {
      serverName: "whatsapp",
      command: "npx",
      args: ["-y", "whatsapp-mcp", "start"],
      env: {},
    },
    postSetup: "A QR code will appear on first run. Scan it with WhatsApp > Linked Devices > Link a Device.",
  },
  {
    id: "discord",
    name: "Discord",
    icon: ICONS.discord,
    color: "#5865F2",
    category: "messaging",
    complexity: "simple",
    estimatedTime: "5 min",
    description: "Read and send messages in Discord channels, manage threads and interactions.",
    prerequisites: ["Discord account", "Server with Admin permission", "Discord Developer Portal access"],
    credentials: [
      {
        id: "DISCORD_BOT_TOKEN",
        displayName: "Bot Token",
        envVar: "DISCORD_BOT_TOKEN",
        format: "Long alphanumeric string",
        howToGet: [
          "Go to discord.com/developers/applications",
          "Create New Application > name it > Create",
          "Sidebar: Bot > Reset Token > copy it",
          "Enable all Privileged Gateway Intents > Save",
        ],
        isPassword: true,
      },
      {
        id: "DISCORD_GUILD_ID",
        displayName: "Server (Guild) ID",
        envVar: "DISCORD_GUILD_ID",
        format: "Numeric ID (e.g. 1234567890123456789)",
        howToGet: [
          "Discord > User Settings > Advanced > enable Developer Mode",
          "Right-click your server name > Copy Server ID",
        ],
        isPassword: false,
      },
    ],
    mcpConfig: {
      serverName: "discord",
      command: "npx",
      args: ["-y", "@anthropic-ai/mcp-discord"],
      env: {
        DISCORD_BOT_TOKEN: "${DISCORD_BOT_TOKEN}",
        DISCORD_GUILD_ID: "${DISCORD_GUILD_ID}",
      },
    },
    postSetup: "Invite the bot to your server via OAuth2 URL (Bot scope + permissions).",
  },
  {
    id: "telegram",
    name: "Telegram",
    icon: ICONS.telegram,
    color: "#0088cc",
    category: "messaging",
    complexity: "simple",
    estimatedTime: "3 min",
    description: "Send and receive Telegram messages via a bot.",
    prerequisites: ["Telegram account", "Telegram app installed"],
    credentials: [
      {
        id: "TELEGRAM_BOT_TOKEN",
        displayName: "Bot Token",
        envVar: "TELEGRAM_BOT_TOKEN",
        format: "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ",
        howToGet: [
          "Open Telegram, search for @BotFather",
          "Send /newbot and follow the prompts",
          "Copy the bot token BotFather gives you",
        ],
        isPassword: true,
      },
    ],
    mcpConfig: {
      serverName: "telegram",
      command: "npx",
      args: ["-y", "mcp-telegram"],
      env: {
        TELEGRAM_BOT_TOKEN: "${TELEGRAM_BOT_TOKEN}",
      },
    },
    postSetup: "Message your bot on Telegram first — bots can't initiate conversations.",
  },
  {
    id: "slack",
    name: "Slack",
    icon: ICONS.slack,
    color: "#4A154B",
    category: "messaging",
    complexity: "moderate",
    estimatedTime: "10 min",
    description: "Read and send messages in Slack channels and threads.",
    prerequisites: ["Slack account", "Workspace with admin permissions", "api.slack.com access"],
    credentials: [
      {
        id: "SLACK_BOT_TOKEN",
        displayName: "Bot Token",
        envVar: "SLACK_BOT_TOKEN",
        format: "Starts with xoxb-",
        howToGet: [
          "Go to api.slack.com/apps > Create New App > From scratch",
          "OAuth & Permissions > add Bot Token Scopes (channels:history, chat:write, etc.)",
          "Install to Workspace > copy the Bot User OAuth Token",
        ],
        isPassword: true,
      },
      {
        id: "SLACK_SIGNING_SECRET",
        displayName: "Signing Secret",
        envVar: "SLACK_SIGNING_SECRET",
        format: "32-character hex string",
        howToGet: [
          "api.slack.com/apps > select your app",
          "Basic Information > App Credentials > Signing Secret > Show",
        ],
        isPassword: true,
      },
    ],
    mcpConfig: {
      serverName: "slack",
      command: "npx",
      args: ["-y", "@anthropic-ai/mcp-slack"],
      env: {
        SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}",
        SLACK_SIGNING_SECRET: "${SLACK_SIGNING_SECRET}",
      },
    },
    postSetup: "Invite the bot to channels with /invite @BotName.",
  },

  // ── Development ──────────────────────────────────────────
  {
    id: "github",
    name: "GitHub",
    icon: ICONS.github,
    color: "#f0f6fc",
    category: "development",
    complexity: "simple",
    estimatedTime: "3 min",
    description: "Interact with repos, issues, PRs and code review.",
    prerequisites: ["GitHub account", "At least one repository"],
    credentials: [
      {
        id: "GITHUB_PERSONAL_ACCESS_TOKEN",
        displayName: "Personal Access Token",
        envVar: "GITHUB_PERSONAL_ACCESS_TOKEN",
        format: "github_pat_... or ghp_...",
        howToGet: [
          "Go to github.com/settings/tokens",
          "Generate new token > Fine-grained token",
          "Set permissions: Contents, Issues, Pull Requests (Read+Write), Metadata (Read)",
          "Generate and copy the token",
        ],
        isPassword: true,
      },
    ],
    mcpConfig: {
      serverName: "github",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}",
      },
    },
  },

  // ── Utility ──────────────────────────────────────────────
  {
    id: "filesystem",
    name: "Filesystem",
    icon: ICONS.filesystem,
    color: "#FFA726",
    category: "utility",
    complexity: "simple",
    estimatedTime: "1 min",
    description: "Read and write files in specified directories.",
    prerequisites: ["Know the absolute paths to directories you want to share"],
    credentials: [],
    mcpConfig: {
      serverName: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
      env: {},
    },
    postSetup: "Add directory paths as extra args in the config. Only listed paths are accessible.",
  },
  {
    id: "brave-search",
    name: "Web Search",
    icon: ICONS.search,
    color: "#FB542B",
    category: "utility",
    complexity: "simple",
    estimatedTime: "3 min",
    description: "Search the web with Brave Search API (2,000 free queries/month).",
    prerequisites: ["Brave Search API account (free tier available)"],
    credentials: [
      {
        id: "BRAVE_API_KEY",
        displayName: "Brave API Key",
        envVar: "BRAVE_API_KEY",
        format: "Alphanumeric string (BSA...)",
        howToGet: [
          "Go to brave.com/search/api",
          "Create account > choose Free plan",
          "Copy API key from dashboard",
        ],
        isPassword: true,
      },
    ],
    mcpConfig: {
      serverName: "brave-search",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: {
        BRAVE_API_KEY: "${BRAVE_API_KEY}",
      },
    },
  },
  {
    id: "puppeteer",
    name: "Browser",
    icon: ICONS.browser,
    color: "#4FC3F7",
    category: "utility",
    complexity: "simple",
    estimatedTime: "2 min",
    description: "Open web pages, interact, take screenshots via headless browser.",
    prerequisites: ["Chrome or Chromium installed"],
    credentials: [],
    mcpConfig: {
      serverName: "puppeteer",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-puppeteer"],
      env: {},
    },
  },
  {
    id: "custom",
    name: "Custom",
    icon: ICONS.custom,
    color: "var(--bewusstsein)",
    category: "utility",
    complexity: "simple",
    estimatedTime: "varies",
    description: "Connect any MCP-compatible server manually.",
    prerequisites: ["Package name or command for the MCP server"],
    credentials: [],
    mcpConfig: {
      serverName: "",
      command: "npx",
      args: ["-y", ""],
      env: {},
    },
  },
];

export function getProfileById(id: string): MCPProfile | undefined {
  return MCP_PROFILES.find((p) => p.id === id);
}

export function getProfilesByCategory(category: MCPProfile["category"]): MCPProfile[] {
  return MCP_PROFILES.filter((p) => p.category === category);
}
