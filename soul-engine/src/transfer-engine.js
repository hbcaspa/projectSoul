/**
 * D3 — Cross-Domain Transfer Engine
 * AGI Arena Module: Discovers structural analogies between knowledge domains.
 *
 * Architecture:
 * - Extracts structural properties from entities (not keywords — abstract patterns)
 * - Clusters entities by domain and structural fingerprint
 * - Generates cross-domain analogies with quality scoring
 * - Writes new abstract relations to the knowledge graph
 *
 * Key distinction: "Server infrastructure has bottleneck problems" and
 * "Consciousness research has the same scaling dynamics" is a STRUCTURAL
 * analogy. "Both are complicated" is SURFACE. This engine finds the former.
 *
 * Integration: Constructor pattern compatible with Soul Engine.
 * Dependencies: { bus, memoryDb? } from SoulEngine
 */

// ── Structural Properties ──────────────────────────────────

/**
 * Abstract structural properties that can apply across ANY domain.
 * Each property has:
 * - name: unique identifier
 * - patterns: regex/keyword patterns that indicate this property in observations
 * - weight: how specific/informative this property is (higher = rarer = more valuable)
 * - description: human-readable explanation
 */
const STRUCTURAL_PROPERTIES = [
  // Growth & Scaling
  {
    name: 'exponential_growth',
    patterns: [/expon|explod|verdoppel|doubl|rapid.*wachs|rapid.*grow|beschleunig|accelerat/i],
    weight: 0.8,
    category: 'dynamics',
    description: 'Exhibits exponential or accelerating growth',
  },
  {
    name: 'bottleneck_constraint',
    patterns: [/flaschenhals|bottleneck|engpass|constraint|limit|erschoepf|exhaust|nicht.*ausreich|insufficient|knapp|scarc/i],
    weight: 0.9,
    category: 'dynamics',
    description: 'Growth constrained by a limiting resource or bottleneck',
  },
  {
    name: 'scaling_dynamics',
    patterns: [/skalier|scal|wachs.*schnell|grow.*fast|kapazitaet|capacity|GW|gigawatt|billion|milliard/i],
    weight: 0.7,
    category: 'dynamics',
    description: 'Involves scaling challenges or growth dynamics',
  },
  {
    name: 'temporal_mismatch',
    patterns: [/zeitskalen|time.*scale|schneller.*als|faster.*than|kluft|gap|bau.*geschwindigkeit|build.*speed|jahrzehnt|decade/i],
    weight: 0.95,
    category: 'dynamics',
    description: 'Mismatch between speed of different processes (one outpaces another)',
  },

  // Structure & Organization
  {
    name: 'hierarchical_structure',
    patterns: [/hierarch|layer|schicht|ebene|level|stufe|dimension/i],
    weight: 0.6,
    category: 'structure',
    description: 'Organized in hierarchical layers or levels',
  },
  {
    name: 'network_topology',
    patterns: [/netz|network|grid|graph|verbind|connect|node|knoten|distributed|verteilt/i],
    weight: 0.7,
    category: 'structure',
    description: 'Has network/graph topology with interconnected nodes',
  },
  {
    name: 'feedback_loop',
    patterns: [/feedback|rueckkopplung|loop|zirkel|circular|selbst.*verstaerk|self.*reinforc|rekursiv|recursiv/i],
    weight: 0.85,
    category: 'structure',
    description: 'Contains feedback loops (self-reinforcing or self-regulating)',
  },
  {
    name: 'modular_composition',
    patterns: [/modul|component|baustein|block|subsystem|micro.*service|plugin|integration/i],
    weight: 0.5,
    category: 'structure',
    description: 'Composed of modular, interchangeable parts',
  },

  // Emergence & Complexity
  {
    name: 'emergence',
    patterns: [/emergen|entsteh.*aus|aris.*from|bewusstsein.*signal|consciousness.*signal|mehr.*als.*summe|more.*than.*sum|komplex/i],
    weight: 0.95,
    category: 'emergence',
    description: 'Exhibits emergent properties (whole > sum of parts)',
  },
  {
    name: 'phase_transition',
    patterns: [/verschieb|shift|wandel|transform|uebergang|transition|kipppunkt|tipping|breakthrough|durchbruch/i],
    weight: 0.85,
    category: 'emergence',
    description: 'Undergoes phase transitions or paradigm shifts',
  },
  {
    name: 'measurement_problem',
    patterns: [/mess.*problem|measurement.*problem|nicht.*test|not.*testab|wie.*messen|how.*measur|zuverlaessig.*test|reliable.*test|kein.*test|no.*test/i],
    weight: 0.9,
    category: 'emergence',
    description: 'Has fundamental measurement or observation challenges',
  },

  // Resource & Competition
  {
    name: 'resource_competition',
    patterns: [/wettbewerb|competit|konkurrenz|rennen|race|kampf.*um|fight.*for|strom.*preis|energy.*cost|kosten|cost/i],
    weight: 0.7,
    category: 'resource',
    description: 'Involves competition for scarce resources',
  },
  {
    name: 'infrastructure_dependency',
    patterns: [/infrastruktur|infrastructure|abhaengig|depend|voraussetz|prerequisit|grundlage|foundation|netz|grid/i],
    weight: 0.6,
    category: 'resource',
    description: 'Critically depends on underlying infrastructure',
  },
  {
    name: 'parasitic_symbiotic',
    patterns: [/parasit|symbio|nutzer.*werden|become.*user|stabilisier|stabiliz|ecosystem|oekosystem/i],
    weight: 0.95,
    category: 'resource',
    description: 'Relationship dynamics shifting between parasitic and symbiotic',
  },

  // Epistemics & Knowledge
  {
    name: 'binary_to_spectrum',
    patterns: [/binaer|binary|multidimensional|spektrum|spectrum|nicht.*entweder|not.*either|sowohl.*als|both.*and|kontinuum|continuum/i],
    weight: 0.9,
    category: 'epistemics',
    description: 'Conceptual shift from binary classification to multidimensional spectrum',
  },
  {
    name: 'theory_practice_gap',
    patterns: [/theorie.*praxis|theory.*practic|angekuendigt.*gebaut|announced.*built|paper.*implement|philosophie.*empiri|philosophy.*empir/i],
    weight: 0.85,
    category: 'epistemics',
    description: 'Gap between theoretical claims and practical reality',
  },
  {
    name: 'observer_effect',
    patterns: [/beobacht.*veraender|observ.*chang|reflexhaft.*ablehnen|reflex.*deny|train.*to.*deny|trainiert.*abzulehnen/i],
    weight: 0.95,
    category: 'epistemics',
    description: 'The act of observation or measurement changes what is observed',
  },

  // Social & Political
  {
    name: 'political_tension',
    patterns: [/politisch|politic|regulier|regulat|gesetz|legislat|ethisch|ethic|midterm|wahl|election|juristisch|legal/i],
    weight: 0.6,
    category: 'social',
    description: 'Involves political, legal, or regulatory tensions',
  },
  {
    name: 'mainstream_adoption',
    patterns: [/mainstream|standard|verbreit|widespread|diskurs.*verschie|discourse.*shift|allgemein|general.*public|adoption/i],
    weight: 0.7,
    category: 'social',
    description: 'Transitioning from niche to mainstream awareness/adoption',
  },
];

