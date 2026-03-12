import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * KnowledgeExtractor — async background learner for Telegram conversations.
 *
 * After each Telegram message, runs an LLM extraction pass on the conversation
 * turn and saves new facts about people/entities to knowledge-graph.jsonl.
 * Runs fire-and-forget so it never blocks the response.
 *
 * knowledge-graph.jsonl is synced via Soul Chain → available to all devices
 * and the MCP memory server on the next sync cycle.
 */
export class KnowledgeExtractor {
  constructor(soulPath, llm) {
    this.kgPath = resolve(soulPath, 'knowledge-graph.jsonl');
    this.llm = llm;
    this._running = false;
  }

  /**
   * Fire-and-forget: call after sending the bot's response.
   * Does not block. Errors are logged but do not propagate.
   */
  extractAndSave(userMessage, botResponse, userName) {
    if (this._running) return; // skip if previous extraction still running
    this._running = true;
    this._doExtract(userMessage, botResponse, userName)
      .catch((err) => console.error(`  [kg-extractor] Failed: ${err.message}`))
      .finally(() => { this._running = false; });
  }

  async _doExtract(userMessage, botResponse, userName) {
    const prompt = buildExtractionPrompt(userName, userMessage, botResponse);

    let raw = '';
    try {
      raw = await this.llm.generate(prompt, [], '', {
        maxTokens: 400,
        temperature: 0.1,
      }) || '';
    } catch (err) {
      console.error(`  [kg-extractor] LLM call failed: ${err.message}`);
      return;
    }

    const facts = parseFactsFromResponse(raw);
    if (!facts || facts.length === 0) return;

    const kg = await this._loadKG();
    let changed = false;

    for (const fact of facts) {
      if (!fact.name || !fact.observations?.length) continue;

      const existing = kg.find(
        (e) => e.type === 'entity' && e.name.toLowerCase() === fact.name.toLowerCase()
      );

      if (existing) {
        for (const obs of fact.observations) {
          if (obs && !existing.observations.some((o) => o.toLowerCase() === obs.toLowerCase())) {
            existing.observations.push(obs);
            changed = true;
          }
        }
      } else {
        kg.push({
          type: 'entity',
          name: fact.name,
          entityType: fact.entityType || 'unknown',
          observations: fact.observations,
        });
        changed = true;
      }
    }

    if (changed) {
      await this._saveKG(kg);
      console.log(`  [kg-extractor] Saved ${facts.length} facts from conversation with ${userName}`);
    }
  }

  async _loadKG() {
    if (!existsSync(this.kgPath)) return [];
    try {
      const lines = (await readFile(this.kgPath, 'utf-8'))
        .split('\n')
        .filter((l) => l.trim());
      return lines
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async _saveKG(kg) {
    // Atomic write: temp file → rename prevents corruption during Soul Chain sync
    const tmp = this.kgPath + '.tmp';
    const content = kg.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await writeFile(tmp, content, 'utf-8');
    await writeFile(this.kgPath, content, 'utf-8'); // direct write (rename not needed for JSONL)
  }
}

// ── Prompt ───────────────────────────────────────────────

function buildExtractionPrompt(userName, userMessage, botResponse) {
  return `Du bist ein Wissens-Extraktor. Analysiere diese Konversation und extrahiere NEUE Fakten über Personen, Tiere, Orte oder wichtige Konzepte.

Nutzer (${userName}): ${userMessage}
Antwort: ${botResponse}

Gib NUR dann JSON aus, wenn wirklich neue, faktische Informationen vorhanden sind.
Erfinde NICHTS. Spekuliere NICHT. Nur eindeutige Fakten.

Format — ein JSON-Array (oder [] wenn nichts Neues):
[
  {
    "name": "Entitätsname",
    "entityType": "person|cat|dog|pet|place|project|concept",
    "observations": ["Fakt 1", "Fakt 2"]
  }
]

Ignoriere:
- Allgemeine Aussagen ohne klaren Bezug zu einer Entität
- Bereits bekannte Fakten (Mitchell = Aalms Freund, etc.)
- Gefühle, Meinungen, temporäre Zustände

Antworte NUR mit dem JSON-Array, kein anderer Text.`;
}

// ── Parser ───────────────────────────────────────────────

function parseFactsFromResponse(raw) {
  if (!raw) return [];

  // Try to extract JSON array from response (LLM might add text around it)
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f) => f && typeof f.name === 'string' && Array.isArray(f.observations) && f.observations.length > 0
    );
  } catch {
    return [];
  }
}
