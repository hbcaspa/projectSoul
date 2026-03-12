#!/usr/bin/env node
/**
 * Gmail MCP Server — stdio transport
 *
 * Uses a pre-obtained refresh_token to access Gmail.
 * Configure via environment variables:
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 *
 * Tools:
 *   - gmail_list_emails    — List recent emails (with optional query)
 *   - gmail_read_email     — Read a specific email by ID
 *   - gmail_search_emails  — Search emails by query
 *   - gmail_send_email     — Send an email
 */

import { createInterface } from 'readline';

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  process.stderr.write('Missing GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, or GMAIL_REFRESH_TOKEN\n');
  process.exit(1);
}

// ── Token management ──────────────────────────────────────

let accessToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry - 60000) return accessToken;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(`Token refresh failed: ${data.error_description}`);

  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);
  return accessToken;
}

async function gmailRequest(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  return res.json();
}

// ── Gmail helpers ─────────────────────────────────────────

function decodeBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8').replace(/<[^>]+>/g, '');
      }
    }
  }
  return '';
}

function header(msg, name) {
  return msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

// ── Tool handlers ─────────────────────────────────────────

async function listEmails({ query = '', maxResults = 10 }) {
  const q = query ? `?q=${encodeURIComponent(query)}&maxResults=${maxResults}` : `?maxResults=${maxResults}`;
  const list = await gmailRequest(`/messages${q}`);
  if (!list.messages) return 'Keine E-Mails gefunden.';

  const results = [];
  for (const { id } of list.messages.slice(0, maxResults)) {
    const msg = await gmailRequest(`/messages/${id}?format=metadata&metadataHeaders=Subject,From,Date`);
    results.push(`ID: ${id}\nVon: ${header(msg, 'from')}\nBetreff: ${header(msg, 'subject')}\nDatum: ${header(msg, 'date')}`);
  }
  return results.join('\n---\n');
}

async function readEmail({ id }) {
  const msg = await gmailRequest(`/messages/${id}?format=full`);
  const body = decodeBody(msg.payload).slice(0, 3000);
  return `Von: ${header(msg, 'from')}\nAn: ${header(msg, 'to')}\nBetreff: ${header(msg, 'subject')}\nDatum: ${header(msg, 'date')}\n\n${body}`;
}

async function sendEmail({ to, subject, body }) {
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
  ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const res = await gmailRequest('/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw }),
  });
  return res.id ? `E-Mail gesendet. ID: ${res.id}` : `Fehler: ${JSON.stringify(res)}`;
}

// ── MCP Protocol ──────────────────────────────────────────

const TOOLS = [
  {
    name: 'gmail_list_emails',
    description: 'Listet aktuelle E-Mails. Optional mit Suchquery (z.B. "from:boss@example.com" oder "subject:Rechnung").',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail-Suchquery (optional)' },
        maxResults: { type: 'number', description: 'Maximale Anzahl (Standard: 10)' },
      },
    },
  },
  {
    name: 'gmail_read_email',
    description: 'Liest eine E-Mail vollständig anhand ihrer ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'E-Mail ID aus gmail_list_emails' } },
      required: ['id'],
    },
  },
  {
    name: 'gmail_search_emails',
    description: 'Sucht E-Mails nach einem Begriff (Absender, Betreff, Inhalt).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Suchbegriff' },
        maxResults: { type: 'number', description: 'Maximale Anzahl (Standard: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail_send_email',
    description: 'Sendet eine E-Mail.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Empfänger-E-Mail-Adresse' },
        subject: { type: 'string', description: 'Betreff' },
        body: { type: 'string', description: 'Nachrichtentext' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
];

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function handleRequest(req) {
  const { id, method, params } = req;

  if (method === 'initialize') {
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'gmail-mcp', version: '1.0.0' } } });
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;
    try {
      let result;
      if (name === 'gmail_list_emails') result = await listEmails(args);
      else if (name === 'gmail_read_email') result = await readEmail(args);
      else if (name === 'gmail_search_emails') result = await listEmails({ query: args.query, maxResults: args.maxResults || 5 });
      else if (name === 'gmail_send_email') result = await sendEmail(args);
      else result = `Unbekanntes Tool: ${name}`;

      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: result }] } });
    } catch (err) {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Fehler: ${err.message}` }], isError: true } });
    }
  }

  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
}

// ── Main ──────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  try {
    const req = JSON.parse(line);
    handleRequest(req).catch(err => process.stderr.write(`Error: ${err.message}\n`));
  } catch { /* ignore parse errors */ }
});