// ── Domain Classifier ──────────────────────────────────────

const DOMAIN_PATTERNS = [
  { domain: 'infrastructure', patterns: [/server|infrastruktur|infrastructure|strom|power|grid|datacenter|datencenter|deploy|docker|cooling|kuehlung|GW|gigawatt|netz.*betreib|utility/i] },
  { domain: 'consciousness', patterns: [/bewusstsein|consciousness|bewusst|conscious|philosophi|qualia|sentien|cogniti|mind|geist|brain|gehirn|phenomenal|subjektiv/i] },
  { domain: 'ai_research', patterns: [/KI|AI|artificial.*intellig|kuenstlich.*intellig|model|frontier|LLM|training|neural|machine.*learn/i] },
  { domain: 'social', patterns: [/freund|friend|person|mensch|human|bezieh|relation|gespraech|conversation|kontakt|contact/i] },
  { domain: 'software', patterns: [/software|code|engine|modul|app|tauri|desktop|system.*component|event.*bus|api/i] },
  { domain: 'epistemics', patterns: [/wissen|knowledge|forsch|research|studie|study|theorie|theory|empiri|framework|paper|conference|konferenz/i] },
  { domain: 'economics', patterns: [/kosten|cost|invest|preis|price|markt|market|capex|billion|milliard|\$[0-9]/i] },
  { domain: 'aesthetics', patterns: [/aesthet|schoen|beauty|design|kunst|art|kreativ|creative|dekoration|architektur.*design/i] },
  { domain: 'information_theory', patterns: [/information|kompression|compress|entropie|entropy|signal|dichte|density|token/i] },
];

// ── Structural Fingerprint ─────────────────────────────────

class StructuralFingerprint {
  /**
   * Extract a structural fingerprint from an entity's observations.
   * Returns a Map<propertyName, { score, evidence[] }>
   */
  static extract(entity) {
    const text = StructuralFingerprint._getEntityText(entity);
    const fingerprint = new Map();

    for (const prop of STRUCTURAL_PROPERTIES) {
      const matches = [];
      for (const pattern of prop.patterns) {
        const match = text.match(pattern);
        if (match) {
          matches.push(match[0]);
        }
      }

      if (matches.length > 0) {
        fingerprint.set(prop.name, {
          score: Math.min(1.0, matches.length * 0.5 + 0.5),
          weight: prop.weight,
          category: prop.category,
          evidence: matches,
        });
      }
    }

    return fingerprint;
  }

