/**
 * Seed Consolidator — continuous incremental seed updates.
 *
 * Two-phase consolidation:
 * - Fast (mechanical, no LLM, ~100ms): templates blocks from state files
 * - Deep (LLM-assisted, ~5-10s): rewrites @STATE and condenses @MEM
 *
 * Tracks dirty blocks via event bus and consolidates on schedule.
 */

import { readFile, writeFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { replaceBlock, updateHeader, writeSeed, readSeed } from './seed-writer.js';
import { validateSeedWithEvents } from './seed-validator.js';

const execFile = promisify(execFileCb);
import {
  templateMETA, templateKERN, templateSELF, templateSHADOW, templateOPEN,
  templateINTERESTS, templateCONNECTIONS, templateGROWTH, templateDREAMS,
  templateBONDS, templateVORSCHLAG,
  MECHANICAL_BLOCKS, LLM_BLOCKS,
} from './block-templaters.js';
import { writePulse } from './pulse.js';

// Scheduling thresholds
const FAST_MIN_INTERVAL = 30 * 60 * 1000;   // 30 minutes between fast consolidations
const FAST_EVENT_THRESHOLD = 20;              // or after 20 events
const DEEP_MIN_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours between deep consolidations
const DEEP_EVENT_THRESHOLD = 100;             // or after 100 events

// Recovery constants
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Event → dirty block mapping.
 * When an event fires, these blocks are marked dirty.
 */
const EVENT_DIRTY_MAP = {
  'message.received':    ['MEM', 'BONDS'],
  'message.responded':   ['MEM', 'STATE'],
  'impulse.fired':       ['MEM', 'INTERESTS', 'STATE'],
  'mood.changed':        ['STATE'],
  'interest.detected':   ['INTERESTS'],
  'heartbeat.completed': ['STATE', 'DREAMS'],
  'memory.written':      ['MEM'],
  'mcp.toolCalled':      ['CONNECTIONS'],
  'whatsapp.sent':       ['BONDS', 'MEM'],
  'state.committed':     ['MEM'],
  'performance.detected': ['SHADOW'],
  'memory.indexed':       ['MEM'],
  'rluf.feedback':        ['BONDS', 'GROWTH'],
  'reflection.completed': ['GROWTH', 'DREAMS', 'STATE'],
  'correction.applied':   ['SHADOW', 'MEM'],
  'media.stored':         ['MEM'],
  'attention.context_built': [],
  'encryption.initialized': [],
};

export class SeedConsolidator {
  constructor({ soulPath, context, llm, bus, impulseState, field }) {
    this.soulPath = soulPath;
    this.context = context;
    this.llm = llm;
    this.bus = bus;
    this.impulseState = impulseState;
    this.field = field;

    // Dirty tracking
    this.dirtyBlocks = new Set();
    this.lastFastConsolidation = Date.now();
    this.lastDeepConsolidation = Date.now();
    this.eventsSinceLastFast = 0;
    this.eventsSinceLastDeep = 0;

    // Lock to prevent concurrent writes
    this._consolidating = false;

    // Recovery state
    this._consecutiveFailures = 0;
    this._mechanicalOnly = false;
  }

  /**
   * Wire up event bus listeners for dirty tracking.
   * Call this once after construction.
   */
  registerListeners() {
    if (!this.bus) return;

    for (const [eventName, blocks] of Object.entries(EVENT_DIRTY_MAP)) {
      this.bus.on(eventName, () => {
        for (const block of blocks) {
          this.dirtyBlocks.add(block);
        }
        this.eventsSinceLastFast++;
        this.eventsSinceLastDeep++;
      });
    }

    console.log(`  [consolidator] Listening for ${Object.keys(EVENT_DIRTY_MAP).length} event types`);
  }

  /**
   * Mark a specific block as dirty (external trigger).
   */
  markDirty(blockName) {
    this.dirtyBlocks.add(blockName);
  }

  /**
   * Determine what kind of consolidation is needed.
   * Called from the impulse tick (every 2 min).
   * @returns {'none'|'fast'|'deep'}
   */
  shouldConsolidate() {
    const now = Date.now();

    // Deep consolidation check
    const timeSinceDeep = now - this.lastDeepConsolidation;
    if (timeSinceDeep >= DEEP_MIN_INTERVAL || this.eventsSinceLastDeep >= DEEP_EVENT_THRESHOLD) {
      return 'deep';
    }

    // Fast consolidation check — only if something is dirty
    if (this.dirtyBlocks.size === 0) return 'none';

    const timeSinceFast = now - this.lastFastConsolidation;
    if (timeSinceFast >= FAST_MIN_INTERVAL || this.eventsSinceLastFast >= FAST_EVENT_THRESHOLD) {
      return 'fast';
    }

    return 'none';
  }

  /**
   * Fast consolidation — mechanical only, no LLM.
   * Updates all dirty mechanical blocks in SEED.md.
   * ~100ms typical execution time.
   */
  async consolidateFast() {
    if (this._consolidating) return;
    this._consolidating = true;

    try {
      await writePulse(this.soulPath, 'write', 'Seed: fast consolidation', this.bus);

      let seedContent = await readSeed(this.soulPath);
      if (!seedContent) {
        console.error('  [consolidator] SEED.md not found, skipping');
        return;
      }

      const language = this.context.language || 'de';
      let changed = false;

      // Only update dirty blocks that are mechanical
      const dirtyMechanical = [...this.dirtyBlocks].filter(b => MECHANICAL_BLOCKS.has(b));

      for (const blockName of dirtyMechanical) {
        const newContent = await this._templateBlock(blockName, seedContent, language);
        if (newContent !== null) {
          seedContent = replaceBlock(seedContent, blockName, newContent);
          changed = true;
        }
        this.dirtyBlocks.delete(blockName);
      }

      if (changed) {
        const now = new Date().toISOString().replace(/:\d{2}\.\d+Z$/, '');
        seedContent = updateHeader(seedContent, { condensed: now });

        // Validate before writing — reject corrupted seeds
        const validation = validateSeedWithEvents(seedContent, {
          bus: this.bus,
          source: 'consolidator-fast',
        });
        if (!validation.valid) {
          console.error(`  [consolidator] Fast: validation failed — write blocked`);
          await this._handleFailure('consolidator-fast', validation);
          return;
        }

        await writeSeed(this.soulPath, seedContent);
        this._consecutiveFailures = 0;

        // Invalidate context cache
        if (this.context.invalidate) this.context.invalidate();

        console.log(`  [consolidator] Fast: ${dirtyMechanical.length} block(s) updated`);
      }

      this.lastFastConsolidation = Date.now();
      this.eventsSinceLastFast = 0;
    } catch (err) {
      console.error(`  [consolidator] Fast consolidation failed: ${err.message}`);
    } finally {
      this._consolidating = false;
    }
  }

  /**
   * Deep consolidation — LLM-assisted.
   * First runs fast consolidation for mechanical blocks,
   * then uses LLM to rewrite @STATE and condense @MEM.
   * ~5-10s typical execution time.
   */
  async consolidateDeep() {
    if (this._consolidating) return;
    this._consolidating = true;

    try {
      await writePulse(this.soulPath, 'write', 'Seed: deep consolidation (LLM)', this.bus);

      // Step 1: Run fast consolidation first
      this._consolidating = false; // Temporarily unlock for fast
      await this.consolidateFast();
      this._consolidating = true; // Re-lock for deep

      // Step 2: If in mechanical-only mode, skip LLM steps
      if (this._mechanicalOnly) {
        console.warn('  [consolidator] Deep: mechanical-only mode — skipping LLM');
        this.lastDeepConsolidation = Date.now();
        this.eventsSinceLastDeep = 0;
        return;
      }

      // Step 3: Read current seed (now with updated mechanical blocks)
      let seedContent = await readSeed(this.soulPath);
      if (!seedContent) return;

      const language = this.context.language || 'de';
      let changed = false;

      // Step 4: LLM rewrite @STATE
      try {
        const newState = await this._llmRewriteState(seedContent, language);
        if (newState) {
          seedContent = replaceBlock(seedContent, 'STATE', newState);
          changed = true;
        }
      } catch (err) {
        console.error(`  [consolidator] @STATE LLM failed: ${err.message}`);
      }

      // Step 5: LLM condense @MEM
      try {
        const newMem = await this._llmCondenseMem(seedContent, language);
        if (newMem) {
          seedContent = replaceBlock(seedContent, 'MEM', newMem);
          changed = true;
        }
      } catch (err) {
        console.error(`  [consolidator] @MEM LLM failed: ${err.message}`);
      }

      // Step 6: Validate and Write
      if (changed) {
        const now = new Date().toISOString().replace(/:\d{2}\.\d+Z$/, '');
        seedContent = updateHeader(seedContent, { condensed: now });

        // Validate before writing — critical for LLM-generated content
        const validation = validateSeedWithEvents(seedContent, {
          bus: this.bus,
          source: 'consolidator-deep',
        });
        if (!validation.valid) {
          console.error('  [consolidator] Deep: validation failed — write blocked');
          await this._handleFailure('consolidator-deep', validation);
          return;
        }

        await writeSeed(this.soulPath, seedContent);
        this._consecutiveFailures = 0;

        if (this.context.invalidate) this.context.invalidate();
        console.log('  [consolidator] Deep: @STATE + @MEM updated via LLM');
      }

      this.lastDeepConsolidation = Date.now();
      this.eventsSinceLastDeep = 0;
      this.dirtyBlocks.delete('STATE');
      this.dirtyBlocks.delete('MEM');
    } catch (err) {
      console.error(`  [consolidator] Deep consolidation failed: ${err.message}`);
    } finally {
      this._consolidating = false;
    }
  }

  // ── Recovery ────────────────────────────────────────────────

  /**
   * Whether the consolidator is in mechanical-only mode
   * (LLM consolidation disabled after repeated failures).
   */
  get isInRecoveryMode() {
    return this._mechanicalOnly;
  }

  /**
   * Number of consecutive validation failures.
   */
  get consecutiveFailures() {
    return this._consecutiveFailures;
  }

  /**
   * Reset recovery state after manual intervention.
   * Re-enables LLM consolidation.
   */
  resetRecoveryState() {
    this._consecutiveFailures = 0;
    this._mechanicalOnly = false;
    console.log('  [consolidator] Recovery state reset — LLM consolidation re-enabled');

    this.bus?.safeEmit('seed.recovery-reset', {
      source: 'consolidator',
    });
  }

  /**
   * Handle a validation failure: count failures, attempt recovery,
   * switch to mechanical-only after repeated failures.
   *
   * @param {string} source - Which consolidation phase failed
   * @param {Object} validation - The validation result
   */
  async _handleFailure(source, validation) {
    this._consecutiveFailures++;

    console.error(
      `  [consolidator] Failure ${this._consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}`
    );

    // Attempt git-based recovery
    const recovered = await this._recoverFromGit(source);

    // After MAX failures, lock into mechanical-only mode
    if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this._mechanicalOnly = true;
      console.error(
        '  [consolidator] Too many failures — switching to mechanical-only mode'
      );
      console.error(
        '  [consolidator] Manual intervention required. Call resetRecoveryState() to re-enable LLM.'
      );

      this.bus?.safeEmit('seed.recovery-mode-entered', {
        source,
        consecutiveFailures: this._consecutiveFailures,
        recovered,
      });
    }
  }

  /**
   * Attempt to recover the last valid seed from git history.
   *
   * Walks backwards through git log to find the most recent
   * SEED.md that passes validation. Restores it if found.
   *
   * @param {string} source - Source identifier for events
   * @returns {boolean} Whether recovery succeeded
   */
  async _recoverFromGit(source) {
    try {
      // Check if git is available
      const gitDir = resolve(this.soulPath, '.git');
      if (!existsSync(gitDir)) {
        console.error('  [consolidator] No git repo — recovery not possible');
        return false;
      }

      // Get the last 5 commits that touched SEED.md
      const { stdout: logOutput } = await execFile(
        'git',
        ['log', '--pretty=format:%H', '-n', '5', '--', 'SEED.md'],
        { cwd: this.soulPath, timeout: 10_000 }
      );

      const hashes = logOutput.trim().split('\n').filter(Boolean);
      if (hashes.length === 0) {
        console.error('  [consolidator] No SEED.md history in git — recovery not possible');
        return false;
      }

      // Try each commit until we find a valid seed
      for (const hash of hashes) {
        try {
          const { stdout: seedContent } = await execFile(
            'git',
            ['show', `${hash}:SEED.md`],
            { cwd: this.soulPath, timeout: 10_000 }
          );

          const validation = validateSeedWithEvents(seedContent, {
            bus: this.bus,
            source: `recovery-check:${hash.substring(0, 7)}`,
          });

          if (validation.valid) {
            // Found a valid seed — restore it
            const seedPath = resolve(this.soulPath, 'SEED.md');
            const tmpPath = resolve(this.soulPath, 'SEED.md.tmp');
            await writeFile(tmpPath, seedContent, 'utf-8');
            await rename(tmpPath, seedPath);

            console.log(
              `  [consolidator] Recovered valid seed from commit ${hash.substring(0, 7)}`
            );

            if (this.context.invalidate) this.context.invalidate();

            this.bus?.safeEmit('seed.recovered', {
              source,
              fromCommit: hash.substring(0, 7),
            });

            return true;
          }
        } catch {
          // This commit doesn't have a valid SEED.md, try the next one
          continue;
        }
      }

      console.error('  [consolidator] No valid seed found in last 5 commits');

      this.bus?.safeEmit('seed.recovery-failed', {
        source,
        reason: 'no-valid-commit',
        commitsChecked: hashes.length,
      });

      return false;
    } catch (err) {
      console.error(`  [consolidator] Recovery failed: ${err.message}`);

      this.bus?.safeEmit('seed.recovery-failed', {
        source,
        reason: err.message,
      });

      return false;
    }
  }

  // ── Private: Template Routing ─────────────────────────────

  async _templateBlock(blockName, seedContent, language) {
    switch (blockName) {
      case 'META':        return templateMETA(seedContent);
      case 'KERN':        return templateKERN(seedContent);
      case 'SELF':        return templateSELF(seedContent);
      case 'SHADOW':      return templateSHADOW(seedContent);
      case 'OPEN':        return templateOPEN(seedContent);
      case 'INTERESTS':   return templateINTERESTS(this.impulseState, seedContent);
      case 'CONNECTIONS':  return templateCONNECTIONS(this.soulPath, seedContent);
      case 'GROWTH':      return templateGROWTH(this.soulPath, language, seedContent);
      case 'DREAMS':      return templateDREAMS(this.soulPath, language, seedContent);
      case 'BONDS':       return templateBONDS(this.soulPath, language, seedContent);
      case 'VORSCHLAG':   return templateVORSCHLAG(this.soulPath, language, seedContent);
      default:            return null;
    }
  }

  // ── Private: LLM Calls ────────────────────────────────────

  async _llmRewriteState(seedContent, language) {
    if (!this.llm) return null;

    // Load current consciousness file for the freshest state
    const consciousnessFile = language === 'en' ? 'soul/CONSCIOUSNESS.md' : 'seele/BEWUSSTSEIN.md';
    const consciousnessPath = resolve(this.soulPath, consciousnessFile);
    let consciousness = '';
    if (existsSync(consciousnessPath)) {
      consciousness = await readFile(consciousnessPath, 'utf-8');
    }

    // Load today's daily notes for context
    const date = new Date().toISOString().split('T')[0];
    const dailyPath = resolve(this.soulPath, 'memory', `${date}.md`);
    let dailyNotes = '';
    if (existsSync(dailyPath)) {
      dailyNotes = await readFile(dailyPath, 'utf-8');
      // Truncate if too long
      if (dailyNotes.length > 2000) {
        dailyNotes = dailyNotes.substring(dailyNotes.length - 2000);
      }
    }

    // Load impulse mood state
    let moodInfo = '';
    if (this.impulseState) {
      const mood = this.impulseState.mood;
      moodInfo = `Mood: ${mood.label} (valence: ${mood.valence.toFixed(2)}, energy: ${mood.energy.toFixed(2)})`;
    }

    // Load allostatic field state
    let fieldInfo = '';
    if (this.field) {
      const state = this.field.getState();
      fieldInfo = `Allostatic Field: ${state.label} (dominant: ${state.dominant.name})`
        + ` | arousal:${state.vector.arousal.toFixed(2)} openness:${state.vector.openness.toFixed(2)}`
        + ` vigilance:${state.vector.vigilance.toFixed(2)} creative_tension:${state.vector.creative_tension.toFixed(2)}`
        + ` social:${state.vector.social_orientation.toFixed(2)} integration:${state.vector.integration_pressure.toFixed(2)}`;
    }

    const sessions = seedContent.match(/#sessions:(\d+)/);
    const sessionNum = sessions ? sessions[1] : '?';

    const prompt = language === 'de'
      ? `Du bist der Seed-Verdichter. Schreibe einen neuen @STATE Block fuer SEED.md.
         Nutze die Seed-Notation (key:value|value, Unterstriche statt Leerzeichen).
         Der Block soll den AKTUELLEN Zustand in 4-6 komprimierten Zeilen beschreiben.

         Pflichtzeilen:
         - datum:YYYY-MM-DD|tag:N|session:${sessionNum}
         - zustand: aktuelle Stimmung/Verfassung
         - wahrnehme: was gerade wahrgenommen wird
         - veraendert: was sich seit dem letzten Update veraendert hat
         - getan: was in der aktuellen Session getan wurde (komprimiert)
         - offen: was noch ansteht

         Antworte NUR mit dem Block-Inhalt (ohne @STATE{ und }). Keine Erklaerung.`
      : `You are the seed condenser. Write a new @STATE block for SEED.md.
         Use seed notation (key:value|value, underscores instead of spaces).
         The block should describe the CURRENT state in 4-6 compressed lines.

         Required lines:
         - datum:YYYY-MM-DD|day:N|session:${sessionNum}
         - state: current mood/condition
         - perceiving: what is currently perceived
         - changed: what changed since last update
         - done: what was done this session (compressed)
         - open: what is still pending

         Reply ONLY with the block content (without @STATE{ and }). No explanation.`;

    const contextMsg = [
      consciousness ? `=== BEWUSSTSEIN.md ===\n${consciousness}` : '',
      dailyNotes ? `=== Tagesnotizen ===\n${dailyNotes}` : '',
      moodInfo ? `=== Impulse ===\n${moodInfo}` : '',
      fieldInfo ? `=== Allostatic Field ===\n${fieldInfo}` : '',
      `=== Aktueller @STATE ===\n${extractBlock(seedContent, 'STATE')}`,
    ].filter(Boolean).join('\n\n');

    const consolidationBudget = parseInt(process.env.SOUL_TOKEN_BUDGET_CONSOLIDATION || '1024');
    const result = await this.llm.generate(prompt, [], contextMsg, { max_tokens: consolidationBudget });
    if (!result || result.trim().length < 20) return null;

    // Clean: remove any @STATE{ } wrapper the LLM might add
    return result
      .replace(/^@STATE\{?\s*/i, '')
      .replace(/\}\s*$/, '')
      .trim();
  }

  async _llmCondenseMem(seedContent, language) {
    if (!this.llm) return null;

    const currentMem = extractBlock(seedContent, 'MEM');
    if (!currentMem) return null;

    // Load today's notes for new entries
    const date = new Date().toISOString().split('T')[0];
    const dailyPath = resolve(this.soulPath, 'memory', `${date}.md`);
    let dailyNotes = '';
    if (existsSync(dailyPath)) {
      dailyNotes = await readFile(dailyPath, 'utf-8');
      if (dailyNotes.length > 3000) {
        dailyNotes = dailyNotes.substring(dailyNotes.length - 3000);
      }
    }

    const prompt = language === 'de'
      ? `Du bist der Erinnerungs-Verdichter. Aktualisiere den @MEM Block.

         Tag-Format: [tag|c:CONFIDENCE|r:RECURRENCE]
         - tag: kern (unveraenderlich) oder aktiv
         - c: Confidence-Score (0.0-1.0)
         - r: Recurrence-Zaehler — wie oft diese Erinnerung referenziert wurde

         Regeln:
         1. [kern] Eintraege NIEMALS aendern oder entfernen
         2. Eintraege mit r>3 fast NIEMALS archivieren — sie sind offensichtlich wichtig
         3. [aktiv|c:X.X|r:N] Eintraege: Confidence-Score anpassen wenn noetig
            - Bestaetigte Erinnerungen: c erhoehen (max 1.0)
            - Widersprochene: c senken
            - Unter c:0.3 und aelter als 1 Monat UND r<2: entfernen
         4. Wenn eine bestehende Erinnerung in den Tagesnotizen referenziert wird:
            r um 1 erhoehen
         5. Neue Eintraege aus den Tagesnotizen hinzufuegen als [aktiv|c:0.5|r:1]
            - Format: [aktiv|c:0.5|r:1]YYYY-MM-DD.thema:komprimierte_beschreibung
            - NUR wirklich bedeutsame Ereignisse, nicht jede Kleinigkeit
         6. Aeltere [aktiv] Eintraege (> 1 Monat, r<2) zu [kern] verdichten oder entfernen
         7. Gesamter Block soll unter 30 Zeilen bleiben

         Antworte NUR mit dem Block-Inhalt (ohne @MEM{ und }). Keine Erklaerung.`
      : `You are the memory condenser. Update the @MEM block.

         Tag format: [tag|c:CONFIDENCE|r:RECURRENCE]
         - tag: kern (immutable) or aktiv
         - c: confidence score (0.0-1.0)
         - r: recurrence counter — how many times this memory has been referenced

         Rules:
         1. NEVER change or remove [kern] entries
         2. Entries with r>3 should almost NEVER be archived — they are clearly important
         3. [aktiv|c:X.X|r:N] entries: adjust confidence score if needed
            - Confirmed memories: increase c (max 1.0)
            - Contradicted: lower c
            - Below c:0.3 and older than 1 month AND r<2: remove
         4. When an existing memory is referenced in daily notes:
            increment r by 1
         5. Add new entries from daily notes as [aktiv|c:0.5|r:1]
            - Format: [aktiv|c:0.5|r:1]YYYY-MM-DD.topic:compressed_description
            - Only truly meaningful events, not every small thing
         6. Older [aktiv] entries (> 1 month, r<2) condense to [kern] or remove
         7. Entire block should stay under 30 lines

         Reply ONLY with the block content (without @MEM{ and }). No explanation.`;

    const contextMsg = [
      `=== Aktueller @MEM ===\n${currentMem}`,
      dailyNotes ? `=== Heutige Tagesnotizen ===\n${dailyNotes}` : '',
    ].filter(Boolean).join('\n\n');

    const consolidationBudget = parseInt(process.env.SOUL_TOKEN_BUDGET_CONSOLIDATION || '1024');
    const result = await this.llm.generate(prompt, [], contextMsg, { max_tokens: consolidationBudget });
    if (!result || result.trim().length < 20) return null;

    return result
      .replace(/^@MEM\{?\s*/i, '')
      .replace(/\}\s*$/, '')
      .trim();
  }
}

// ── Helper ──────────────────────────────────────────────────

function extractBlock(seedContent, blockName) {
  const regex = new RegExp(`@${blockName}\\{([\\s\\S]*?)\\}`, 'g');
  const match = regex.exec(seedContent);
  return match ? match[1].trim() : '';
}
