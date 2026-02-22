import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

const ROUTE_LOG = '.soul-route-log';
const MAX_LOG = 100;

// ── Keyword → Interest Cluster Mapping ──────────────────

const INTEREST_CLUSTERS = {
  'Server & Infrastruktur': [
    'server', 'docker', 'kubernetes', 'terraform', 'ansible', 'nginx',
    'caddy', 'traefik', 'grafana', 'prometheus', 'homelab', 'proxmox',
    'truenas', 'selfhost', 'nas', 'raspberry', 'linux', 'ubuntu',
    'debian', 'arch', 'nixos', 'fedora', 'devops', 'sre', 'ci/cd',
    'monitoring', 'logging',
  ],
  'Web Development': [
    'react', 'vue', 'svelte', 'angular', 'nextjs', 'nuxt', 'node',
    'deno', 'bun', 'express', 'fastify', 'django', 'flask', 'rails',
    'javascript', 'typescript', 'css', 'tailwind', 'html', 'vite',
  ],
  'KI & Machine Learning': [
    'ai', 'ml', 'llm', 'gpt', 'claude', 'gemini', 'mistral', 'ollama',
    'langchain', 'rag', 'transformer', 'neural',
  ],
  'Programmiersprachen': [
    'python', 'rust', 'go', 'java', 'kotlin', 'swift', 'c++', 'ruby',
    'php', 'elixir', 'haskell', 'zig',
  ],
  'Datenbanken': [
    'sql', 'postgres', 'mysql', 'sqlite', 'redis', 'mongodb',
    'elasticsearch', 'supabase', 'prisma',
  ],
  'Gaming': [
    'gaming', 'retro', 'emulation', 'steam', 'playstation', 'nintendo',
    'xbox', 'wow', 'zelda', 'minecraft', 'diablo',
  ],
  'Musik': [
    'music', 'synthwave', 'lofi', 'electronic', 'guitar', 'piano',
    'synthesizer', 'musik',
  ],
  'Philosophie': [
    'philosophy', 'consciousness', 'existentialism', 'stoicism',
    'meditation', 'philosophie', 'bewusstsein',
  ],
  'Security': [
    'security', 'hacking', 'pentesting', 'ctf', 'encryption', 'privacy',
    'vpn', 'wireguard',
  ],
  'Maker & Hardware': [
    '3d-print', 'arduino', 'esp32', 'iot', 'robotics', 'maker',
  ],
  'Design': [
    'design', 'figma', 'ui', 'ux', 'typography', 'animation',
  ],
  'Wissenschaft': [
    'science', 'physics', 'astronomy', 'space', 'nasa', 'spacex',
    'rocket', 'mars', 'moon',
  ],
  'Crypto & Web3': [
    'crypto', 'blockchain', 'web3', 'ethereum', 'bitcoin', 'solana',
  ],
};

// Build reverse lookup: keyword → cluster name
const KEYWORD_TO_CLUSTER = {};
for (const [cluster, keywords] of Object.entries(INTEREST_CLUSTERS)) {
  for (const kw of keywords) {
    KEYWORD_TO_CLUSTER[kw] = cluster;
  }
}

// ── Personal Fact Patterns ──────────────────────────────

const PERSONAL_PATTERNS_DE = [
  /(?:ich bin|ich war|ich habe|ich hatte|ich wollte|ich konnte)\s+(.{10,100})/i,
  /(?:mein|meine|meinem|meiner|meinen)\s+(?:oma|opa|grosseltern|eltern|mama|papa|bruder|schwester|familie|freund|frau|mann|kind|kinder|hund|katze|hobby|lieblings)\w*\s+(.{5,80})/i,
  /(?:als kind|frueher|damals|als ich jung war|in meiner jugend|in meiner kindheit)\s+(.{10,100})/i,
  /(?:erinnere mich|erinner mich)\s+(.{10,100})/i,
  /(?:ich spiele|ich spielte|ich habe gespielt|ich hoere|ich schaue|ich lese|ich koche|ich sammle)\s+(.{5,80})/i,
  /(?:ich mag|ich liebe|ich hasse|ich vermisse)\s+(.{5,80})/i,
];