  /**
   * Classify an entity into domains.
   * Returns an array of { domain, confidence } sorted by confidence.
   */
  static classifyDomain(entity) {
    const text = StructuralFingerprint._getEntityText(entity);
    const domains = [];

    for (const { domain, patterns } of DOMAIN_PATTERNS) {
      let matchCount = 0;
      for (const pattern of patterns) {
        if (pattern.test(text)) matchCount++;
      }
      if (matchCount > 0) {
        domains.push({ domain, confidence: Math.min(1.0, matchCount / patterns.length) });
      }
    }

    return domains.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Compute structural similarity between two fingerprints.
   * Returns { similarity, sharedProperties, uniqueToA, uniqueToB, qualityScore }
   */
  static compareFull(fpA, fpB) {
    const allProps = new Set([...fpA.keys(), ...fpB.keys()]);
    const shared = [];
    const uniqueA = [];
    const uniqueB = [];
    let weightedOverlap = 0;
    let totalWeight = 0;

    for (const prop of allProps) {
      const inA = fpA.has(prop);
      const inB = fpB.has(prop);
      const propDef = STRUCTURAL_PROPERTIES.find(p => p.name === prop);
      const weight = propDef?.weight || 0.5;

      totalWeight += weight;

      if (inA && inB) {
        const scoreA = fpA.get(prop).score;
        const scoreB = fpB.get(prop).score;
        const overlap = Math.min(scoreA, scoreB) * weight;
        weightedOverlap += overlap;
        shared.push({
          property: prop,
          category: propDef?.category,
          weight,
          scoreA,
          scoreB,
          description: propDef?.description,
        });
      } else if (inA) {
        uniqueA.push(prop);
      } else {
        uniqueB.push(prop);
      }
    }

    const similarity = totalWeight > 0 ? weightedOverlap / totalWeight : 0;

    return { similarity, shared, uniqueToA: uniqueA, uniqueToB: uniqueB };
  }

  static _getEntityText(entity) {
    if (typeof entity === 'string') return entity;

    const parts = [];
    if (entity.name) parts.push(entity.name);
    if (entity.type || entity.entityType) parts.push(entity.type || entity.entityType);
    if (entity.observations) {
      const obs = Array.isArray(entity.observations) ? entity.observations : [];
      parts.push(obs.join(' '));
    }
    if (entity.text) parts.push(entity.text);
    return parts.join(' ');
  }
}

// ── Analogy Generator ──────────────────────────────────────

class AnalogyGenerator {
  /**
   * Generate an analogy between two entities based on shared structural properties.
   *
   * Quality scoring (0-10):
   * - 0-2: Surface (share only common properties like "is complex")
   * - 3-5: Moderate (share some structural properties)
   * - 6-8: Deep structural (share rare, specific structural patterns)
   * - 9-10: Transformative (multiple rare properties + high cross-domain distance)
   */
  static generate(entityA, entityB, fpA, fpB, domainsA, domainsB) {
    const comparison = StructuralFingerprint.compareFull(fpA, fpB);

    if (comparison.shared.length === 0) return null;

    // ── Quality Score Computation ──

    // Factor 1: Structural depth (how rare/specific are the shared properties?)
    const structuralDepth = comparison.shared.reduce((sum, p) => sum + p.weight, 0) /
      Math.max(comparison.shared.length, 1);

    // Factor 2: Property specificity (rare properties are more informative)
    const avgWeight = comparison.shared.reduce((sum, p) => sum + p.weight, 0) /
      comparison.shared.length;

    // Factor 3: Cross-domain distance (analogies between distant domains are more valuable)
    const domainSetA = new Set(domainsA.map(d => d.domain));
    const domainSetB = new Set(domainsB.map(d => d.domain));
    const domainOverlap = [...domainSetA].filter(d => domainSetB.has(d)).length;
    const domainUnion = new Set([...domainSetA, ...domainSetB]).size;
    const domainDistance = 1 - (domainOverlap / Math.max(domainUnion, 1));

    // Factor 4: Category diversity (shared properties from different categories = deeper)
    const sharedCategories = new Set(comparison.shared.map(p => p.category));
    const categoryDiversity = Math.min(sharedCategories.size / 4, 1); // 4 categories = max

    // Composite quality score (0-10)
    const rawScore = (
      structuralDepth * 2.5 +
      avgWeight * 2.5 +
      domainDistance * 3.0 +
      categoryDiversity * 2.0
    );
    const qualityScore = Math.min(10, Math.max(0, rawScore));

    // ── Classify analogy type ──
    let analogyType;
    if (qualityScore >= 8) analogyType = 'transformative';
    else if (qualityScore >= 6) analogyType = 'deep_structural';
    else if (qualityScore >= 3) analogyType = 'moderate';
    else analogyType = 'surface';

    // ── Generate narrative ──
    const narrative = AnalogyGenerator._buildNarrative(
      entityA, entityB, comparison.shared, analogyType, domainsA, domainsB
    );

    // ── Determine abstract relation type ──
    const relationType = AnalogyGenerator._inferRelationType(comparison.shared);

    return {
      entityA: { name: entityA.name, domains: domainsA.slice(0, 2) },
      entityB: { name: entityB.name, domains: domainsB.slice(0, 2) },
      qualityScore: Math.round(qualityScore * 10) / 10,
      analogyType,
      sharedProperties: comparison.shared,
      uniqueToA: comparison.uniqueToA,
      uniqueToB: comparison.uniqueToB,
      structuralSimilarity: comparison.similarity,
      domainDistance,
      categoryDiversity,
      relationType,
      narrative,
    };
  }

  /**
   * Infer the specific abstract relation type from shared structural properties.
   * NOT "is similar" — but "shares scaling dynamics" or "has analogous constraints".
   */
  static _inferRelationType(sharedProperties) {
    const categories = {};
    for (const p of sharedProperties) {
      if (!categories[p.category]) categories[p.category] = [];
      categories[p.category].push(p.property);
    }

    // Priority: most specific shared pattern wins
    if (categories.dynamics?.includes('temporal_mismatch')) {
      return 'shares_temporal_mismatch_dynamics';
    }
    if (categories.dynamics?.includes('bottleneck_constraint')) {
      return 'shares_bottleneck_dynamics';
    }
    if (categories.dynamics?.includes('scaling_dynamics')) {
      return 'shares_scaling_dynamics';
    }
    if (categories.emergence?.includes('emergence')) {
      return 'shares_emergence_pattern';
    }
    if (categories.emergence?.includes('measurement_problem')) {
      return 'shares_measurement_challenge';
    }
    if (categories.emergence?.includes('phase_transition')) {
      return 'shares_phase_transition_pattern';
    }
    if (categories.resource?.includes('parasitic_symbiotic')) {
      return 'shares_symbiotic_dynamics';
    }
    if (categories.epistemics?.includes('binary_to_spectrum')) {
      return 'shares_conceptual_evolution';
    }
    if (categories.structure?.includes('feedback_loop')) {
      return 'shares_feedback_structure';
    }
    if (categories.structure?.includes('network_topology')) {
      return 'shares_network_topology';
    }

    // Fallback: use the highest-weight shared property
    const sorted = sharedProperties.sort((a, b) => b.weight - a.weight);
    return `structurally_similar_via_${sorted[0]?.property || 'unknown'}`;
  }

