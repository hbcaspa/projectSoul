/**
 * Module Control — sichere Modul-Registry + Control-Plane für die Engine.
 *
 * Liefert /api/modules/registry (Status aller Module) und führt /api/modules/:id/control
 * fail-safe aus. Quelle: statische Tabelle (gespiegelt aus soul-osx manifest.ts) + echter
 * Laufzeit-Status aus den Engine-Instanzen / env-Flags.
 *
 * SICHERHEITS-INVARIANTE: Sicherheitskritische Module (Gate/ApprovalGate, Hooks, Sandbox,
 * Encryption, ChainHealth, Audit, MemoryDB) sind 'critical_locked' und können NIE disabled
 * werden — der Control-Endpoint verweigert das fail-closed. Jede Operation ist try/catch-gekapselt;
 * ein Fehler oder unbekanntes Modul führt zu sauberem 4xx, NIE zu einem Crash.
 *
 * Control-Typen:
 *   - 'env'             — Boot-Flag (process.env.<FLAG>); zusätzlich Instanz-Laufzeit-Flag
 *                          (z.B. resolver.enabled) wenn at-use geprüft. Sonst Hinweis "ab Neustart".
 *   - 'runtime'         — Instanz hat start()/stop() → echtes Laufzeit-Toggle.
 *   - 'action'          — kein An/Aus, aber auslösbare Aktion (trigger/run/wake/hibernate).
 *   - 'readonly'        — nur Status, kein sicherer Toggle.
 *   - 'critical_locked' — sicherheitskritisch, disable IMMER verweigert.
 */

// ── Modul-Tabelle ───────────────────────────────────────────────────────────
// Gespiegelt aus soul-osx/src/lib/manifest.ts (76 Module). `accessor` ist der
// Property-Name auf der Engine-Instanz (null = kein direkt erreichbares Objekt).
// `flag` ist das Boot-Env-Flag (falls vorhanden). `instanceFlag` ist ein at-use
// geprüftes Laufzeit-Flag auf der Instanz (z.B. 'enabled').
//
// control wird zur Laufzeit ggf. zu einem konservativeren Wert degradiert, wenn die
// reale Instanz die nötigen Methoden NICHT hat (Ehrlichkeit > Fake-Toggle).

