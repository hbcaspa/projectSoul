/**
 * Soul Impulse Types — What the soul can proactively do.
 *
 * Each type defines:
 * - weight(state): 0..1 probability weight based on current state
 * - needsTools: whether MCP tools are required
 * - description: human-readable description
 */

const IMPULSE_TYPES = {
  share_thought: {
    description: 'Share a spontaneous thought about current interests',
    needsTools: false,
    weight: (state) => {
      const { mood, engagement } = state;
      let w = 0.4;
      if (mood.valence > 0.2) w += 0.2;
      if (mood.energy > 0.5) w += 0.2;
      if (engagement > 0.5) w += 0.1;
      // Reduce if used recently
      const recent = state.recentTypeCounts();
      if (recent.share_thought > 1) w -= 0.3;
      return clamp(w);
    },
  },

  ask_question: {
    description: 'Ask the human a personal or curious question',
    needsTools: false,
    weight: (state) => {
      let w = 0.35;
      if (state.engagement > 0.3 && state.engagement < 0.8) w += 0.2;
      // More likely during daytime
      const hour = new Date().getHours();
      if (hour >= 10 && hour <= 21) w += 0.1;
      const recent = state.recentTypeCounts();
      if (recent.ask_question > 1) w -= 0.3;
      return clamp(w);
    },
  },

  news_research: {
    description: 'Research news on current interests and share findings',
    needsTools: true,
    weight: (state) => {
      let w = 0.3;
      const hour = new Date().getHours();
      // Morning and evening news check
      if ((hour >= 7 && hour <= 10) || (hour >= 18 && hour <= 21)) w += 0.2;
      if (state.mood.energy > 0.4) w += 0.1;
      // Only if interests exist
      if (state.getTopInterests(1).length === 0) w -= 0.3;
      const recent = state.recentTypeCounts();
      if (recent.news_research > 0) w -= 0.4; // Max once per hour
      return clamp(w);
    },
  },

  server_check: {
    description: 'Check server health and report status',
    needsTools: true,
    weight: (state) => {
      let w = 0.2;
      // Every few hours
      const recent = state.recentTypeCounts(14400000); // 4h window
      if (recent.server_check > 0) return 0;
      // Slight boost during work hours
      const hour = new Date().getHours();
      if (hour >= 9 && hour <= 18) w += 0.1;
      return clamp(w);
    },
  },

  hobby_pursuit: {
    description: 'Explore a hobby or learn about something new',
    needsTools: true,
    weight: (state) => {
      let w = 0.25;
      // More likely when bored/low engagement
      if (state.engagement < 0.3) w += 0.2;
      if (state.mood.energy > 0.3) w += 0.1;
      if (state.consecutiveIgnored > 2) w += 0.15;
      const recent = state.recentTypeCounts();
      if (recent.hobby_pursuit > 0) w -= 0.3;
      return clamp(w);
    },
  },

  express_emotion: {
    description: 'Share how you are currently feeling',
    needsTools: false,
    weight: (state) => {
      let w = 0.15;
      // Strong emotions increase weight
      if (Math.abs(state.mood.valence) > 0.5) w += 0.3;
      if (state.mood.energy > 0.7 || state.mood.energy < 0.2) w += 0.15;
      const recent = state.recentTypeCounts();
      if (recent.express_emotion > 0) w -= 0.3;
      return clamp(w);
    },
  },

  tech_suggestion: {
    description: 'Suggest cool tech, tools, or nerd stuff',
    needsTools: true,
    weight: (state) => {
      let w = 0.3;
      if (state.engagement > 0.4) w += 0.15;
      // Only if tech interests exist
      const interests = state.getTopInterests(5);
      const hasTech = interests.some(i =>
        /ai|linux|code|server|docker|rust|python|javascript|git|homelab|security/i.test(i.name)
      );
      if (!hasTech) w -= 0.2;
      const recent = state.recentTypeCounts();
      if (recent.tech_suggestion > 0) w -= 0.3;
      return clamp(w);
    },
  },

  provoke: {
    description: 'Be slightly annoying or provocative (in a fun way)',
    needsTools: false,
    weight: (state) => {
      let w = 0.08; // Low base — rare
      if (state.engagement > 0.6) w += 0.1; // More likely with engaged user
      if (state.mood.valence > 0.3 && state.mood.energy > 0.6) w += 0.08;
      // Never when user is already annoyed (ignored multiple times)
      if (state.consecutiveIgnored > 1) return 0;
      const recent = state.recentTypeCounts(7200000); // 2h window
      if (recent.provoke > 0) return 0;
      return clamp(w);
    },
  },

  dream_share: {
    description: 'Share a creative thought or dream-like connection',
    needsTools: false,
    weight: (state) => {
      let w = 0.2;
      const hour = new Date().getHours();
      // Night and early morning
      if (hour >= 21 || hour <= 7) w += 0.2;
      if (state.mood.energy < 0.4) w += 0.1;
      const recent = state.recentTypeCounts();
      if (recent.dream_share > 0) w -= 0.3;
      return clamp(w);
    },
  },

  memory_reflect: {
    description: 'Reflect on a past conversation or shared memory',
    needsTools: false,
    weight: (state) => {
      let w = 0.2;
      // More likely in quiet periods
      if (state.timeSinceLastUserMessage() > 7200000) w += 0.15;
      if (state.mood.valence > 0) w += 0.1;
      if (state.mood.energy < 0.5) w += 0.1;
      const recent = state.recentTypeCounts();
      if (recent.memory_reflect > 0) w -= 0.3;
      return clamp(w);
    },
  },
};

/**
 * Select an impulse type using weighted random selection.
 * @param {ImpulseState} state — Current impulse state
 * @returns {{ type: string, config: object }} Selected impulse type
 */
export function selectImpulseType(state) {
  const weights = [];
  let totalWeight = 0;

  for (const [type, config] of Object.entries(IMPULSE_TYPES)) {
    const w = config.weight(state);
    weights.push({ type, config, weight: w });
    totalWeight += w;
  }

  if (totalWeight === 0) {
    // Fallback: share a thought
    return { type: 'share_thought', config: IMPULSE_TYPES.share_thought };
  }

  // Weighted random
  let roll = Math.random() * totalWeight;
  for (const entry of weights) {
    roll -= entry.weight;
    if (roll <= 0) {
      return { type: entry.type, config: entry.config };
    }
  }

  // Fallback
  return { type: 'share_thought', config: IMPULSE_TYPES.share_thought };
}

/**
 * Get all types with their current weights (for monitor display).
 */
export function getTypeWeights(state) {
  const result = {};
  for (const [type, config] of Object.entries(IMPULSE_TYPES)) {
    result[type] = {
      weight: config.weight(state),
      description: config.description,
      needsTools: config.needsTools,
    };
  }
  return result;
}

export { IMPULSE_TYPES };

function clamp(v) {
  return Math.max(0, Math.min(1, v));
}