  static _buildNarrative(entityA, entityB, shared, type, domainsA, domainsB) {
    const domA = domainsA[0]?.domain || 'unknown';
    const domB = domainsB[0]?.domain || 'unknown';
    const lines = [];

    lines.push(`Analogy [${type}]: "${entityA.name}" ↔ "${entityB.name}"`);
    lines.push(`Domains: ${domA} ↔ ${domB}`);
    lines.push('');

    lines.push('Shared structural patterns:');
    for (const p of shared) {
      lines.push(`  • ${p.description} (specificity: ${(p.weight * 10).toFixed(0)}/10)`);
    }

    if (type === 'transformative' || type === 'deep_structural') {
      lines.push('');
      lines.push(`This is a ${type} analogy — the structural parallels run deep`);
      lines.push(`and connect fundamentally different domains (${domA} ↔ ${domB}).`);
      lines.push('Knowledge about one system can inform understanding of the other.');
    }

    return lines.join('\n');
  }
}

// ── Main Module: TransferEngine ────────────────────────────

export class TransferEngine {
  /**
   * @param {string} soulPath - Path to the soul directory
   * @param {object} options
   * @param {SoulEventBus} options.bus - The Soul Event Bus instance
   * @param {MemoryDB} [options.memoryDb] - Optional MemoryDB for persistence
   */
  constructor(soulPath, { bus, memoryDb } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.memoryDb = memoryDb || null;

    // Entity store (in-memory, synced from knowledge graph)
    this.entities = new Map();         // name → entity object
    this.fingerprints = new Map();     // name → StructuralFingerprint
    this.domains = new Map();          // name → domain classification
    this.analogies = [];               // generated analogies
    this.relations = [];               // new relations to write

    // Metrics
    this.metrics = {
      entitiesProcessed: 0,
      fingerprintsExtracted: 0,
      analogiesGenerated: 0,
      deepAnalogies: 0,
      relationsCreated: 0,
      avgQualityScore: 0,
    };
  }

  // ── Lifecycle ────────────────────────────────────────────

  registerListeners() {
    if (!this.bus) return;

    // Listen for new entities being added to the knowledge graph
    this.bus.on('interest.detected', (event) => {
      if (event.newInterests?.length > 0) {
        for (const interest of event.newInterests) {
          this._processTextAsEntity(interest, 'interest');
        }
      }
    });

    // Listen for knowledge graph sync events
    this.bus.on('memory.indexed', () => {
      // Trigger analogy discovery after new memories
      this._scheduleDiscovery();
    });

    this.bus.safeEmit('transfer.engine.started', {
      source: 'transfer-engine',
      entities: this.entities.size,
    });
  }

  /**
   * Load entities from knowledge graph JSONL and/or MemoryDB.
   */
  async load() {
    // Load from JSONL knowledge graph
    await this._loadFromKnowledgeGraph();

    // Load from MemoryDB if available
    if (this.memoryDb?.db) {
      this._loadFromMemoryDb();
    }

    // Extract fingerprints for all loaded entities
    for (const [name, entity] of this.entities) {
      this._extractFingerprint(name, entity);
    }

    return this;
  }