const MODULE_TABLE = [
  // ── Kognition ──────────────────────────────────────────────
  { id: 'cortex',         name: 'Cortex',         group: 'cognition', endpoint: '/api/mind',            accessor: 'cortex',              flag: 'SOUL_CORTEX',         control: 'runtime' },
  { id: 'field',          name: 'Field',          group: 'cognition', endpoint: '/api/field',           accessor: 'field',               flag: 'SOUL_FIELD',          control: 'readonly' }, // kein stop()/start() → kaskadiert, readonly zur Laufzeit
  { id: 'causal',         name: 'Causal',         group: 'cognition', endpoint: '/api/causal',          accessor: 'causal',              flag: 'SOUL_CAUSAL',         control: 'runtime' },
  { id: 'composer',       name: 'Composer',       group: 'cognition', endpoint: '/api/composer',        accessor: 'composer',            flag: 'SOUL_COMPOSER',       control: 'runtime' },
  { id: 'contradictions', name: 'Contradictions', group: 'cognition', endpoint: '/api/contradictions',  accessor: 'contradictions',      flag: 'SOUL_CONTRADICTIONS', control: 'runtime' },
  { id: 'exchange',       name: 'Exchange',       group: 'cognition', endpoint: '/api/exchange',        accessor: 'exchange',            flag: 'SOUL_EXCHANGE',       control: 'runtime' },
  { id: 'closure',        name: 'Closure',        group: 'cognition', endpoint: '',                     accessor: 'semanticClosure',     flag: null,                  control: 'readonly' },
  { id: 'planner',        name: 'Planner',        group: 'cognition', endpoint: '/api/planner',         accessor: 'planner',             flag: 'SOUL_PLANNER',        control: 'runtime' }, // stop() vorhanden, start() best-effort
  { id: 'tom',            name: 'ToM',            group: 'cognition', endpoint: '/api/tom',             accessor: 'tom',                 flag: 'SOUL_TOM',            control: 'runtime' },
  { id: 'temporal',       name: 'Temporal',       group: 'cognition', endpoint: '/api/temporal',        accessor: 'temporal',            flag: 'SOUL_TEMPORAL',       control: 'runtime' },
  { id: 'predictor',      name: 'Predictor',      group: 'cognition', endpoint: '/api/predictor',       accessor: 'predictor',           flag: 'SOUL_PREDICTOR',      control: 'runtime' },
  { id: 'metacog',        name: 'Metacognition',  group: 'cognition', endpoint: '/api/metacognition',   accessor: 'metacognition',       flag: 'SOUL_METACOGNITION',  control: 'runtime' },
  { id: 'redteam',        name: 'RedTeam',        group: 'cognition', endpoint: '/api/redteam',         accessor: 'redTeam',             flag: 'SOUL_RED_TEAM',       control: 'runtime' },
  { id: 'impulse',        name: 'Impulse',        group: 'cognition', endpoint: '',                     accessor: 'impulse',             flag: 'SOUL_IMPULSE',        control: 'runtime' },
  { id: 'reflection',     name: 'Reflection',     group: 'cognition', endpoint: '',                     accessor: 'reflection',          flag: 'SOUL_REFLECTION',     control: 'runtime' },
  { id: 'maturity',       name: 'Maturity',       group: 'cognition', endpoint: '/api/maturity',        accessor: null,                  flag: null,                  control: 'readonly' },
  { id: 'mind',           name: 'Mind',           group: 'cognition', endpoint: '/api/mind',            accessor: 'cortex',              flag: null,                  control: 'readonly' },

  // ── Gedächtnis ─────────────────────────────────────────────
  { id: 'compactor',      name: 'Compactor',      group: 'memory', endpoint: '/api/compactor/stats',         accessor: 'compactor',         flag: null,                  control: 'readonly' },
  { id: 'memextract',     name: 'MemExtract',     group: 'memory', endpoint: '/api/memory-extractor/stats',  accessor: 'memoryExtractor',   flag: null,                  control: 'action', action: 'queueExtraction' },
  { id: 'reconsol',       name: 'Reconsolidation',group: 'memory', endpoint: '/api/reconsolidation',         accessor: 'reconsolidation',   flag: 'SOUL_RECONSOLIDATION', control: 'runtime' },
  { id: 'attention',      name: 'Attention',      group: 'memory', endpoint: '',                             accessor: 'attention',         flag: null,                  control: 'readonly' },
  { id: 'consolidator',   name: 'Consolidator',   group: 'memory', endpoint: '/api/seed',                    accessor: 'consolidator',      flag: 'SOUL_CONSOLIDATOR',   control: 'action', action: 'consolidateDeep' },
  { id: 'context',        name: 'Context',        group: 'memory', endpoint: '/api/context',                 accessor: 'context',           flag: null,                  control: 'readonly' },
  { id: 'contextwriter',  name: 'ContextWriter',  group: 'memory', endpoint: '',                             accessor: 'claudeContextWriter', flag: null,                control: 'runtime' }, // start()/stop(), kein Boot-Flag
  { id: 'correction',     name: 'Correction',     group: 'memory', endpoint: '',                             accessor: 'corrector',         flag: 'SOUL_CORRECTION',     control: 'env',  instanceNull: true }, // on-demand check(); env-Flag + Instanz-null deaktiviert at-use
  { id: 'metalearner',    name: 'MetaLearner',    group: 'memory', endpoint: '/api/meta-learner',            accessor: 'metaLearner',       flag: 'SOUL_META_LEARNER',   control: 'runtime' },
  { id: 'memorydb',       name: 'MemoryDB',       group: 'memory', endpoint: '',                             accessor: 'db',                flag: null,                  control: 'critical_locked' },
  { id: 'hnsw',           name: 'HNSW',           group: 'memory', endpoint: '',                             accessor: 'hnswIndex',         flag: null,                  control: 'readonly' },
  { id: 'hybridsearch',   name: 'HybridSearch',   group: 'memory', endpoint: '',                             accessor: 'hybridSearch',      flag: null,                  control: 'readonly' },
  { id: 'localembed',     name: 'LocalEmbed',     group: 'memory', endpoint: '',                             accessor: 'localEmbeddings',   flag: null,                  control: 'readonly' },
  { id: 'rluf',           name: 'RLUF',           group: 'memory', endpoint: '',                             accessor: 'rluf',              flag: null,                  control: 'readonly' },
  { id: 'versioning',     name: 'Versioning',     group: 'memory', endpoint: '',                             accessor: 'versioner',         flag: 'SOUL_VERSIONING',     control: 'env' },

  // ── Autonomie ──────────────────────────────────────────────
  { id: 'goals',          name: 'Goals',          group: 'autonomy', endpoint: '/api/goals',            accessor: 'goalGenerator',       flag: 'SOUL_GOALS',          control: 'runtime' }, // stop() vorhanden, start() best-effort
  { id: 'autoskill',      name: 'AutoSkill',      group: 'autonomy', endpoint: '/api/skills/auto',      accessor: 'autoSkill',           flag: null,                  control: 'readonly' },
  { id: 'recipes',        name: 'Recipes',        group: 'autonomy', endpoint: '/api/recipes',          accessor: 'recipes',             flag: null,                  control: 'readonly' },
  { id: 'react',          name: 'ReAct',          group: 'autonomy', endpoint: '/api/react/stats',      accessor: 'reactLoop',           flag: null,                  control: 'readonly' }, // on-demand run(), kein start/stop
  { id: 'cheaphb',        name: 'CheapHB',        group: 'autonomy', endpoint: '/api/cheap-heartbeat',  accessor: 'cheapHeartbeat',      flag: null,                  control: 'action', action: 'run' },
  { id: 'subagents',      name: 'Subagents',      group: 'autonomy', endpoint: '/api/subagents/status', accessor: 'subagents',          flag: null,                  control: 'readonly' },
  { id: 'capabilities',   name: 'Capabilities',   group: 'autonomy', endpoint: '/api/capabilities',     accessor: 'capabilityRegistry',  flag: null,                  control: 'readonly' },
  { id: 'registry',       name: 'Registry',       group: 'autonomy', endpoint: '/api/capabilities',     accessor: 'capabilityRegistry',  flag: null,                  control: 'readonly' },
  { id: 'research',       name: 'Research',       group: 'autonomy', endpoint: '',                      accessor: 'research',            flag: null,                  control: 'readonly' },
  { id: 'foundry',        name: 'Foundry',        group: 'autonomy', endpoint: '',                      accessor: 'foundry',             flag: 'FOUNDRY_ENABLED',     control: 'env',  instanceFlag: 'enabled', flagPositive: true }, // gegated: default OFF
  { id: 'gapdetect',      name: 'GapDetect',      group: 'autonomy', endpoint: '',                      accessor: 'capabilityGap',       flag: null,                  control: 'readonly' },
  { id: 'resolver',       name: 'Resolver',       group: 'autonomy', endpoint: '',                      accessor: 'capabilityResolver',  flag: 'CAPABILITY_RESOLVER_ENABLED', instanceFlag: 'enabled', control: 'env' }, // at-use geprüftes .enabled
  { id: 'heartbeat',      name: 'Heartbeat',      group: 'autonomy', endpoint: '',                      accessor: 'heartbeat',           flag: null,                  control: 'readonly' },
  { id: 'planner2',       name: 'Streams',        group: 'autonomy', endpoint: '/api/streams',          accessor: null,                  flag: null,                  control: 'readonly' },

  // ── Sicherheit (überwiegend critical_locked) ───────────────
  { id: 'gate',           name: 'Gate',           group: 'security', endpoint: '/api/gate',             accessor: 'approvalGate',        flag: null,                  control: 'critical_locked' },
  { id: 'hooks',          name: 'Hooks',          group: 'security', endpoint: '/api/hooks',            accessor: 'hooks',               flag: null,                  control: 'critical_locked' },
  { id: 'drift',          name: 'Drift',          group: 'security', endpoint: '',                      accessor: 'driftDetector',       flag: null,                  control: 'readonly' },
  { id: 'audit',          name: 'Audit',          group: 'security', endpoint: '',                      accessor: 'audit',               flag: null,                  control: 'critical_locked' },
  { id: 'encryption',     name: 'Encryption',     group: 'security', endpoint: '',                      accessor: 'encryption',          flag: null,                  control: 'critical_locked' },
  { id: 'sandbox',        name: 'Sandbox',        group: 'security', endpoint: '/api/sandbox/status',   accessor: 'sandbox',             flag: null,                  control: 'critical_locked' },
  { id: 'coalescer',      name: 'Coalescer',      group: 'security', endpoint: '/api/coalescer',        accessor: 'coalescer',           flag: null,                  control: 'readonly' },
  { id: 'paperclip',      name: 'Paperclip',      group: 'security', endpoint: '/api/paperclip',        accessor: 'paperclip',           flag: null,                  control: 'readonly' },
  { id: 'redteam2',       name: 'Protocol',       group: 'security', endpoint: '',                      accessor: 'securityAgent',       flag: 'SECURITY_AGENT_ENABLED', control: 'critical_locked' },
  { id: 'chainhealth',    name: 'ChainHealth',    group: 'security', endpoint: '/api/health',           accessor: 'chainHealth',         flag: null,                  control: 'critical_locked' },

  // ── Wahrnehmung ────────────────────────────────────────────
  { id: 'gateway',        name: 'Gateway',        group: 'perception', endpoint: '/api/gateway',        accessor: 'gateway',             flag: null,                  control: 'readonly' },
  { id: 'telegram',       name: 'Telegram',       group: 'perception', endpoint: '',                    accessor: 'telegram',            flag: null,                  control: 'runtime' }, // start()/stop() vorhanden
  { id: 'whatsapp',       name: 'WhatsApp',       group: 'perception', endpoint: '',                    accessor: 'whatsapp',            flag: null,                  control: 'readonly' },
  { id: 'github',         name: 'GitHub',         group: 'perception', endpoint: '',                    accessor: null,                  flag: null,                  control: 'readonly' },
  { id: 'chat',           name: 'Chat',           group: 'perception', endpoint: '/api/chat/history',   accessor: null,                  flag: null,                  control: 'readonly' },
  { id: 'profile',        name: 'Profile',        group: 'perception', endpoint: '/api/profile',        accessor: 'autoProfile',         flag: null,                  control: 'readonly' },
  { id: 'multimodal',     name: 'Multimodal',     group: 'perception', endpoint: '',                    accessor: 'multimodal',          flag: null,                  control: 'readonly' },
  { id: 'language',       name: 'Language',       group: 'perception', endpoint: '',                    accessor: null,                  flag: null,                  control: 'readonly' },
  { id: 'relay',          name: 'Relay',          group: 'perception', endpoint: '',                    accessor: null,                  flag: null,                  control: 'readonly' },
  { id: 'streamcon',      name: 'StreamCon',      group: 'perception', endpoint: '',                    accessor: 'streamConsolidator',  flag: null,                  control: 'readonly' },
  { id: 'streambus',      name: 'StreamBus',      group: 'perception', endpoint: '',                    accessor: 'streamBus',           flag: null,                  control: 'readonly' },

  // ── Infrastruktur ──────────────────────────────────────────
  { id: 'api',            name: 'API',            group: 'infra', endpoint: '/api/status',              accessor: 'api',                 flag: null,                  control: 'critical_locked' },
  { id: 'costs',          name: 'Costs',          group: 'infra', endpoint: '/api/costs',               accessor: 'costs',               flag: null,                  control: 'readonly' },
  { id: 'health',         name: 'Health',         group: 'infra', endpoint: '/api/health',              accessor: 'chainHealth',         flag: null,                  control: 'readonly' },
  { id: 'monitor',        name: 'Monitor',        group: 'infra', endpoint: '/api/monitor',             accessor: 'uptimeMonitor',       flag: null,                  control: 'readonly' },
  { id: 'adapter',        name: 'Adapter',        group: 'infra', endpoint: '/api/adapter/providers',   accessor: 'soulAdapter',         flag: null,                  control: 'readonly' },
  { id: 'doctor',         name: 'Doctor',         group: 'infra', endpoint: '',                         accessor: 'doctor',              flag: null,                  control: 'readonly' },
  { id: 'sessions',       name: 'Sessions',       group: 'infra', endpoint: '/api/sessions',            accessor: 'sessionManager',      flag: null,                  control: 'readonly' },
  { id: 'llm',            name: 'LLM',            group: 'infra', endpoint: '',                          accessor: 'llm',                 flag: null,                  control: 'readonly' },
  { id: 'mcp',            name: 'MCP',            group: 'infra', endpoint: '',                          accessor: 'mcp',                 flag: null,                  control: 'readonly' },
  { id: 'router',         name: 'Router',         group: 'infra', endpoint: '',                          accessor: 'router',              flag: null,                  control: 'readonly' },
  { id: 'autoprofile',    name: 'AutoProfile',    group: 'infra', endpoint: '',                          accessor: 'autoProfile',         flag: null,                  control: 'readonly' },
  { id: 'transfer',       name: 'Transfer',       group: 'infra', endpoint: '/api/transfer',             accessor: 'transfer',            flag: 'SOUL_TRANSFER',       control: 'runtime' }, // stop() vorhanden (start best-effort)
  { id: 'websocket',      name: 'WebSocket',      group: 'infra', endpoint: '',                          accessor: null,                  flag: null,                  control: 'readonly' },
  { id: 'soul',           name: 'Soul',           group: 'infra', endpoint: '/api/status',               accessor: null,                  flag: null,                  control: 'critical_locked' },
];

