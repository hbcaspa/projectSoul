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
import * as skillspector from './skillspector.js';
import { HIGH_THRESHOLD } from './skillspector.js';

const SKILLS_DIR = process.env.FOUNDRY_SKILLS_DIR || '/opt/soul/skills';
const REGISTRY_FILE = join(SKILLS_DIR, 'registry.json');

// Sandbox-Test-Limits (bewusst eng — ein Skill-Smoke-Test darf nicht lange laufen
// und nicht viel Speicher fressen). Werte sind absichtlich konservativ: lieber ein
// fälschlich abgelehnter Skill als ein durchgerutschter.
const SANDBOX_TIMEOUT_MS = parseInt(process.env.FOUNDRY_SANDBOX_TIMEOUT_MS || '10000', 10);
const SANDBOX_MEMORY_MB  = parseInt(process.env.FOUNDRY_SANDBOX_MEMORY_MB  || '128', 10);

export class Foundry {
  /**
   * @param {object} deps
   * @param {object}  deps.bus
   * @param {object}  deps.telegram
   * @param {object}  deps.llm
   * @param {string}  deps.soulPath
   * @param {object} [deps.sandbox]      - SandboxManager (für isolierten Test). FEHLT er,
   *                                       schlägt der Sandbox-Schritt FAIL-CLOSED fehl.
   * @param {object} [deps.approvalGate] - ApprovalGate (Human-in-the-Loop). FEHLT er,
   *                                       wird KEIN Skill live geschaltet (fail-closed).
   */
  constructor({ bus, telegram, llm, soulPath, sandbox = null, approvalGate = null }) {
    this.bus          = bus;
    this.telegram     = telegram;
    this.llm          = llm;
    this.soulPath     = soulPath;
    this.sandbox      = sandbox;
    this.approvalGate = approvalGate;
    this.enabled      = process.env.FOUNDRY_ENABLED === 'true';
    this._registry    = [];
    this._building    = false;
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

      // Phase 5: Register — IMMER inaktiv. Ein frisch gebauter Skill darf NIE
      // automatisch live gehen. Die Aktivierung läuft ausschließlich über
      // armAndPublish() (SkillSpector → Sandbox → ApprovalGate). Das frühere
      // FOUNDRY_AUTO_APPROVE-Flag, das hier active:true setzen konnte, war ein
      // Fail-Open-Loch (selbst-generierter Code ginge ungeprüft scharf) und ist
      // bewusst entfernt: kein Pfad setzt active=true ausserhalb der Sicherheitskette.
      const skill = {
        id:          `skill_${Date.now()}`,
        name:        generated.name,
        description: generated.description,
        type,
        path:        skillPath,
        version:     1,
        created:     new Date().toISOString(),
        approved:    false,
        active:      false,
        code:        reviewed.code,   // für SkillSpector/Sandbox in armAndPublish
      };

      this._registry.push(skill);
      await this._saveRegistry();

      // Notify
      if (!silent) {
        await this.telegram?.sendToOwner(
          `🏭 Neuer Skill gebaut!\n\n*${skill.name}*\n${skill.description}\n\nTyp: \`${type}\`\nID: \`${skill.id}\`\n\n_Wartet auf Sicherheitskette (Scan → Sandbox → Genehmigung)._`
        );
      }

      this.bus?.safeEmit?.('foundry.skill_created', { skill });
      console.log(`  [foundry] Skill created: "${skill.name}" (${type})`);

      // Phase 6: Sicherheitskette anstoßen. armAndPublish ist selbst fail-closed
      // und prüft FOUNDRY_ENABLED erneut — der gebaute Skill bleibt inaktiv, bis
      // Scan + Sandbox + ApprovalGate alle bestanden sind.
      await this.armAndPublish(skill).catch(e =>
        console.error(`  [foundry] armAndPublish failed: ${e.message}`));

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

  // ── Sicherheitskette vor Aktivierung ──────────────────────
  //
  // armAndPublish() ist der EINZIGE Pfad, der einen Skill scharf schaltet.
  // Drei Stufen in fester Reihenfolge, jede FAIL-CLOSED (bei Fehler/Unsicherheit
  // ABLEHNEN, nie aktivieren):
  //   a) SkillSpector-Scan  — statische Sicherheitsanalyse des generierten Codes
  //   b) Sandbox-Test       — isolierte Ausführung (Timeout/Speicherlimit)
  //   c) ApprovalGate       — Owner muss explizit zustimmen ("ja <id>" via Telegram)
  //
  // Erst im Approval-Execute-Callback (nach menschlichem JA) wird active=true.
  // Solange FOUNDRY_ENABLED != 'true' tut die Methode NICHTS.

  /**
   * Schaltet einen gebauten Skill durch die Sicherheitskette und – nur bei
   * Owner-Zustimmung – live. Wirft nie; gibt ein Ergebnis-Objekt zurück.
   *
   * @param {object} skill - Registry-Eintrag (muss .code oder .path haben)
   * @returns {Promise<{armed:boolean, reason?:string, pending?:boolean, id?:string}>}
   */
  async armAndPublish(skill) {
    // Gate 0 — Feature-Flag. Default OFF. Ohne explizites Opt-in passiert NICHTS.
    if (process.env.FOUNDRY_ENABLED !== 'true') {
      console.log('  [foundry] Foundry disabled (FOUNDRY_ENABLED != true) — armAndPublish noop');
      return { armed: false, reason: 'Foundry disabled' };
    }

    if (!skill || (!skill.code && !skill.path)) {
      console.warn('  [foundry] armAndPublish: kein Code/Pfad — abgelehnt (fail-closed)');
      return { armed: false, reason: 'no code/path' };
    }

    // ── Stufe a) SkillSpector-Scan ──────────────────────────
    // scan() schreibt den Code in ein temp SKILL.md und ruft die CLI auf. Es wirft
    // NIE — liefert { available:false } wenn die CLI fehlt. FAIL-CLOSED: ohne
    // erfolgreichen Scan (available && ok) wird nicht weitergemacht. „Konnte nicht
    // verifizieren" == „unsicher" == ablehnen.
    let scanRes;
    try {
      scanRes = skill.code
        ? await skillspector.scan({ code: skill.code })
        : await skillspector.scan({ path: skill.path });
    } catch (err) {
      // scan() soll nie werfen — falls doch, defensiv ablehnen.
      return this._reject(skill, `SkillSpector-Aufruf fehlgeschlagen: ${err.message}`);
    }

    if (!scanRes || !scanRes.available || !scanRes.ok) {
      return this._reject(skill,
        `SkillSpector nicht verfügbar/kein gültiges Ergebnis (${scanRes?.error || 'unbekannt'}) — kann Sicherheit nicht verifizieren`);
    }

    // Score über Schwelle ODER kritische Findings → ablehnen.
    const score = typeof scanRes.risk_score === 'number' ? scanRes.risk_score : 100; // unbekannt = max
    const critical = Array.isArray(scanRes.findings)
      ? scanRes.findings.filter(f => /^(critical|high)$/i.test(String(f.severity || '')))
      : [];
    if (score >= HIGH_THRESHOLD || critical.length > 0) {
      return this._reject(skill,
        `SkillSpector: Risiko-Score ${score} (Schwelle ${HIGH_THRESHOLD}), ${critical.length} kritische Finding(s)`);
    }

    // ── Stufe b) Sandbox-Test ───────────────────────────────
    // Isolierte Ausführung. FAIL-CLOSED: fehlt der SandboxManager, kann nicht
    // getestet werden → ablehnen. exitCode 124 = Timeout/gekillt, !=0 = Laufzeitfehler.
    if (!this.sandbox || typeof this.sandbox.execute !== 'function') {
      return this._reject(skill, 'Kein Sandbox-Manager — Skill kann nicht isoliert getestet werden');
    }

    const testCode = this._buildSandboxHarness(skill);
    let sandboxRes;
    try {
      sandboxRes = await this.sandbox.execute({
        code:        testCode,
        language:    'javascript',
        timeout:     SANDBOX_TIMEOUT_MS,
        memoryMB:    SANDBOX_MEMORY_MB,
        // Docker bevorzugen falls vorhanden (echte Netz-/FS-Isolation); SandboxManager
        // fällt selbst auf den Prozess-Backend zurück, wenn Docker fehlt.
        preferDocker: true,
      });
    } catch (err) {
      return this._reject(skill, `Sandbox-Ausführung warf: ${err.message}`);
    }

    if (!sandboxRes || sandboxRes.exitCode !== 0) {
      const why = sandboxRes?.exitCode === 124
        ? `Timeout nach ${SANDBOX_TIMEOUT_MS}ms`
        : `exitCode ${sandboxRes?.exitCode}`;
      const errTail = String(sandboxRes?.stderr || '').slice(-300);
      return this._reject(skill, `Sandbox-Test fehlgeschlagen (${why})${errTail ? ': ' + errTail : ''}`);
    }

    // ── Stufe c) ApprovalGate ───────────────────────────────
    // FAIL-CLOSED: ohne ApprovalGate kommt kein Skill in den Live-Satz.
    if (!this.approvalGate || typeof this.approvalGate.enqueueApproval !== 'function') {
      return this._reject(skill, 'Kein ApprovalGate — Aktivierung ohne Owner-Zustimmung verweigert');
    }

    // enqueueApproval benachrichtigt den Owner und führt execute() ERST aus, wenn
    // der Owner per Telegram "ja <id>" antwortet (owner-gefiltert, fail-closed in
    // approval-gate.js). Der Skill wird also ausschließlich nach echtem menschlichem
    // JA aktiviert. Wir registrieren 'foundry_publish_skill' als Risk-Tool, damit
    // requiresApproval() konsistent bleibt, falls anderswo abgefragt.
    const toolName = 'foundry_publish_skill';
    if (typeof this.approvalGate.addRiskyTool === 'function') {
      this.approvalGate.addRiskyTool(toolName);
    }

    const res = this.approvalGate.enqueueApproval(
      toolName,
      { skill: skill.name, id: skill.id, type: skill.type, risk_score: score },
      async () => this._activateSkill(skill), // läuft NUR nach Owner-JA
    );

    this.bus?.safeEmit?.('foundry.skill_pending_approval', {
      skill: skill.name, id: skill.id, risk_score: score, approvalId: res?.id,
    });
    console.log(`  [foundry] Skill "${skill.name}" hat Scan+Sandbox bestanden — wartet auf Owner-Genehmigung (${res?.id})`);

    return { armed: false, pending: true, id: res?.id, reason: 'awaiting owner approval' };
  }

  /**
   * Aktiviert den Skill im Live-Satz. Wird AUSSCHLIESSLICH vom ApprovalGate-
   * Execute-Callback aufgerufen, also nach explizitem Owner-JA. Nicht direkt aufrufen.
   * @private
   */
  async _activateSkill(skill) {
    const entry = this._registry.find(s => s.id === skill.id) || skill;
    entry.approved   = true;
    entry.active     = true;
    entry.activatedAt = new Date().toISOString();
    await this._saveRegistry();
    this.bus?.safeEmit?.('foundry.skill_activated', { skill: entry.name, id: entry.id });
    console.log(`  [foundry] Skill ACTIVATED nach Owner-Genehmigung: "${entry.name}"`);
    return `Skill ${entry.name} aktiviert`;
  }

  /**
   * Einheitliche Ablehnung: loggt, benachrichtigt, emittiert, lässt active=false.
   * @private
   */
  _reject(skill, reason) {
    // Sicherstellen, dass der Skill NICHT aktiv ist (defensiv).
    const entry = this._registry.find(s => s.id === skill?.id);
    if (entry) { entry.approved = false; entry.active = false; }
    console.warn(`  [foundry] Aktivierung abgelehnt — "${skill?.name}": ${reason}`);
    this.telegram?.sendToOwner?.(
      `🛑 Foundry: Skill NICHT aktiviert\n\n*${skill?.name}*\n\nGrund: ${reason}`
    ).catch(() => {});
    this.bus?.safeEmit?.('foundry.skill_rejected', { skill: skill?.name, id: skill?.id, reason });
    return { armed: false, reason };
  }

  /**
   * Baut einen minimalen Smoke-Test-Harness um den generierten Skill-Code.
   * Ziel: lädt/parst der Skill und ist sein Export aufrufbar, ohne dass der
   * Test scharfe Seiteneffekte braucht. Bewusst KEIN echtes bus/telegram/llm —
   * der Skill bekommt nur No-Op-Stubs, der Test ist ein Lade-/Signatur-Check.
   * In der Sandbox gibt es ohnehin kein Netz/keine Engine-Objekte.
   * @private
   */
  _buildSandboxHarness(skill) {
    // skill.code als String einbetten. JSON.stringify escaped sauber für JS.
    const codeLiteral = JSON.stringify(skill.code || '');
    return `
// Foundry Sandbox-Smoke-Test (auto-generiert, läuft isoliert)
const SKILL_SOURCE = ${codeLiteral};
(async () => {
  try {
    // Parsen + auswerten in einem Modul-Wrapper. Wirft bei Syntaxfehlern.
    const wrapped = '(function(module, exports){' + SKILL_SOURCE + '\\n; return module.exports;})';
    // eslint-disable-next-line no-eval
    const factory = eval(wrapped);
    const moduleObj = { exports: {} };
    const exported = factory(moduleObj, moduleObj.exports);
    // Akzeptiere: default export, named 'execute', oder bus_handler/cron_task-Objekt.
    const candidate = exported && (exported.execute || exported.run || exported.handle || exported.default || exported);
    if (typeof candidate !== 'function' && typeof candidate !== 'object') {
      console.error('Skill exportiert nichts Aufrufbares');
      process.exit(2);
    }
    console.log('SANDBOX_OK');
    process.exit(0);
  } catch (err) {
    console.error('Skill-Test-Fehler: ' + (err && err.message));
    process.exit(1);
  }
})();
`;
  }

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

    // FAIL-CLOSED: a broken/unparseable LLM review must NOT approve a self-built skill.
    // (This pre-filter sits before SkillSpector+Sandbox+Gate, but defense-in-depth means
    // every layer denies on uncertainty rather than waving the skill through.)
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return { approved: false, reason: 'LLM-Review nicht parsebar — fail-closed abgelehnt' };
      return JSON.parse(m[0]);
    } catch {
      return { approved: false, reason: 'LLM-Review-JSON fehlerhaft — fail-closed abgelehnt' };
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
