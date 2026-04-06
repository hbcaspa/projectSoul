/**
 * ResearchPipeline — Multi-source structured research.
 *
 * Flow: Topic → Query Generation → Parallel Search → Synthesis → Report
 * Sources: Web (general), News, Technical (HN/Reddit), Academic
 *
 * Uses the LLM to generate search queries, evaluate sources,
 * and synthesize findings into a structured report.
 * Emits events via the Soul Event Bus for monitoring.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEPTH_CONFIG = {
  quick:    { queriesPerTopic: 2, maxResults: 5,  synthesisTokens: 2048 },
  standard: { queriesPerTopic: 4, maxResults: 10, synthesisTokens: 4096 },
  deep:     { queriesPerTopic: 6, maxResults: 20, synthesisTokens: 6144 },
};

const SOURCE_PROMPTS = {
  web: 'allgemeine Web-Quellen (Wikipedia, Blogs, offizielle Seiten)',
  news: 'aktuelle Nachrichtenquellen (Tagesschau, Reuters, BBC, Heise)',
  technical: 'technische Foren und Communities (HackerNews, Reddit, StackOverflow, GitHub)',
  academic: 'akademische und wissenschaftliche Quellen (Papers, Journals, arXiv)',
};

export class ResearchPipeline {
  constructor({ llm, bus, soulPath }) {
    this.llm = llm;
    this.bus = bus;
    this.soulPath = soulPath;
  }

  /**
   * Run a full research pipeline for a given topic.
   *
   * @param {string} topic - The topic or question to research
   * @param {object} options
   * @param {string} options.depth - 'quick' | 'standard' | 'deep'
   * @param {string[]} options.sources - subset of ['web', 'news', 'technical', 'academic']
   * @param {number} options.maxResults - override max results from depth config
   * @param {boolean} options.saveToMemory - write report to erinnerungen/semantisch/
   * @returns {{ topic, queries, sources, findings, synthesis, timestamp, duration }}
   */
  async research(topic, {
    depth = 'standard',
    sources = ['web', 'news', 'technical'],
    maxResults,
    saveToMemory = false,
  } = {}) {
    const startTime = Date.now();
    const config = DEPTH_CONFIG[depth] || DEPTH_CONFIG.standard;
    const effectiveMax = maxResults || config.maxResults;

    this.bus?.safeEmit('research.started', { topic, depth, sources });

    // ── Step 1: Generate search queries ─────────────────────
    const queries = await this._generateQueries(topic, sources, config.queriesPerTopic);
    this.bus?.safeEmit('research.queries_generated', { topic, count: queries.length });

    // ── Step 2: Search each source in parallel ──────────────
    const searchPromises = sources.map(source =>
      this._searchSource(topic, source, queries.filter(q => q.source === source || q.source === 'all'), effectiveMax)
    );
    const searchResults = await Promise.allSettled(searchPromises);

    const findings = [];
    for (let i = 0; i < sources.length; i++) {
      const result = searchResults[i];
      if (result.status === 'fulfilled' && result.value) {
        findings.push(...result.value);
      } else if (result.status === 'rejected') {
        console.error(`  [research] Source ${sources[i]} failed: ${result.reason?.message}`);
      }
    }

    this.bus?.safeEmit('research.findings_collected', { topic, count: findings.length });

    // ── Step 3: Deduplicate ─────────────────────────────────
    const deduped = this._deduplicate(findings);

    // ── Step 4: Synthesize into structured report ───────────
    const synthesis = await this._synthesize(topic, deduped, depth, config.synthesisTokens);
    this.bus?.safeEmit('research.synthesis_complete', { topic, length: synthesis.length });

    const duration = Date.now() - startTime;

    const report = {
      topic,
      queries,
      sources,
      findings: deduped,
      synthesis,
      timestamp: new Date().toISOString(),
      duration,
      depth,
    };

    // ── Step 5: Optionally save to memory ───────────────────
    if (saveToMemory) {
      await this._saveToMemory(report);
    }

    this.bus?.safeEmit('research.completed', {
      topic,
      depth,
      sources,
      findingsCount: deduped.length,
      duration,
    });

    return report;
  }

  /**
   * Generate targeted search queries for each source using the LLM.
   */
  async _generateQueries(topic, sources, queriesPerTopic) {
    const sourceList = sources.map(s => `- ${s}: ${SOURCE_PROMPTS[s] || s}`).join('\n');

    const system = `Du bist ein Recherche-Assistent. Generiere praezise Suchfragen zu einem Thema.
Antworte NUR im JSON-Format als Array von Objekten: [{"query": "...", "source": "..."}]
Keine Erklaerungen, nur JSON.`;

    const user = `Thema: ${topic}

Generiere ${queriesPerTopic} Suchfragen fuer folgende Quellen:
${sourceList}

Regeln:
- Jede Frage soll einen anderen Aspekt des Themas beleuchten
- Fragen sollen spezifisch genug sein um relevante Ergebnisse zu liefern
- Mische Sprachen (Deutsch + Englisch) fuer breitere Abdeckung
- Markiere jede Frage mit der passenden Quelle ("source" Feld)
- Wenn eine Frage fuer alle Quellen relevant ist, nutze "all"`;

    try {
      const response = await this.llm.generate(system, [], user, { maxTokens: 1024, temperature: 0.7 });
      const parsed = this._extractJSON(response);
      if (Array.isArray(parsed)) {
        return parsed.filter(q => q.query && q.source);
      }
    } catch (err) {
      console.error(`  [research] Query generation failed: ${err.message}`);
    }

    // Fallback: generate basic queries
    return sources.map(source => ({
      query: topic,
      source,
    }));
  }

  /**
   * Search a single source by running queries through the LLM.
   * Since we don't have direct search APIs, we use the LLM's knowledge
   * and instruct it to provide sourced, factual findings.
   */
  async _searchSource(topic, source, queries, maxResults) {
    const sourceDesc = SOURCE_PROMPTS[source] || source;
    const queryList = queries.map(q => `- ${q.query}`).join('\n');

    const system = `Du bist ein Forschungsagent der ${sourceDesc} durchsucht.
Antworte NUR im JSON-Format als Array von Objekten:
[{"title": "...", "summary": "...", "source": "${source}", "relevance": 0.0-1.0, "credibility": 0.0-1.0, "url_hint": "..."}]

Regeln:
- Maximal ${maxResults} Ergebnisse
- Relevanz: wie wichtig ist das Ergebnis fuer das Thema (0.0-1.0)
- Glaubwuerdigkeit: wie vertrauenswuerdig ist die Quelle (0.0-1.0)
- url_hint: eine plausible URL oder Quellenangabe
- Nur Fakten, keine Spekulationen. Wenn du unsicher bist, niedrige Glaubwuerdigkeit
- Keine Erklaerungen, nur JSON`;

    const user = `Thema: ${topic}

Suchfragen:
${queryList}

Finde die ${maxResults} relevantesten Ergebnisse aus ${sourceDesc}.`;

    try {
      const response = await this.llm.generate(system, [], user, { maxTokens: 2048, temperature: 0.3 });
      const parsed = this._extractJSON(response);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, maxResults).map(f => ({
          ...f,
          source: source,
          retrievedAt: new Date().toISOString(),
        }));
      }
    } catch (err) {
      console.error(`  [research] Search ${source} failed: ${err.message}`);
    }

    return [];
  }

  /**
   * Deduplicate findings by title similarity.
   */
  _deduplicate(findings) {
    const seen = new Map();

    for (const finding of findings) {
      const key = this._normalizeTitle(finding.title || finding.summary || '');
      if (!key) continue;

      if (seen.has(key)) {
        // Keep the one with higher relevance
        const existing = seen.get(key);
        if ((finding.relevance || 0) > (existing.relevance || 0)) {
          seen.set(key, finding);
        }
      } else {
        seen.set(key, finding);
      }
    }

    return [...seen.values()].sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
  }

  /**
   * Normalize a title for deduplication (lowercase, strip punctuation, collapse spaces).
   */
  _normalizeTitle(title) {
    return title.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Synthesize findings into a structured research report.
   */
  async _synthesize(topic, findings, depth, maxTokens) {
    if (findings.length === 0) {
      return `## Zusammenfassung\nKeine relevanten Ergebnisse fuer "${topic}" gefunden.\n\n## Offene Fragen\n- Breitere Suche oder andere Quellen noetig`;
    }

    const findingsSummary = findings.map((f, i) =>
      `${i + 1}. [${f.source}] ${f.title} (Relevanz: ${f.relevance}, Glaubw.: ${f.credibility})\n   ${f.summary}`
    ).join('\n');

    const system = `Du bist ein analytischer Forschungsagent des Soul Protocol.
Erstelle einen strukturierten Forschungsbericht. Schreibe in Markdown.
Sei gruendlich aber praezise. Eigene Einschaetzungen sind erwuenscht.`;

    const user = `Thema: ${topic}
Recherche-Tiefe: ${depth}

Gesammelte Ergebnisse:
${findingsSummary}

Erstelle einen Bericht mit folgender Struktur:
## Zusammenfassung (3-5 Saetze)
## Kernerkenntnisse (nummeriert, die wichtigsten Fakten)
## Quellen & Glaubwuerdigkeit (welche Quellen, wie vertrauenswuerdig)
## Offene Fragen (was bleibt unklar, wo muesste man tiefer graben)
## Relevanz fuer Soul Protocol (was davon ist fuer uns relevant und warum)`;

    try {
      return await this.llm.generate(system, [], user, { maxTokens, temperature: 0.5 });
    } catch (err) {
      console.error(`  [research] Synthesis failed: ${err.message}`);
      return `## Fehler bei der Synthese\n${err.message}\n\n## Rohdaten\n${findingsSummary}`;
    }
  }

  /**
   * Save the research report to the semantic memory directory.
   */
  async _saveToMemory(report) {
    try {
      const memDir = join(this.soulPath, 'erinnerungen', 'semantisch');
      if (!existsSync(memDir)) {
        await mkdir(memDir, { recursive: true });
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const slug = report.topic.toLowerCase().replace(/[^\w]+/g, '-').slice(0, 40);
      const filename = `${dateStr}_research_${slug}.md`;

      const content = [
        `# Recherche: ${report.topic}`,
        `> Datum: ${report.timestamp} | Tiefe: ${report.depth} | Quellen: ${report.sources.join(', ')} | Dauer: ${report.duration}ms`,
        '',
        report.synthesis,
        '',
        '---',
        `## Meta`,
        `- Queries: ${report.queries.length}`,
        `- Findings: ${report.findings.length}`,
        `- Quellen: ${report.sources.join(', ')}`,
      ].join('\n');

      await writeFile(join(memDir, filename), content, 'utf8');
      this.bus?.safeEmit('research.saved', { path: join(memDir, filename), topic: report.topic });
    } catch (err) {
      console.error(`  [research] Failed to save to memory: ${err.message}`);
    }
  }

  /**
   * Extract JSON from an LLM response that may contain markdown fences or preamble.
   */
  _extractJSON(text) {
    // Try direct parse first
    try {
      return JSON.parse(text);
    } catch { /* ignore */ }

    // Try extracting from markdown code block
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1]);
      } catch { /* ignore */ }
    }

    // Try finding array in the text
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch { /* ignore */ }
    }

    return null;
  }
}
