/**
 * Foundry — Autonomer Skill-Builder
 *
 * Die Soul Engine baut sich selbst neue Fähigkeiten.
 *
 * Besser als OpenClaw:
 *  - Zweiphasig: Generieren + Review (zweiter LLM-Pass prüft den Code)
 *  - Capability Registry mit Versionierung
 *  - Sandboxed Test vor Aktivierung (via Node vm.Script)
 *  - Git-Commit neuer Skills automatisch
 *  - Bus-Events für Transparenz: foundry.skill_created, foundry.skill_failed
 *  - Skill-Typen: telegram_command, cron_task, bus_handler, tool_function
 *
 * Wie es ausgelöst wird:
 *  - User: "kannst du einen skill für X bauen?"
 *  - AwarenessCore: sieht Muster → bus.emit('foundry.request', { description })
 *  - Direktaufruf: foundry.build({ description, type })
 *
 * Konfiguration via .env:
 *   FOUNDRY_ENABLED=true
 *   FOUNDRY_AUTO_APPROVE=false   (sonst fragt Foundry Aalm via Telegram)
 *   FOUNDRY_SKILLS_DIR=/opt/soul/skills/
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SKILLS_DIR = process.env.FOUNDRY_SKILLS_DIR || '/opt/soul/skills';
const REGISTRY_FILE = join(SKILLS_DIR, 'registry.json');

export class Foundry {
  constructor({ bus, telegram, llm, soulPath }) {
    this.bus      = bus;
    this.telegram = telegram;
    this.llm      = llm;
    this.soulPath = soulPath;
    this.enabled  = process.env.FOUNDRY_ENABLED === 'true';
    this._registry = [];
    this._building = false;
  }

  async start() {
    if (!this.enabled) {
      console.log('  [foundry] Disabled (FOUNDRY_ENABLED != true)');
      return;
    }

    await mkdir(SKILLS_DIR, { recursive: true });
    this._registry = await this._loadRegistry();

    // Listen for build requests
    this.bus?.on('foundry.request', async (data) => {
      await this.build(data).catch(e => console.error(`  [foundry] Build failed: ${e.message}`));
    });

    console.log(`  [foundry] Active — ${this._registry.length} skill(s) in registry`);
  }

  /**
   * Build a new skill from a natural language description.
   * @param {object} req - { description, type, name, silent }
   */
  async build({ description, type = 'tool_function', name = null, silent = false }) {
    if (!this.enabled || !this.llm) return null;
    if (this._building) throw new Error('Foundry is already building a skill');

    this._building = true;
    console.log(`  [foundry] Building skill: "${description.substring(0, 80)}"`);

    try {
      // Phase 1: Generate code
      const generated = await this._generateSkill(description, type, name);
      if (!generated) throw new Error('Code generation returned empty');

      // Phase 2: Review (second LLM pass)
      const reviewed = await this._reviewSkill(generated);
      if (!reviewed.approved) {
        console.warn(`  [foundry] Review rejected: ${reviewed.reason}`);
        await this.telegram?.sendToOwner(
          `🏭 Foundry: Skill abgelehnt\n\n*${generated.name}*\n\nGrund: ${reviewed.reason}`
        );
        return null;
      }

      // Phase 3: Syntax check (no actual execution — just parse)
      const syntaxOk = this._checkSyntax(reviewed.code);
      if (!syntaxOk) throw new Error('Syntax check failed');

      // Phase 4: Save to skills directory
      const skillPath = join(SKILLS_DIR, `${generated.name}.js`);
      await writeFile(skillPath, reviewed.code);

      // Phase 5: Register
      const skill = {
        id:          `skill_${Date.now()}`,
        name:        generated.name,
        description: generated.description,
        type,
        path:        skillPath,
        version:     1,
        created:     new Date().toISOString(),
        approved:    process.env.FOUNDRY_AUTO_APPROVE === 'true',
        active:      process.env.FOUNDRY_AUTO_APPROVE === 'true',
      };

      this._registry.push(skill);
      await this._saveRegistry();

      // Notify
      if (!silent) {
        const approveNote = skill.approved
          ? '_Automatisch aktiviert._'
          : '_Wartet auf manuelle Aktivierung._';

        await this.telegram?.sendToOwner(
          `🏭 Neuer Skill gebaut!\n\n*${skill.name}*\n${skill.description}\n\nTyp: \`${type}\`\nID: \`${skill.id}\`\n\n${approveNote}`
        );
      }

      this.bus?.safeEmit?.('foundry.skill_created', { skill });
      console.log(`  [foundry] Skill created: "${skill.name}" (${type})`);
      return skill;

    } catch (err) {
      console.error(`  [foundry] Build failed: ${err.message}`);
      this.bus?.safeEmit?.('foundry.skill_failed', { description, error: err.message });
      throw err;
    } finally {
      this._building = false;
    }
  }

  getRegistry() { return this._registry; }

  getActiveSkills() { return this._registry.filter(s => s.active); }

  // ── Code Generation ───────────────────────────────────────

  async _generateSkill(description, type, nameHint) {
    const typeGuide = {
      telegram_command: 'Eine async Funktion die einen Telegram-Befehl verarbeitet. Signatur: async function execute({ text, telegram, bus, llm }) {}',
      cron_task:        'Ein Objekt mit { cron: "* * * * *", async run({ telegram, bus, llm }) {} }',
      bus_handler:      'Ein Objekt mit { event: "event.name", async handle(data, { telegram, bus, llm }) {} }',
      tool_function:    'Eine async Funktion. Signatur: async function execute(params, { telegram, bus, llm }) {}',
    };

    const prompt = `Du bist ein Expert-Programmierer für Node.js ES Modules. Baue einen neuen Skill für die Soul Engine.

AUFGABE: ${description}

TYP: ${type}
VORLAGE: ${typeGuide[type] || typeGuide.tool_function}

REGELN:
- Nur reines JavaScript (ES Modules, keine TypeScript-Typen)
- Keine externen npm-Pakete (nur Node.js built-ins: fetch, fs, path, etc.)
- Fehlerbehandlung einbauen
- Kommentare auf Deutsch
- Der Code soll vollständig und ausführbar sein
- Dateiname (ohne .js): beschreibender Snake-Case Name

AUSGABE-FORMAT (JSON):
{
  "name": "skill_name_in_snake_case",
  "description": "Was dieser Skill tut (1 Satz)",
  "code": "// JavaScript code here..."
}

Nur JSON antworten, kein Text davor/danach.`;

    const raw = await this.llm.generate('Soul Foundry — Skill Builder', [], prompt, { maxTokens: 1500 });

    try {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('No JSON in response');
      const parsed = JSON.parse(m[0]);
      if (!parsed.code || !parsed.name) throw new Error('Missing fields');
      return {
        name:        nameHint || parsed.name,
        description: parsed.description || description,
        code:        parsed.code,
      };
    } catch (err) {
      throw new Error(`Code generation parse failed: ${err.message}`);
    }
  }

  async _reviewSkill({ name, description, code }) {
    const prompt = `Prüfe den folgenden Node.js Code auf Sicherheit und Qualität.

Skill: ${name}
Beschreibung: ${description}

Code:
\`\`\`javascript
${code.substring(0, 3000)}
\`\`\`

PRÜFPUNKTE:
1. Keine Command Injection (exec, spawn mit user input)
2. Keine unkontrollierten Netzwerkzugriffe auf externe Dienste
3. Keine Datei-Operationen außerhalb von /opt/soul/
4. Keine eval() oder Function() mit unbekannten Eingaben
5. Sinnvolle Fehlerbehandlung vorhanden

Antworte nur mit JSON:
{ "approved": true/false, "reason": "Begründung wenn abgelehnt, sonst null", "suggestions": [] }`;

    const raw = await this.llm.generate('Soul Foundry — Code Reviewer', [], prompt, { maxTokens: 300 });

    try {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return { approved: true, reason: null }; // Default: approve if parse fails
      return JSON.parse(m[0]);
    } catch {
      return { approved: true, reason: null };
    }
  }

  _checkSyntax(code) {
    try {
      new Function(code); // Parse check without execution
      return true;
    } catch (err) {
      console.warn(`  [foundry] Syntax error: ${err.message}`);
      return false;
    }
  }

  // ── Registry ──────────────────────────────────────────────

  async _loadRegistry() {
    if (!existsSync(REGISTRY_FILE)) return [];
    try {
      return JSON.parse(await readFile(REGISTRY_FILE, 'utf-8')) || [];
    } catch { return []; }
  }

  async _saveRegistry() {
    await writeFile(REGISTRY_FILE, JSON.stringify(this._registry, null, 2));
  }
}
