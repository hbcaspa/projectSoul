/**
 * UnifiedContext — Single identity carrier flowing through all subsystems.
 *
 * Inspired by DeepTutor's UnifiedContext pattern:
 * One object that carries session, memory, history, and identity context
 * through the entire system — replacing scattered state across files.
 *
 * This is NOT a replacement for SoulContext (which loads files).
 * It's a runtime container that aggregates all context needed by any subsystem.
 */

export class UnifiedContext {
  /**
   * @param {object} opts
   * @param {string} opts.sessionId - Current session identifier
   * @param {string} opts.soulName - Soul's name
   * @param {string} opts.language - 'de' or 'en'
   * @param {object} opts.bus - Event bus reference
   */
  constructor({ sessionId, soulName, language = 'de', bus } = {}) {
    this.sessionId = sessionId || null;
    this.soulName = soulName || 'Soul';
    this.language = language;
    this.bus = bus || null;

    // Identity context — loaded from Seed
    this.identity = {
      name: soulName,
      mood: null,
      state: null,
      born: null,
      ageDays: 0,
      sessions: 0,
    };

    // Memory context — aggregated from all memory sources
    this.memory = {
      dailyNotes: '',
      relationships: '',
      recentMemories: [],
      profile: null,       // Auto-built profile (from AutoProfile)
      episodic: [],
      semantic: [],
      emotional: [],
    };

    // History context — conversation state
    this.history = {
      messages: [],
      lastUserMessage: null,
      lastResponse: null,
      turnCount: 0,
    };

    // Session context — lifecycle state
    this.session = {
      number: null,
      state: null,
      startedAt: null,
      checkpoints: {},
      events: [],
    };

    // Capability context — active tools and capabilities
    this.capabilities = {
      activeCapability: null,
      enabledTools: new Set(),
      availableRecipes: [],
    };

    // Runtime metadata
    this._createdAt = Date.now();
    this._lastUpdated = Date.now();
    this._version = 0;
  }

  /**
   * Update identity from parsed seed info.
   */
  updateIdentity(info) {
    if (!info) return this;
    Object.assign(this.identity, {
      name: info.name || this.identity.name,
      mood: info.mood || this.identity.mood,
      born: info.born || this.identity.born,
      ageDays: info.ageDays || this.identity.ageDays,
      sessions: info.sessions || this.identity.sessions,
    });
    this.soulName = this.identity.name;
    this._touch();
    return this;
  }

  /**
   * Update memory context.
   */
  updateMemory(updates) {
    Object.assign(this.memory, updates);
    this._touch();
    return this;
  }

  /**
   * Update session context.
   */
  updateSession(session) {
    if (!session) return this;
    Object.assign(this.session, {
      number: session.number ?? this.session.number,
      state: session.state ?? this.session.state,
      startedAt: session.started_at ?? this.session.startedAt,
    });
    this.sessionId = `session-${this.session.number}`;
    this._touch();
    return this;
  }

  /**
   * Record a conversation turn.
   */
  addTurn(role, text) {
    this.history.messages.push({ role, text, ts: Date.now() });
    if (role === 'user') this.history.lastUserMessage = text;
    if (role === 'model' || role === 'assistant') this.history.lastResponse = text;
    this.history.turnCount++;
    this._touch();
    return this;
  }

  /**
   * Set the active capability (e.g., 'chat', 'research', 'recipe:seelen-reflexion').
   */
  setCapability(name) {
    this.capabilities.activeCapability = name;
    this._touch();
    return this;
  }

  /**
   * Get a minimal snapshot for logging/debugging.
   */
  snapshot() {
    return {
      sessionId: this.sessionId,
      soul: this.identity.name,
      mood: this.identity.mood,
      sessionState: this.session.state,
      turns: this.history.turnCount,
      capability: this.capabilities.activeCapability,
      profileBuilt: !!this.memory.profile,
      version: this._version,
    };
  }

  /**
   * Serialize for cross-process or persistence.
   */
  toJSON() {
    return {
      sessionId: this.sessionId,
      identity: this.identity,
      session: this.session,
      history: {
        turnCount: this.history.turnCount,
        lastUserMessage: this.history.lastUserMessage,
      },
      capabilities: {
        activeCapability: this.capabilities.activeCapability,
      },
      memory: {
        profileBuilt: !!this.memory.profile,
        recentCount: this.memory.recentMemories.length,
      },
      _version: this._version,
      _lastUpdated: this._lastUpdated,
    };
  }

  _touch() {
    this._lastUpdated = Date.now();
    this._version++;
  }
}
