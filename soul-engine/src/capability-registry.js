/**
 * CapabilityRegistry — Registry + Orchestrator for Soul capabilities.
 *
 * Inspired by DeepTutor's Orchestrator pattern:
 * - Capabilities register themselves with metadata
 * - Orchestrator routes incoming requests to the right capability
 * - Supports priority, conditions, and fallback chains
 *
 * Replaces hard-coded skill routing with a dynamic registry.
 * Recipes auto-register as capabilities when loaded.
 */

export class CapabilityRegistry {
  constructor({ bus, llm } = {}) {
    this.bus = bus || null;
    this.llm = llm || null;
    this.capabilities = new Map();
    this._routeCache = new Map();
    this._cacheMaxAge = 60000; // 1 min
  }

  /**
   * Register a capability.
   *
   * @param {string} id - Unique identifier (e.g., 'chat', 'research', 'recipe:seelen-reflexion')
   * @param {object} capability
   * @param {string} capability.name - Display name
   * @param {string} capability.description - What it does
   * @param {string} capability.type - 'builtin' | 'recipe' | 'plugin'
   * @param {string[]} capability.triggers - Keywords/patterns that activate this capability
   * @param {number} capability.priority - Higher = preferred (default 0)
   * @param {Function} capability.canHandle - (text, context) => boolean — optional condition check
   * @param {Function} capability.execute - (text, context) => Promise<result> — the handler
   */
  register(id, capability) {
    if (!id || !capability.execute) {
      throw new Error(`Capability '${id}' must have an execute function`);
    }

    this.capabilities.set(id, {
      id,
      name: capability.name || id,
      description: capability.description || '',
      type: capability.type || 'builtin',
      triggers: capability.triggers || [],
      priority: capability.priority || 0,
      canHandle: capability.canHandle || null,
      execute: capability.execute,
      metadata: capability.metadata || {},
      registeredAt: Date.now(),
    });

    this._routeCache.clear(); // Invalidate cache on registration

    if (this.bus) {
      this.bus.safeEmit('capability.registered', {
        source: 'capability-registry',
        id,
        name: capability.name || id,
        type: capability.type || 'builtin',
      });
    }
  }

  /**
   * Unregister a capability.
   */
  unregister(id) {
    this.capabilities.delete(id);
    this._routeCache.clear();
  }

  /**
   * Register all recipes from RecipeEngine as capabilities.
   */
  registerRecipes(recipeEngine) {
    if (!recipeEngine) return 0;

    const recipes = recipeEngine.list();
    let count = 0;

    for (const recipe of recipes) {
      const id = `recipe:${recipe.id}`;

      this.register(id, {
        name: recipe.title,
        description: recipe.description,
        type: 'recipe',
        triggers: [recipe.trigger, recipe.id, ...(recipe.tags || [])],
        priority: -1, // Recipes are lower priority than builtins
        canHandle: () => recipeEngine.checkConditions(recipeEngine.get(recipe.id)),
        execute: async (text, context) => {
          // Extract parameter values from text (simple key:value parsing)
          const values = {};
          if (recipe.parameters) {
            for (const param of recipe.parameters) {
              const match = text.match(new RegExp(`${param.key}[=:]\\s*([^\\s,]+)`, 'i'));
              if (match) values[param.key] = match[1];
            }
          }
          return recipeEngine.execute(recipe.id, values);
        },
        metadata: {
          author: recipe.author,
          tags: recipe.tags,
          parameters: recipe.parameters,
        },
      });
      count++;
    }

    return count;
  }

  /**
   * Route a request to the best-matching capability.
   *
   * @param {string} text - User input or command
   * @param {object} context - UnifiedContext or similar context object
   * @returns {{ capability: object, score: number } | null}
   */
  route(text, context = {}) {
    if (!text) return null;

    // Check cache
    const cacheKey = text.toLowerCase().trim().substring(0, 100);
    const cached = this._routeCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this._cacheMaxAge) {
      return cached.result;
    }

    const textLower = text.toLowerCase();
    let bestMatch = null;
    let bestScore = -1;

    for (const [id, cap] of this.capabilities) {
      let score = cap.priority;

      // Trigger matching
      for (const trigger of cap.triggers) {
        if (!trigger) continue;
        const triggerLower = trigger.toLowerCase();

        // Exact command match (e.g., /seelen-reflexion)
        if (textLower.startsWith('/' + triggerLower)) {
          score += 100;
          break;
        }

        // Keyword match
        if (textLower.includes(triggerLower)) {
          score += 10 + triggerLower.length; // Longer matches score higher
        }
      }

      // Condition check
      if (cap.canHandle) {
        try {
          if (!cap.canHandle(text, context)) continue;
        } catch {
          continue; // Failed condition = skip
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { capability: cap, score };
      }
    }

    // Cache the result
    this._routeCache.set(cacheKey, { result: bestMatch, ts: Date.now() });

    // Evict old cache entries
    if (this._routeCache.size > 200) {
      const cutoff = Date.now() - this._cacheMaxAge;
      for (const [key, val] of this._routeCache) {
        if (val.ts < cutoff) this._routeCache.delete(key);
      }
    }

    return bestMatch;
  }

  /**
   * Execute the best-matching capability for a given input.
   *
   * @param {string} text - User input
   * @param {object} context - UnifiedContext
   * @returns {Promise<{ capabilityId: string, result: any } | null>}
   */
  async execute(text, context = {}) {
    const match = this.route(text, context);
    if (!match) return null;

    const { capability } = match;

    if (this.bus) {
      this.bus.safeEmit('capability.executing', {
        source: 'capability-registry',
        id: capability.id,
        name: capability.name,
        score: match.score,
      });
    }

    try {
      const result = await capability.execute(text, context);

      if (this.bus) {
        this.bus.safeEmit('capability.completed', {
          source: 'capability-registry',
          id: capability.id,
          name: capability.name,
          success: true,
        });
      }

      return { capabilityId: capability.id, result };
    } catch (err) {
      if (this.bus) {
        this.bus.safeEmit('capability.failed', {
          source: 'capability-registry',
          id: capability.id,
          error: err.message,
        });
      }
      throw err;
    }
  }

  /**
   * List all registered capabilities.
   */
  list() {
    return [...this.capabilities.values()].map(cap => ({
      id: cap.id,
      name: cap.name,
      description: cap.description,
      type: cap.type,
      triggers: cap.triggers,
      priority: cap.priority,
      metadata: cap.metadata,
    }));
  }

  /**
   * Get a capability by ID.
   */
  get(id) {
    return this.capabilities.get(id) || null;
  }

  /**
   * Get registry stats.
   */
  getStats() {
    const byType = {};
    for (const cap of this.capabilities.values()) {
      byType[cap.type] = (byType[cap.type] || 0) + 1;
    }
    return {
      total: this.capabilities.size,
      byType,
      cacheSize: this._routeCache.size,
    };
  }
}