// Sicherheitskritische Gruppen-/ID-Liste — disable IMMER verweigert.
const SECURITY_CRITICAL_IDS = new Set([
  'gate', 'hooks', 'sandbox', 'encryption', 'chainhealth', 'audit',
  'memorydb', 'api', 'soul', 'redteam2',
]);

function isCriticalLocked(def) {
  return def.control === 'critical_locked' || SECURITY_CRITICAL_IDS.has(def.id);
}

/**
 * Ermittelt den echten Laufzeit-Status eines Moduls aus der Engine-Instanz / env.
 * @returns { enabled: boolean|null, available: boolean }
 */
function probeStatus(engine, def) {
  let instance = null;
  try {
    instance = def.accessor ? engine[def.accessor] : null;
  } catch {
    instance = null;
  }
  const available = !!instance;

  // enabled bestimmen — möglichst aus echtem Zustand, sonst env-Flag, sonst null
  let enabled = null;
  try {
    if (def.instanceFlag && instance && typeof instance[def.instanceFlag] === 'boolean') {
      enabled = instance[def.instanceFlag];
    } else if (instance && typeof instance.running === 'boolean') {
      enabled = instance.running;
    } else if (def.flag) {
      const raw = process.env[def.flag];
      if (def.flagPositive) {
        // Default-OFF Flags (z.B. FOUNDRY_ENABLED): nur 'true' = an
        enabled = raw === 'true';
      } else {
        // Default-ON Flags (SOUL_*): alles außer 'false' = an
        enabled = raw !== 'false';
      }
    } else if (available) {
      // Instanz existiert, kein Flag, kein running → als aktiv melden
      enabled = true;
    }
  } catch {
    enabled = null;
  }

  return { enabled, available };
}