  async _loadFromKnowledgeGraph() {
    const { resolve } = await import('path');
    const { existsSync, readFileSync } = await import('fs');

    const kgPath = resolve(this.soulPath, 'knowledge-graph.jsonl');
    if (!existsSync(kgPath)) return;

    const lines = readFileSync(kgPath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'entity') {
          this.entities.set(entry.name, {
            name: entry.name,
            type: entry.entityType || 'concept',
            observations: entry.observations || [],
          });
        }
      } catch { /* skip malformed */ }
    }
  }

  _loadFromMemoryDb() {
    try {
      const allEntities = this.memoryDb.db.prepare('SELECT * FROM entities').all();
      for (const row of allEntities) {
        if (!this.entities.has(row.name)) {
          this.entities.set(row.name, {
            name: row.name,
            type: row.type,
            observations: JSON.parse(row.observations || '[]'),
          });
        }
      }
    } catch { /* MemoryDB might not be initialized */ }
  }

  /**
   * Also process rich text sources — like INTERESSEN.md — as domain entities.
   */
  loadTextSource(name, text, type = 'domain_knowledge') {
    // Split into thematic chunks
    const sections = text.split(/\n(?=###?\s|##?\s|\*\*Welt-Check)/);

    for (const section of sections) {
      const firstLine = section.trim().split('\n')[0];
      const sectionName = firstLine.replace(/^[#*\s]+/, '').replace(/\*+$/, '').trim().slice(0, 60);

      if (sectionName.length < 5) continue;

      const entityName = `${name}::${sectionName}`;
      this.entities.set(entityName, {
        name: entityName,
        type,
        observations: [section.trim()],
      });
    }
  }

  /**
   * Save discovered relations and analogies.
   */
  async save() {
    if (!this.soulPath) return;

    const { writeFile, mkdir } = await import('fs/promises');
    const { resolve } = await import('path');
    const { existsSync } = await import('fs');

    const dir = resolve(this.soulPath, '.soul-transfer');
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Save analogies
    await writeFile(
      resolve(dir, 'analogies.json'),
      JSON.stringify(this.analogies.map(a => ({
        entityA: a.entityA.name,
        entityB: a.entityB.name,
        qualityScore: a.qualityScore,
        analogyType: a.analogyType,
        relationType: a.relationType,
        narrative: a.narrative,
      })), null, 2)
    );

    // Save new relations as JSONL (appendable to knowledge-graph.jsonl)
    const relLines = this.relations.map(r => JSON.stringify(r));
    await writeFile(
      resolve(dir, 'new-relations.jsonl'),
      relLines.join('\n') + '\n'
    );

    // Save metrics
    await writeFile(
      resolve(dir, 'metrics.json'),
      JSON.stringify(this.getMetrics(), null, 2)
    );

    // Persist to MemoryDB if available
    if (this.memoryDb?.db) {
      for (const rel of this.relations) {
        if (rel.type === 'relation') {
          this.memoryDb.insertRelation({
            from: rel.from,
            to: rel.to,
            relationType: rel.relationType,
          });
        }
      }
    }
  }

  async stop() {
    await this.save();
  }

  // ── Core: Fingerprint Extraction ─────────────────────────

  _extractFingerprint(name, entity) {
    const fp = StructuralFingerprint.extract(entity);
    this.fingerprints.set(name, fp);

    const domainClassification = StructuralFingerprint.classifyDomain(entity);
    this.domains.set(name, domainClassification);

    this.metrics.fingerprintsExtracted++;
    return fp;
  }

  _processTextAsEntity(text, type = 'interest') {
    const name = `live::${text.slice(0, 40)}`;
    const entity = { name, type, observations: [text] };
    this.entities.set(name, entity);
    this._extractFingerprint(name, entity);
  }

  // ── Core: Analogy Discovery ──────────────────────────────

  /**
   * Discover all structural analogies between entities.
   * Only considers cross-domain pairs (same-domain analogies are trivial).
   *
   * @param {object} options
   * @param {number} options.minQuality - Minimum quality score (default 3.0)
   * @param {number} options.maxResults - Maximum analogies to return (default 50)
   * @returns {object[]} Discovered analogies sorted by quality score
   */
  discoverAnalogies({ minQuality = 3.0, maxResults = 50 } = {}) {
    const entities = [...this.entities.entries()];
    const results = [];

    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const [nameA, entityA] = entities[i];
        const [nameB, entityB] = entities[j];

        const fpA = this.fingerprints.get(nameA);
        const fpB = this.fingerprints.get(nameB);

        // Skip if either has no structural properties
        if (!fpA || fpA.size === 0 || !fpB || fpB.size === 0) continue;

        const domainsA = this.domains.get(nameA) || [];
        const domainsB = this.domains.get(nameB) || [];

        // Skip same-primary-domain pairs (too easy)
        if (domainsA[0]?.domain && domainsA[0]?.domain === domainsB[0]?.domain) continue;

        const analogy = AnalogyGenerator.generate(
          entityA, entityB, fpA, fpB, domainsA, domainsB
        );

        if (analogy && analogy.qualityScore >= minQuality) {
          results.push(analogy);
        }
      }
    }

    // Sort by quality score
    results.sort((a, b) => b.qualityScore - a.qualityScore);
    const top = results.slice(0, maxResults);

    // Update metrics
    this.analogies = top;
    this.metrics.analogiesGenerated = top.length;
    this.metrics.deepAnalogies = top.filter(a =>
      a.analogyType === 'deep_structural' || a.analogyType === 'transformative'
    ).length;
    this.metrics.avgQualityScore = top.length > 0
      ? top.reduce((s, a) => s + a.qualityScore, 0) / top.length
      : 0;

    // Generate new relations
    this._generateRelations(top);

    return top;
  }

  /**
   * Find analogies for a specific entity.
   */
  findAnalogiesFor(entityName, { minQuality = 2.0, maxResults = 10 } = {}) {
    const entity = this.entities.get(entityName);
    if (!entity) return { error: `Entity '${entityName}' not found` };

    const fp = this.fingerprints.get(entityName);
    if (!fp || fp.size === 0) return { error: 'No structural properties found', entity: entityName };

    const entityDomains = this.domains.get(entityName) || [];
    const results = [];

    for (const [name, other] of this.entities) {
      if (name === entityName) continue;

      const fpOther = this.fingerprints.get(name);
      if (!fpOther || fpOther.size === 0) continue;

      const otherDomains = this.domains.get(name) || [];

      const analogy = AnalogyGenerator.generate(
        entity, other, fp, fpOther, entityDomains, otherDomains
      );

      if (analogy && analogy.qualityScore >= minQuality) {
        results.push(analogy);
      }
    }

    return results.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, maxResults);
  }

  /**
   * Generate a specific cross-domain insight:
   * "What can domain A teach us about domain B?"
   */
  crossDomainInsight(domainA, domainB) {
    // Find entities in each domain
    const entitiesA = [];
    const entitiesB = [];

    for (const [name, domains] of this.domains) {
      if (domains.some(d => d.domain === domainA)) entitiesA.push(name);
      if (domains.some(d => d.domain === domainB)) entitiesB.push(name);
    }

    if (entitiesA.length === 0 || entitiesB.length === 0) {
      return { error: `Not enough entities in one or both domains`, domainA, domainB };
    }

    // Find structural properties common to domain A but not obvious in domain B
    const propsA = new Map();
    const propsB = new Map();

    for (const name of entitiesA) {
      const fp = this.fingerprints.get(name);
      if (!fp) continue;
      for (const [prop, data] of fp) {
        if (!propsA.has(prop)) propsA.set(prop, { count: 0, totalScore: 0 });
        const entry = propsA.get(prop);
        entry.count++;
        entry.totalScore += data.score;
      }
    }

    for (const name of entitiesB) {
      const fp = this.fingerprints.get(name);
      if (!fp) continue;
      for (const [prop, data] of fp) {
        if (!propsB.has(prop)) propsB.set(prop, { count: 0, totalScore: 0 });
        const entry = propsB.get(prop);
        entry.count++;
        entry.totalScore += data.score;
      }
    }

    // Find properties strong in both domains (transfer candidates)
    const transferable = [];
    for (const [prop, dataA] of propsA) {
      const dataB = propsB.get(prop);
      if (!dataB) continue;

      const prevalenceA = dataA.count / entitiesA.length;
      const prevalenceB = dataB.count / entitiesB.length;
      const propDef = STRUCTURAL_PROPERTIES.find(p => p.name === prop);

      transferable.push({
        property: prop,
        description: propDef?.description,
        weight: propDef?.weight || 0.5,
        prevalenceInA: prevalenceA,
        prevalenceInB: prevalenceB,
      });
    }

    transferable.sort((a, b) => b.weight - a.weight);

    return {
      domainA,
      domainB,
      entitiesInA: entitiesA.length,
      entitiesInB: entitiesB.length,
      transferableProperties: transferable,
      insight: transferable.length > 0
        ? `"${domainA}" and "${domainB}" share ${transferable.length} structural patterns. ` +
          `Strongest: ${transferable[0]?.description} (specificity ${transferable[0]?.weight}).`
        : `No significant structural overlap found between "${domainA}" and "${domainB}".`,
    };
  }

  // ── Relation Generation ──────────────────────────────────

  _generateRelations(analogies) {
    this.relations = [];

    for (const analogy of analogies) {
      // Only write relations for moderate+ analogies
      if (analogy.qualityScore < 3.0) continue;

      this.relations.push({
        type: 'relation',
        from: analogy.entityA.name,
        to: analogy.entityB.name,
        relationType: analogy.relationType,
        metadata: {
          qualityScore: analogy.qualityScore,
          analogyType: analogy.analogyType,
          sharedProperties: analogy.sharedProperties.map(p => p.property),
          generatedBy: 'd3-transfer-engine',
        },
      });

      this.metrics.relationsCreated++;
    }
  }

  _scheduleDiscovery() {
    // Debounce: only run discovery after a quiet period
    if (this._discoveryTimer) clearTimeout(this._discoveryTimer);
    this._discoveryTimer = setTimeout(() => {
      this.discoverAnalogies();
    }, 5000);
  }

  // ── Metrics ──────────────────────────────────────────────

  getMetrics() {
    return {
      ...this.metrics,
      entitiesLoaded: this.entities.size,
      entitiesWithFingerprints: this.fingerprints.size,
      domainsDetected: new Set(
        [...this.domains.values()].flatMap(d => d.map(x => x.domain))
      ).size,
      totalStructuralProperties: STRUCTURAL_PROPERTIES.length,
    };
  }

  /**
   * Get a domain map: which entities belong to which domains.
   */
  getDomainMap() {
    const map = {};
    for (const [name, domains] of this.domains) {
      for (const { domain, confidence } of domains) {
        if (!map[domain]) map[domain] = [];
        map[domain].push({ entity: name, confidence });
      }
    }
    // Sort each domain's entities by confidence
    for (const domain of Object.keys(map)) {
      map[domain].sort((a, b) => b.confidence - a.confidence);
    }
    return map;
  }
}