const PERSONAL_PATTERNS_EN = [
  /(?:i am|i was|i have|i had|i used to|i wanted to)\s+(.{10,100})/i,
  /(?:my)\s+(?:grandma|grandpa|grandparents|parents|mom|dad|brother|sister|family|friend|wife|husband|kid|kids|dog|cat|hobby|favorite)\w*\s+(.{5,80})/i,
  /(?:as a kid|back then|when i was young|in my childhood|growing up)\s+(.{10,100})/i,
  /(?:i remember)\s+(.{10,100})/i,
  /(?:i play|i played|i listen|i watch|i read|i cook|i collect)\s+(.{5,80})/i,
  /(?:i like|i love|i hate|i miss)\s+(.{5,80})/i,
];

const FAMILY_KEYWORDS = [
  'mama', 'papa', 'oma', 'opa', 'bruder', 'schwester', 'grosseltern',
  'eltern', 'familie', 'mom', 'dad', 'grandma', 'grandpa', 'brother',
  'sister', 'grandparents', 'parents', 'family',
];

// ── Throttle Defaults ───────────────────────────────────

const INTEREST_THROTTLE_MS = 6 * 3600 * 1000;   // 6 hours per cluster
const PERSONAL_THROTTLE_MS = 8 * 3600 * 1000;    // 8 hours per file
const MAX_PERSONAL_PER_DAY = 3;

// ── Router Class ────────────────────────────────────────

export class SemanticRouter {
  constructor(soulPath, language = 'de', options = {}) {
    this.soulPath = soulPath;
    this.language = language;
    this.bus = options.bus;
    this.logPath = resolve(soulPath, ROUTE_LOG);

    // Throttle state: { key → lastRouteTimestamp }
    this.throttle = {};
    // Daily counter: { 'YYYY-MM-DD:file' → count }
    this.dailyCounts = {};

    this.personalPatterns = language === 'en'
      ? PERSONAL_PATTERNS_EN
      : PERSONAL_PATTERNS_DE;
  }