/**
 * Baut die volle Registry für /api/modules/registry.
 */
function buildRegistry(engine) {
  return MODULE_TABLE.map((def) => {
    const { enabled, available } = probeStatus(engine, def);
    const entry = {
      id: def.id,
      name: def.name,
      group: def.group,
      enabled,
      control: def.control,
      available,
    };
    if (def.endpoint) entry.endpoint = def.endpoint;
    if (isCriticalLocked(def)) entry.locked = true;
    return entry;
  });
}

/**
 * Führt eine Control-Operation fail-safe aus.
 * @returns { status: number, body: object }
 */
async function controlModule(engine, id, action) {
  const def = MODULE_TABLE.find((m) => m.id === id);
  if (!def) {
    return { status: 400, body: { error: `unknown module: ${id}` } };
  }
  if (!['enable', 'disable', 'trigger'].includes(action)) {
    return { status: 400, body: { error: `unknown action: ${action} (allowed: enable|disable|trigger)` } };
  }

  // FAIL-CLOSED: disable eines sicherheitskritischen Moduls IMMER verweigern.
  if (action === 'disable' && isCriticalLocked(def)) {
    return { status: 403, body: { error: 'security-critical module cannot be disabled', id } };
  }
  // 'trigger'/'enable' auf critical_locked: kein gefährlicher Toggle — nur ablehnen,
  // ausser es ist eine harmlose action. critical_locked hat keine action → 400.
  if (isCriticalLocked(def)) {
    return { status: 400, body: { error: 'module is critical and not toggleable', id, control: 'critical_locked' } };
  }

  let instance = null;
  try {
    instance = def.accessor ? engine[def.accessor] : null;
  } catch {
    instance = null;
  }

  const emit = (extra = {}) => {
    try { engine.bus?.safeEmit?.('module.control', { id, action, by: 'soulosx', ...extra }); }
    catch { /* logging darf nie crashen */ }
  };

  try {
    // ── control: readonly ──────────────────────────────────
    if (def.control === 'readonly') {
      return { status: 400, body: { error: 'module is readonly and cannot be toggled', id, control: 'readonly' } };
    }

    // ── control: action ────────────────────────────────────
    if (def.control === 'action') {
      if (action === 'disable') {
        return { status: 400, body: { error: 'action-type module cannot be disabled (no on/off state)', id, control: 'action' } };
      }
      // enable wird auf trigger gemappt — die "Aktivierung" ist das Auslösen.
      const fn = def.action;
      if (!fn || !instance || typeof instance[fn] !== 'function') {
        return { status: 400, body: { error: 'module not available or has no triggerable action', id, available: !!instance } };
      }
      // async ausführen, nicht blockierend — Aktionen können lange dauern.
      Promise.resolve()
        .then(() => instance[fn]())
        .catch((err) => console.error(`  [module-control] ${id}.${fn}() failed: ${err.message}`));
      emit({ result: 'triggered', method: fn });
      return { status: 200, body: { ok: true, id, action: 'trigger', method: fn, note: 'Aktion asynchron ausgelöst' } };
    }

    // ── control: env ───────────────────────────────────────
    if (def.control === 'env') {
      if (action === 'trigger') {
        return { status: 400, body: { error: 'env-type module has no trigger action', id, control: 'env' } };
      }
      const want = action === 'enable';
      let atUse = false;
      // 1) Boot-Flag setzen (wirkt sicher beim nächsten Boot)
      if (def.flag) {
        process.env[def.flag] = def.flagPositive ? (want ? 'true' : 'false') : (want ? 'true' : 'false');
      }
      // 2) Laufzeit-Flag auf der Instanz mitsetzen, falls at-use geprüft
      if (def.instanceFlag && instance && typeof instance[def.instanceFlag] === 'boolean') {
        instance[def.instanceFlag] = want;
        atUse = true;
      }
      // 3) Spezialfall correction: Instanz null setzen deaktiviert at-use sauber
      if (def.instanceNull) {
        if (!want) {
          try { engine[def.accessor] = null; atUse = true; } catch { /* ignore */ }
        }
        // enable nach null kann zur Laufzeit NICHT rekonstruiert werden → Hinweis
        if (want && !instance) {
          emit({ result: 'flag-set', atUse: false });
          return { status: 200, body: { ok: true, id, action, atUse: false, note: 'Flag gesetzt — wirkt ab nächstem Neustart (Instanz zur Laufzeit nicht rekonstruierbar)' } };
        }
      }
      emit({ result: 'flag-set', atUse });
      return {
        status: 200,
        body: atUse
          ? { ok: true, id, action, atUse: true, note: 'sofort wirksam (Laufzeit-Flag at-use geprüft)' }
          : { ok: true, id, action, atUse: false, note: 'wirkt ab nächstem Neustart' },
      };
    }

    // ── control: runtime ───────────────────────────────────
    if (def.control === 'runtime') {
      if (action === 'trigger') {
        return { status: 400, body: { error: 'runtime-type module has no trigger action (use enable/disable)', id, control: 'runtime' } };
      }
      if (!instance) {
        // Modul nicht instanziiert → Flag setzen (best effort), Hinweis Neustart.
        if (def.flag) process.env[def.flag] = action === 'enable' ? 'true' : 'false';
        emit({ result: 'flag-set', atUse: false, available: false });
        return { status: 200, body: { ok: true, id, action, atUse: false, available: false, note: 'Instanz nicht aktiv — Flag gesetzt, wirkt ab nächstem Neustart' } };
      }
      if (action === 'enable') {
        if (typeof instance.start === 'function') {
          await instance.start();
          emit({ result: 'started' });
          return { status: 200, body: { ok: true, id, action: 'enable', method: 'start', note: 'gestartet' } };
        }
        // Kein start() (z.B. planner/goals/cortex) → ehrlich melden.
        if (def.flag) process.env[def.flag] = 'true';
        emit({ result: 'flag-set', atUse: false });
        return { status: 200, body: { ok: true, id, action: 'enable', atUse: false, note: 'kein Laufzeit-start() — Flag gesetzt, sauberer Re-Start erst beim nächsten Boot' } };
      }
      // disable
      if (typeof instance.stop === 'function') {
        await instance.stop();
        emit({ result: 'stopped' });
        return { status: 200, body: { ok: true, id, action: 'disable', method: 'stop', note: 'gestoppt' } };
      }
      if (typeof instance.shutdown === 'function') {
        await instance.shutdown();
        emit({ result: 'shutdown' });
        return { status: 200, body: { ok: true, id, action: 'disable', method: 'shutdown', note: 'heruntergefahren' } };
      }
      // Kein stop()/shutdown() → kein sicherer Toggle, NICHT faken.
      return { status: 400, body: { error: 'module has no runtime stop()/shutdown() — cannot disable safely', id, control: 'runtime' } };
    }

    // Fallback — sollte nie erreicht werden.
    return { status: 400, body: { error: 'module not toggleable', id, control: def.control } };
  } catch (err) {
    // FAIL-SAFE: jeder Fehler → sauberer 500, NIE Crash.
    console.error(`  [module-control] ${id}.${action} error: ${err.message}`);
    return { status: 500, body: { error: `control failed: ${err.message}`, id, action } };
  }
}

export { MODULE_TABLE, SECURITY_CRITICAL_IDS, buildRegistry, controlModule, isCriticalLocked };