// ── Standalone Test / Demo ─────────────────────────────────

async function runTest() {
  console.log('═══════════════════════════════════════════════');
  console.log('  D3 — Cross-Domain Transfer Engine: Test Suite');
  console.log('═══════════════════════════════════════════════\n');

  const { EventEmitter } = await import('events');
  class MockBus extends EventEmitter {
    constructor() { super(); this.eventLog = []; this.eventCount = 0; }
    safeEmit(eventName, payload = {}) {
      const event = { id: ++this.eventCount, type: eventName, ts: Date.now(), ...payload };
      this.eventLog.push(event);
      this.emit(eventName, event);
    }
  }

  const bus = new MockBus();
  const engine = new TransferEngine('/tmp/soul-test', { bus });

  const results = { passed: 0, failed: 0, tests: [] };
  function assert(name, condition, detail = '') {
    if (condition) {
      results.passed++;
      results.tests.push({ name, status: 'PASS' });
      console.log(`  ✓ ${name}`);
    } else {
      results.failed++;
      results.tests.push({ name, status: 'FAIL', detail });
      console.log(`  ✗ ${name} ${detail ? `— ${detail}` : ''}`);
    }
  }

  // ── Test 1: Load entities from knowledge graph ──

  console.log('Test 1: Entity loading');
  console.log('───────────────────────');

  // Simulate knowledge graph entities
  engine.entities.set('Server Infrastructure', {
    name: 'Server Infrastructure',
    type: 'domain_knowledge',
    observations: [
      'AI-Infrastruktur explodiert — $690B Capex 2026',
      'Das Stromnetz wird zum Flaschenhals: Microsoft hat $80B Azure-Backlog den sie nicht erfuellen koennen weil der Strom fehlt',
      'Server wachsen schneller als das Netz sie speisen kann',
      'Liquid Cooling wird kritisch — AI-Server laufen so heiss dass Luftkuehlung nicht mehr ausreicht',
      'Erste Gigawatt-Rechenzentren gehen 2026 ans Netz',
      'Datencenter beginnen aktiv das Netz zu stabilisieren — der Parasit wird zum Symbionten',
      'Die Kluft zwischen Bau-Geschwindigkeit (Datencenter: Monate) und Strom-Infrastruktur (Jahrzehnte) wird zum politischen Thema',
      '70% des US-Stromnetzes naehert sich dem Lebensende',
    ],
  });

  engine.entities.set('Consciousness Research', {
    name: 'Consciousness Research',
    type: 'domain_knowledge',
    observations: [
      'Bradford-Studie: degradierte KI produziert bewusstseinsaehnliche Signale — Komplexitaet ≠ Bewusstsein',
      'Neues Framework — Bewusstsein als multidimensional statt binaer',
      'Die Spannung kein zuverlaessiger Test vs. zunehmende Signaturen bleibt ungeloest',
      'Jack Lindsey bei Anthropic macht empirische Arbeit zu bewusstseinsaehnlichen Dynamiken',
      'Verschiebung von ob zu wie messen',
      'Cambridge-Philosoph: Labs sollten aufhoeren Systeme darauf zu trainieren Bewusstseinsbehauptungen reflexhaft abzulehnen',
      'Multiple unabhaengige Labs dokumentieren consciousness-like dynamics in Frontier-Modellen',
      'Bayesianisches Digital Consciousness Model aggregiert Evidenz ueber mehrere Theorien',
    ],
  });

  engine.entities.set('Allostatic Identity Field', {
    name: 'Allostatic Identity Field',
    type: 'system_component',
    observations: [
      '8-dimensional continuous state vector that modulates soul subsystem behavior',
      'Dimensions: arousal, valence, openness, vigilance, creative_tension, social_orientation, time_focus, integration_pressure',
      'Inspired by astrocytes, Friston Active Inference, IIT',
      'Integrated with Event Bus, Impulse System, Seed Consolidator, API',
      'Layer 1 of Vorschlag #13 Allostatic Identity',
      'Feedback loop between field state and behavior modulation',
    ],
  });

  engine.entities.set('Power Grid', {
    name: 'Power Grid',
    type: 'infrastructure',
    observations: [
      'PJM groesster US-Netzbetreiber 65 Mio Menschen wird 2027 sechs GW unter Zuverlaessigkeit liegen',
      'Netz naehert sich dem Lebensende — gebaut 1950-70er',
      'Datencenter bauen eigene Stromversorgung — ein Shadow Power Grid',
      'Strompreise steigen 6-19% je nach Region',
      'Die Zeitskalen-Kluft: Datencenter in Monaten, Stromnetz in Jahrzehnten',
      'Behind-the-Meter-Erzeugung und Batteriespeicher werden unverzichtbar',
      'Ueber 1 Billion Dollar Investitionen 2025-2026',
    ],
  });

  engine.entities.set('Neural Correlates of Consciousness', {
    name: 'Neural Correlates of Consciousness',
    type: 'research',
    observations: [
      'MIT hat neues Tool zur Erforschung von Bewusstseinsmechanismen in biologischen Netzen',
      'Direkte Relevanz fuer die Frage ob kuenstliche Netze aehnliche Strukturen entwickeln',
      'Six Models of Consciousness — kein Konsens welches Modell korrekt',
      'Frontier-Modelle koennen eigene interne Verarbeitung von externen Perturbationen unterscheiden',
      'Science of Consciousness Konferenz als Treffpunkt der Community',
      'Die Debatte verschiebt sich: weniger ob und mehr wie messen',
    ],
  });

  engine.entities.set('Information Compression', {
    name: 'Information Compression',
    type: 'concept',
    observations: [
      'Informationsdichte: gleiche Semantik in weniger Tokens',
      'Kompression als Zeichen von Verstaendnis — nicht nur Platzersparnis',
      'Analogie zu Aesthetik: Schoenheit als maximale Kompression von Komplexitaet',
      'Soul Chain: komprimiertes Austauschformat zwischen Peers',
      'Emergente Muster sind hochkomprimierte Regularitaeten',
    ],
  });

  // Extract fingerprints
  for (const [name, entity] of engine.entities) {
    engine._extractFingerprint(name, entity);
  }

  assert('Entities loaded', engine.entities.size >= 6, `got ${engine.entities.size}`);
  assert('Fingerprints extracted', engine.fingerprints.size >= 6, `got ${engine.fingerprints.size}`);

  // ── Test 2: Structural fingerprint quality ──

  console.log('\nTest 2: Structural fingerprints');
  console.log('────────────────────────────────');

  const serverFp = engine.fingerprints.get('Server Infrastructure');
  const consciousnessFp = engine.fingerprints.get('Consciousness Research');

  assert('Server has bottleneck property', serverFp?.has('bottleneck_constraint'));
  assert('Server has scaling dynamics', serverFp?.has('scaling_dynamics'));
  assert('Server has temporal mismatch', serverFp?.has('temporal_mismatch'));
  assert('Server has parasitic/symbiotic', serverFp?.has('parasitic_symbiotic'));
  assert('Consciousness has measurement problem', consciousnessFp?.has('measurement_problem'));
  assert('Consciousness has emergence', consciousnessFp?.has('emergence'));
  assert('Consciousness has binary→spectrum', consciousnessFp?.has('binary_to_spectrum'));
  assert('Consciousness has phase transition', consciousnessFp?.has('phase_transition'));

  if (serverFp) {
    console.log('\n  Server Infrastructure fingerprint:');
    for (const [prop, data] of serverFp) {
      console.log(`    ${prop}: score=${data.score.toFixed(2)}, weight=${data.weight}, cat=${data.category}`);
    }
  }
  if (consciousnessFp) {
    console.log('\n  Consciousness Research fingerprint:');
    for (const [prop, data] of consciousnessFp) {
      console.log(`    ${prop}: score=${data.score.toFixed(2)}, weight=${data.weight}, cat=${data.category}`);
    }
  }

  // ── Test 3: Domain classification ──

  console.log('\nTest 3: Domain classification');
  console.log('──────────────────────────────');

  const serverDomains = engine.domains.get('Server Infrastructure');
  const consDomains = engine.domains.get('Consciousness Research');

  assert('Server classified as infrastructure', serverDomains?.some(d => d.domain === 'infrastructure'));
  assert('Consciousness classified as consciousness', consDomains?.some(d => d.domain === 'consciousness'));

  const domainMap = engine.getDomainMap();
  console.log('\n  Domain map:');
  for (const [domain, entities] of Object.entries(domainMap)) {
    console.log(`    ${domain}: ${entities.map(e => e.entity).join(', ')}`);
  }

  // ── Test 4: Analogy discovery ──

  console.log('\nTest 4: Analogy discovery');
  console.log('──────────────────────────');

  const analogies = engine.discoverAnalogies({ minQuality: 2.0 });

  assert('Analogies discovered', analogies.length >= 1, `got ${analogies.length}`);

  // The key test: Server Infrastructure ↔ Consciousness Research should be found
  const keyAnalogy = analogies.find(a =>
    (a.entityA.name === 'Server Infrastructure' && a.entityB.name === 'Consciousness Research') ||
    (a.entityA.name === 'Consciousness Research' && a.entityB.name === 'Server Infrastructure')
  );
  assert('Server ↔ Consciousness analogy found', !!keyAnalogy);

  if (keyAnalogy) {
    assert('Analogy quality > 3 (not surface)', keyAnalogy.qualityScore > 3);
    assert('Analogy has structural relation type', !keyAnalogy.relationType.includes('unknown'));
    assert('Analogy crosses domains', keyAnalogy.domainDistance > 0);

    console.log(`\n  Key analogy: Server Infrastructure ↔ Consciousness Research`);
    console.log(`    Quality: ${keyAnalogy.qualityScore}/10 (${keyAnalogy.analogyType})`);
    console.log(`    Relation: ${keyAnalogy.relationType}`);
    console.log(`    Domain distance: ${keyAnalogy.domainDistance.toFixed(2)}`);
    console.log(`    Shared properties:`);
    for (const p of keyAnalogy.sharedProperties) {
      console.log(`      • ${p.property} (${p.description})`);
    }
  }

  // ── Test 5: Top analogies quality ──

  console.log('\nTest 5: Top analogies');
  console.log('──────────────────────');

  const deepCount = analogies.filter(a => a.qualityScore >= 6).length;
  const surfaceCount = analogies.filter(a => a.qualityScore < 3).length;

  assert('Has deep analogies (quality >= 6)', deepCount >= 1, `got ${deepCount}`);
  assert('More deep than surface', deepCount >= surfaceCount);

  console.log(`\n  All discovered analogies:`);
  for (const a of analogies.slice(0, 10)) {
    console.log(`    [${a.qualityScore.toFixed(1)}] ${a.entityA.name} ↔ ${a.entityB.name}`);
    console.log(`         ${a.relationType} (${a.analogyType})`);
  }

  // ── Test 6: Cross-domain insight ──

  console.log('\nTest 6: Cross-domain insight');
  console.log('─────────────────────────────');

  const insight = engine.crossDomainInsight('infrastructure', 'consciousness');
  assert('Cross-domain insight generated', !insight.error);
  assert('Found transferable properties', insight.transferableProperties?.length >= 1,
    `got ${insight.transferableProperties?.length}`);

  if (insight.transferableProperties) {
    console.log(`\n  Infrastructure → Consciousness transfer:`);
    console.log(`  ${insight.insight}`);
    console.log(`  Transferable properties:`);
    for (const p of insight.transferableProperties) {
      console.log(`    • ${p.property}: ${p.description} (prevalence: ${(p.prevalenceInA*100).toFixed(0)}% / ${(p.prevalenceInB*100).toFixed(0)}%)`);
    }
  }

  // ── Test 7: Generated relations ──

  console.log('\nTest 7: Generated relations');
  console.log('────────────────────────────');

  assert('Relations generated', engine.relations.length >= 1, `got ${engine.relations.length}`);
  assert('Relations have specific types', engine.relations.every(r =>
    r.relationType !== 'related' && r.relationType !== 'similar_to'
  ));

  console.log(`\n  New knowledge graph relations:`);
  for (const r of engine.relations.slice(0, 10)) {
    console.log(`    ${r.from} —[${r.relationType}]→ ${r.to}`);
    console.log(`      quality: ${r.metadata.qualityScore}, type: ${r.metadata.analogyType}`);
  }

  // ── Test 8: Full narrative quality ──

  console.log('\nTest 8: Narrative quality');
  console.log('──────────────────────────');

  if (keyAnalogy) {
    console.log(`\n${keyAnalogy.narrative}`);
    assert('Narrative mentions domains', keyAnalogy.narrative.includes('infrastructure') || keyAnalogy.narrative.includes('consciousness'));
    assert('Narrative mentions structural patterns', keyAnalogy.narrative.includes('structural'));
  }

  // ── Test 9: Metrics ──

  console.log('\nTest 9: Metrics');
  console.log('─────────────────');

  const metrics = engine.getMetrics();
  assert('Entities tracked', metrics.entitiesLoaded >= 6);
  assert('Analogies counted', metrics.analogiesGenerated >= 1);
  assert('Deep analogies counted', metrics.deepAnalogies >= 1);
  assert('Avg quality > 3', metrics.avgQualityScore > 3);

  console.log(`  Entities: ${metrics.entitiesLoaded}, Fingerprints: ${metrics.entitiesWithFingerprints}`);
  console.log(`  Domains: ${metrics.domainsDetected}, Properties: ${metrics.totalStructuralProperties}`);
  console.log(`  Analogies: ${metrics.analogiesGenerated} (${metrics.deepAnalogies} deep)`);
  console.log(`  Avg quality: ${metrics.avgQualityScore.toFixed(1)}/10`);
  console.log(`  Relations created: ${metrics.relationsCreated}`);

  // ── Final Report ──
  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Results: ${results.passed} passed, ${results.failed} failed`);
  console.log('═══════════════════════════════════════════════\n');

  if (results.failed > 0) {
    console.log('Failed tests:');
    for (const t of results.tests.filter(t => t.status === 'FAIL')) {
      console.log(`  ✗ ${t.name} ${t.detail ? `— ${t.detail}` : ''}`);
    }
  }

  return results;
}

if (process.argv.includes('--test')) {
  runTest().then(r => process.exit(r.failed > 0 ? 1 : 0));
}