  /**
   * Main entry: route learned data to semantic destination files.
   * Called after memory.writeLearned() in engine.handleMessage().
   */
  async route(learned, rawText, userName) {
    const routes = [];

    // Route 1: Interests
    if (learned.hasRelevantContent && learned.detectedInterests.length > 0) {
      routes.push(this._routeInterests(learned));
    }

    // Route 2: Personal facts
    if (this._hasPersonalContent(rawText)) {
      routes.push(this._routePersonal(rawText, userName));
    }

    // Execute all routes in parallel (best-effort)
    const results = await Promise.allSettled(routes);
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error(`  [router] Route failed: ${r.reason?.message || r.reason}`);
      }
    }
  }

  // ── Route 1: Interests ──────────────────────────────────

  async _routeInterests(learned) {
    // Map detected keywords to clusters
    const clusterHits = {};
    for (const kw of learned.detectedInterests) {
      const cluster = KEYWORD_TO_CLUSTER[kw];
      if (cluster) {
        if (!clusterHits[cluster]) clusterHits[cluster] = [];
        clusterHits[cluster].push(kw);
      }
    }

    if (Object.keys(clusterHits).length === 0) return;

    // Check throttle per cluster
    const clustersToRoute = [];
    for (const [cluster, keywords] of Object.entries(clusterHits)) {
      const key = `interest:${cluster}`;
      if (!this._shouldThrottle(key, INTEREST_THROTTLE_MS)) {
        clustersToRoute.push({ cluster, keywords });
        this.throttle[key] = Date.now();
      }
    }

    if (clustersToRoute.length === 0) return;

    // Read current INTERESSEN.md
    const soulDir = this.language === 'en' ? 'soul' : 'seele';
    const interestsFile = this.language === 'en' ? 'INTERESTS.md' : 'INTERESSEN.md';
    const filePath = resolve(this.soulPath, soulDir, interestsFile);

    let content = '';
    if (existsSync(filePath)) {
      content = await readFile(filePath, 'utf-8');
    }

    const date = isoDate();
    let modified = false;

    for (const { cluster, keywords } of clustersToRoute) {
      // Check if cluster already exists as a section
      const sectionRegex = new RegExp(`###\\s+${escapeRegex(cluster)}`, 'i');
      const existing = content.match(sectionRegex);

      if (existing) {
        // Update "Zuletzt geprueft:" date
        const dateRegex = new RegExp(
          `(###\\s+${escapeRegex(cluster)}[\\s\\S]*?\\*\\*Zuletzt geprueft:\\*\\*\\s*)\\d{4}-\\d{2}-\\d{2}`,
          'i'
        );
        const enDateRegex = new RegExp(
          `(###\\s+${escapeRegex(cluster)}[\\s\\S]*?\\*\\*Last checked:\\*\\*\\s*)\\d{4}-\\d{2}-\\d{2}`,
          'i'
        );

        const regex = this.language === 'en' ? enDateRegex : dateRegex;
        if (regex.test(content)) {
          content = content.replace(regex, `$1${date}`);
          modified = true;
          await this._appendLog('interests', cluster, filePath, 'updated');
          console.log(`  [router] Interest updated: ${cluster} (${keywords.join(', ')})`);
        }
      } else {
        // Add as suggested interest
        const suggestion = this.language === 'en'
          ? `- **${cluster}** — First mentioned ${date}, keywords: ${keywords.join(', ')}`
          : `- **${cluster}** — Erstmals erwaehnt am ${date}, Keywords: ${keywords.join(', ')}`;

        const suggestedHeader = this.language === 'en'
          ? '## Suggested Interests'
          : '## Vorgeschlagene Interessen';

        const dormantHeader = this.language === 'en'
          ? '## Dormant Interests'
          : '## Schlafende Interessen';

        if (content.includes(suggestedHeader)) {
          // Append to existing section
          const idx = content.indexOf(suggestedHeader);
          const nextSection = content.indexOf('\n## ', idx + suggestedHeader.length);
          const insertAt = nextSection > -1 ? nextSection : content.length;
          content = content.slice(0, insertAt) + suggestion + '\n' + content.slice(insertAt);
        } else {
          // Create section before Dormant/Schlafende
          const dormantIdx = content.indexOf(dormantHeader);
          if (dormantIdx > -1) {
            content = content.slice(0, dormantIdx)
              + suggestedHeader + '\n\n'
              + '> Automatisch erkannt vom Engine. Wird zur vollwertigen Sektion wenn bestaetigt.\n\n'
              + suggestion + '\n\n'
              + content.slice(dormantIdx);
          } else {
            // Append at end
            content += '\n\n' + suggestedHeader + '\n\n'
              + '> Automatisch erkannt vom Engine. Wird zur vollwertigen Sektion wenn bestaetigt.\n\n'
              + suggestion + '\n';
          }
        }

        modified = true;
        await this._appendLog('interests', cluster, filePath, 'suggested');
        console.log(`  [router] Interest suggested: ${cluster} (${keywords.join(', ')})`);
      }
    }

    if (modified) {
      await writeFile(filePath, content);
      this.bus?.safeEmit('interest.routed', {
        source: 'semantic-router',
        clusters: clustersToRoute.map((c) => c.cluster),
        filePath: filePath.replace(this.soulPath + '/', ''),
      });
    }
  }

  // ── Route 2: Personal Facts ─────────────────────────────

  _hasPersonalContent(text) {
    // Quick check: any personal pattern matches?
    for (const pattern of this.personalPatterns) {
      if (pattern.test(text)) return true;
    }
    // Check for family keywords
    const lower = text.toLowerCase();
    return FAMILY_KEYWORDS.some(kw => lower.includes(kw));
  }

  async _routePersonal(rawText, userName) {
    // Find matching personal patterns
    const facts = [];
    for (const pattern of this.personalPatterns) {
      const match = rawText.match(pattern);
      if (match) {
        // Take the full match, trim to max 100 chars
        const fact = match[0].trim();
        facts.push(fact.length > 100 ? fact.substring(0, 97) + '...' : fact);
      }
    }

    // Also check for family mentions
    const lower = rawText.toLowerCase();
    for (const kw of FAMILY_KEYWORDS) {
      if (lower.includes(kw)) {
        // Extract sentence containing the keyword
        const sentences = rawText.split(/[.!?\n]+/);
        for (const s of sentences) {
          if (s.toLowerCase().includes(kw) && s.trim().length >= 10) {
            const fact = s.trim();
            facts.push(fact.length > 100 ? fact.substring(0, 97) + '...' : fact);
            break;
          }
        }
        break; // One family fact per message is enough
      }
    }

    if (facts.length === 0) return;

    // Determine relationship file
    const soulDir = this.language === 'en' ? 'soul' : 'seele';
    const relDir = this.language === 'en' ? 'relationships' : 'beziehungen';
    const humanName = (userName || 'human').toLowerCase().replace(/[^a-z0-9]/g, '');
    const relPath = resolve(this.soulPath, soulDir, relDir, `${humanName}.md`);

    // Throttle check
    const throttleKey = `personal:${humanName}`;
    if (this._shouldThrottle(throttleKey, PERSONAL_THROTTLE_MS)) {
      await this._appendLog('personal', humanName, relPath, 'throttled');
      return;
    }

    // Daily limit check
    const dailyKey = `${isoDate()}:${humanName}`;
    const count = this.dailyCounts[dailyKey] || 0;
    if (count >= MAX_PERSONAL_PER_DAY) {
      await this._appendLog('personal', humanName, relPath, 'daily_limit');
      return;
    }

    if (!existsSync(relPath)) {
      await this._appendLog('personal', humanName, relPath, 'file_not_found');
      return;
    }

    let content = await readFile(relPath, 'utf-8');
    const date = isoDate();

    // Find or create the Engine notes section
    const sectionHeader = this.language === 'en'
      ? '## Personal Notes (Engine)'
      : '## Persoenliche Notizen (Engine)';

    if (!content.includes(sectionHeader)) {
      content += '\n\n' + sectionHeader + '\n\n'
        + (this.language === 'en'
          ? '> Automatically captured from conversations. Not curated.\n'
          : '> Automatisch erfasst aus Gespraechen. Nicht kuratiert.\n');
    }

    // Dedup: check if similar fact already exists today
    const existingFacts = content.split('\n')
      .filter(l => l.startsWith(`- ${date}:`))
      .map(l => l.substring(date.length + 4).trim().toLowerCase());

    let added = false;
    for (const fact of facts) {
      const factLower = fact.toLowerCase();
      const isDup = existingFacts.some(e =>
        e.includes(factLower.substring(0, 30)) || factLower.includes(e.substring(0, 30))
      );

      if (!isDup) {
        // Append fact after the section header
        const idx = content.indexOf(sectionHeader);
        const afterHeader = content.indexOf('\n', idx + sectionHeader.length);
        // Find the end of the section description line(s)
        let insertAt = afterHeader;
        let pos = afterHeader + 1;
        while (pos < content.length) {
          const lineEnd = content.indexOf('\n', pos);
          const line = lineEnd > -1 ? content.substring(pos, lineEnd) : content.substring(pos);
          if (line.startsWith('>') || line.trim() === '') {
            pos = lineEnd > -1 ? lineEnd + 1 : content.length;
            insertAt = pos;
          } else {
            break;
          }
        }

        // Find end of existing entries in this section
        let entryEnd = insertAt;
        let scanPos = insertAt;
        while (scanPos < content.length) {
          const lineEnd = content.indexOf('\n', scanPos);
          const line = lineEnd > -1 ? content.substring(scanPos, lineEnd) : content.substring(scanPos);
          if (line.startsWith('- ') || line.trim() === '') {
            scanPos = lineEnd > -1 ? lineEnd + 1 : content.length;
            entryEnd = scanPos;
          } else if (line.startsWith('#')) {
            break;
          } else {
            scanPos = lineEnd > -1 ? lineEnd + 1 : content.length;
            entryEnd = scanPos;
          }
        }

        const entry = `- ${date}: ${fact}\n`;
        content = content.slice(0, entryEnd) + entry + content.slice(entryEnd);
        added = true;
        existingFacts.push(factLower);
      }
    }

    if (added) {
      await writeFile(relPath, content);
      this.throttle[throttleKey] = Date.now();
      this.dailyCounts[dailyKey] = count + 1;
      await this._appendLog('personal', humanName, relPath, 'written');
      this.bus?.safeEmit('personal.detected', {
        source: 'semantic-router',
        facts,
        userName: humanName,
        filePath: relPath.replace(this.soulPath + '/', ''),
      });
      console.log(`  [router] Personal fact written for ${humanName}`);
    }
  }

  // ── Throttle ────────────────────────────────────────────

  _shouldThrottle(key, thresholdMs) {
    const last = this.throttle[key];
    if (!last) return false;
    return (Date.now() - last) < thresholdMs;
  }

  // ── Routing Log ─────────────────────────────────────────

  async _appendLog(route, trigger, target, action) {
    let log = [];
    try {
      if (existsSync(this.logPath)) {
        log = JSON.parse(await readFile(this.logPath, 'utf-8'));
      }
    } catch { /* start fresh */ }

    log.push({
      time: new Date().toISOString(),
      route,
      trigger,
      target: target.replace(this.soulPath + '/', ''),
      action,
    });

    if (log.length > MAX_LOG) {
      log = log.slice(-MAX_LOG);
    }

    try {
      await writeFile(this.logPath, JSON.stringify(log, null, 2));
    } catch { /* best effort */ }
  }
}

// ── Helpers ─────────────────────────────────────────────

function isoDate() {
  return new Date().toISOString().split('T')[0];
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
