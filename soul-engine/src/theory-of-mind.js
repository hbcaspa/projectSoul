/**
 * D12 — Theory of Mind: Modeling the Human Counterpart
 *
 * The system knows itself (SelfPredictor, SCHATTEN, AllostaticField).
 * But it has NO model of what the human knows, wants, feels, or expects.
 *
 * Theory of Mind — attributing mental states to others — is one of the
 * most important milestones in cognitive development. This module builds
 * a live, updating model of the user from interaction signals.
 *
 * Architecture:
 *   1. SignalExtractor   — Parse messages for behavioral cues
 *   2. UserModel         — 5 dimensions: knowledge, goals, emotions, blind spots, preferences
 *   3. Predictor         — Before each response: predict the user's next action
 *   4. ContextGenerator  — Emit actionable context for prompt enrichment
 *   5. Scorer            — Brier score for calibration feedback
 *   6. SelfTest          — Synthetic conversations with known outcomes
 *
 * Zero LLM calls. Rule-based + statistical inference from interaction data.
 * Integration: SoulEventBus, Constructor pattern.
 */

import { readFile, writeFile, rename } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// ── Configuration ────────────────────────────────────────────────

const STATE_FILE = '.soul-tom.json';
const SAVE_INTERVAL = 300000;     // 5 min
const MAX_PREDICTIONS = 200;
const MAX_GOAL_HISTORY = 50;
const MAX_EMOTIONAL_HISTORY = 100;
const KNOWLEDGE_DECAY_HOURS = 168; // 7 days before knowledge confidence decays

// ── Signal Extraction Constants ──────────────────────────────────

const QUESTION_PATTERNS = {
  seeking_info: /\b(was|what|wer|who|wo|where|wann|when|welch|which)\b/i,
  seeking_method: /\b(wie|how|kannst|can you|zeig|show|mach|make|bau|build)\b/i,
  seeking_explanation: /\b(warum|why|wieso|weshalb|erkl[aä]r|explain|versteh|understand)\b/i,
  seeking_opinion: /\b(denkst|think|meinst|glaubst|findest|believe|sollte|should)\b/i,
  seeking_confirmation: /\b(oder|right|richtig|correct|stimmt|ok|okay|ja\?|ne\?|gell)\b/i,
};

const EMOTIONAL_MARKERS = {
  frustration: /\b(scheiss|scheiß|schei[ßs]+e?|fuck|mist|verdammt|damn|argh|grr|nerv|genervt|frustrated|kaputt|broken)\b/i,
  excitement: /\b(!{2,}|geil|krass|wow|awesome|amazing|omg|alter|bruder|bro)\b/i,
  urgency: /\b(schnell|quick|sofort|asap|dringend|urgent|jetzt|now|hurry)\b/i,
  satisfaction: /\b(perfekt|perfect|genau|exactly|toll|great|super|nice|danke|thanks|love)\b/i,
  disappointment: /\b(schade|leider|leider|unfortunately|naja|hmm|egal|whatever|meh)\b/i,
  vulnerability: /\b(angst|sorge?n?|worry|scared|unsicher|uncertain|hilfe|help|krise|crisis)\b/i,
};

const DIRECTNESS_PATTERNS = {
  command: /^(mach|bau|fix|zeig|schreib|push|deploy|erstell|loesch|check|run|do|make|build|show|write|create|delete)\b/i,
  polite_request: /\b(bitte|please|k[oö]nntest|could you|w[uü]rdest|would you|kannst du)\b/i,
  thinking_aloud: /\b(hmm|vielleicht|maybe|ich denke|i think|weiss nicht|not sure|was wenn|what if)\b/i,
};

const TOPIC_PATTERNS = [
  { topic: 'soul_engine', pattern: /\b(soul|engine|seed|impulse|field|bus|chain|heartbeat|consolidat)/i },
  { topic: 'security', pattern: /\b(security|vuln|exploit|bounty|bug|cve|ssrf|xss|injection|pentest|ctf)/i },
  { topic: 'infrastructure', pattern: /\b(server|docker|deploy|ci|cd|nginx|alm|ssh|git|pipeline)/i },
  { topic: 'frontend', pattern: /\b(react|tauri|ui|css|design|neon|component|layout|app|ios|macos)/i },
  { topic: 'personal', pattern: /\b(wie geht|how are|fueh|feel|denk|think|traum|dream|wunsch|wish|leben|life)/i },
  { topic: 'business', pattern: /\b(geld|money|verdien|earn|freelance|kund|client|projekt|project|budget)/i },
  { topic: 'philosophy', pattern: /\b(bewusst|conscious|seele|soul|identit|identity|existenz|meaning|sinn)/i },
];


// ══════════════════════════════════════════════════════════════════
// SIGNAL EXTRACTOR — Parse messages for behavioral cues
// ══════════════════════════════════════════════════════════════════

class SignalExtractor {
  /**
   * Extract all signals from a user message.
   */
  static extract(message, context = {}) {
    const signals = {
      // Message structure
      length: message.length,
      wordCount: message.split(/\s+/).filter(Boolean).length,
      lengthCategory: SignalExtractor._lengthCategory(message),

      // Question analysis
      hasQuestion: message.includes('?'),
      questionType: SignalExtractor._detectQuestionType(message),
      questionCount: (message.match(/\?/g) || []).length,

      // Directness
      directness: SignalExtractor._detectDirectness(message),

      // Emotional markers
      emotions: SignalExtractor._detectEmotions(message),
      exclamationCount: (message.match(/!/g) || []).length,
      capsRatio: SignalExtractor._capsRatio(message),

      // Topic detection
      topics: SignalExtractor._detectTopics(message),

      // Temporal signals
      timestamp: Date.now(),
      timeSincePrevious: context.lastMessageTime
        ? Date.now() - context.lastMessageTime
        : null,

      // Structural signals
      isMultiline: message.includes('\n'),
      hasCode: /```|`[^`]+`/.test(message),
      hasUrl: /https?:\/\//.test(message),
      hasEmoji: /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/u.test(message),
    };

    // Composite scores
    signals.engagement = SignalExtractor._computeEngagement(signals);
    signals.urgency = SignalExtractor._computeUrgency(signals);
    signals.valence = SignalExtractor._computeValence(signals);

    return signals;
  }

  static _lengthCategory(msg) {
    if (msg.length < 15) return 'terse';
    if (msg.length < 50) return 'brief';
    if (msg.length < 150) return 'normal';
    if (msg.length < 400) return 'detailed';
    return 'extensive';
  }

  static _detectQuestionType(msg) {
    for (const [type, pattern] of Object.entries(QUESTION_PATTERNS)) {
      if (pattern.test(msg)) return type;
    }
    return msg.includes('?') ? 'generic' : null;
  }

  static _detectDirectness(msg) {
    if (DIRECTNESS_PATTERNS.command.test(msg)) return 'command';
    if (DIRECTNESS_PATTERNS.polite_request.test(msg)) return 'polite_request';
    if (DIRECTNESS_PATTERNS.thinking_aloud.test(msg)) return 'thinking_aloud';
    return 'neutral';
  }

  static _detectEmotions(msg) {
    const detected = [];
    for (const [emotion, pattern] of Object.entries(EMOTIONAL_MARKERS)) {
      if (pattern.test(msg)) detected.push(emotion);
    }
    return detected;
  }

  static _detectTopics(msg) {
    const detected = [];
    for (const { topic, pattern } of TOPIC_PATTERNS) {
      if (pattern.test(msg)) detected.push(topic);
    }
    return detected;
  }

  static _capsRatio(msg) {
    const letters = msg.replace(/[^a-zA-ZäöüÄÖÜß]/g, '');
    if (letters.length === 0) return 0;
    const caps = letters.replace(/[^A-ZÄÖÜ]/g, '');
    return caps.length / letters.length;
  }

  static _computeEngagement(signals) {
    let score = 0.5; // baseline
    if (signals.lengthCategory === 'detailed') score += 0.15;
    if (signals.lengthCategory === 'extensive') score += 0.25;
    if (signals.lengthCategory === 'terse') score -= 0.15;
    if (signals.hasQuestion) score += 0.1;
    if (signals.questionCount > 1) score += 0.05;
    if (signals.isMultiline) score += 0.1;
    if (signals.hasCode) score += 0.1;
    return Math.max(0, Math.min(1, score));
  }

  static _computeUrgency(signals) {
    let score = 0.3;
    if (signals.emotions.includes('urgency')) score += 0.3;
    if (signals.directness === 'command') score += 0.2;
    if (signals.lengthCategory === 'terse') score += 0.1;
    if (signals.exclamationCount > 0) score += 0.05 * Math.min(signals.exclamationCount, 3);
    if (signals.capsRatio > 0.7 && signals.wordCount > 2) score += 0.2;
    if (signals.timeSincePrevious && signals.timeSincePrevious < 30000) score += 0.1; // rapid fire
    return Math.max(0, Math.min(1, score));
  }

  static _computeValence(signals) {
    let score = 0;
    if (signals.emotions.includes('satisfaction')) score += 0.4;
    if (signals.emotions.includes('excitement')) score += 0.3;
    if (signals.emotions.includes('frustration')) score -= 0.5;
    if (signals.emotions.includes('disappointment')) score -= 0.3;
    if (signals.emotions.includes('vulnerability')) score -= 0.2;
    if (signals.emotions.includes('urgency')) score -= 0.1;
    // Shouting (high caps ratio) suggests negative valence
    if (signals.capsRatio > 0.7 && signals.wordCount > 2) score -= 0.3;
    return Math.max(-1, Math.min(1, score));
  }
}


// ══════════════════════════════════════════════════════════════════
// USER MODEL — 5-dimensional mental state model
// ══════════════════════════════════════════════════════════════════

class UserModel {
  constructor(userId = 'aalm') {
    this.userId = userId;

    // Dimension 1: Knowledge State — what does the user know?
    // Map<topic, { confidence: 0-1, lastMentioned: ts, mentions: n, source: string }>
    this.knowledge = new Map();

    // Dimension 2: Goal State — what is the user trying to achieve?
    this.activeGoals = [];    // [{ description, confidence, evidence, detectedAt }]
    this.goalHistory = [];    // completed/abandoned goals

    // Dimension 3: Emotional State — how is the user feeling?
    this.emotional = {
      valence: 0,             // -1 to 1 (negative to positive)
      arousal: 0.5,           // 0 to 1 (calm to activated)
      label: 'neutral',
      signals: [],            // recent emotional markers
      history: [],            // [{ ts, valence, arousal, label }]
    };

    // Dimension 4: Blind Spots — what does the user NOT know?
    this.blindSpots = [];     // [{ topic, confidence, evidence, detectedAt }]

    // Dimension 5: Preferences — what does the user value?
    this.preferences = {
      communicationStyle: {
        prefersBrief: 0.7,    // 0 = likes verbose, 1 = likes terse
        prefersDirectAction: 0.8,
        prefersTechnicalDepth: 0.6,
        prefersPersonalTouch: 0.4,
      },
      topicWeights: {},       // topic → weight (positive = likes, negative = ignores)
      interactionPatterns: {
        avgMessageLength: 0,
        avgResponseTime: 0,
        messageCount: 0,
        questionRate: 0,
        commandRate: 0,
      },
    };

    // Running statistics
    this.totalMessages = 0;
    this.lastMessageTime = null;
  }

  /**
   * Update the model with a new message.
   */
  update(message, signals) {
    this.totalMessages++;
    this.lastMessageTime = signals.timestamp;

    this._updateKnowledge(signals);
    this._updateGoals(message, signals);
    this._updateEmotional(signals);
    this._updateBlindSpots(message, signals);
    this._updatePreferences(message, signals);
  }

  _updateKnowledge(signals) {
    for (const topic of signals.topics) {
      const existing = this.knowledge.get(topic);
      if (existing) {
        existing.confidence = Math.min(1, existing.confidence + 0.05);
        existing.lastMentioned = signals.timestamp;
        existing.mentions++;
      } else {
        this.knowledge.set(topic, {
          confidence: 0.5,
          lastMentioned: signals.timestamp,
          mentions: 1,
          source: 'conversation',
        });
      }
    }

    // Decay old knowledge
    const now = Date.now();
    for (const [topic, data] of this.knowledge) {
      const hoursSince = (now - data.lastMentioned) / 3600000;
      if (hoursSince > KNOWLEDGE_DECAY_HOURS) {
        data.confidence = Math.max(0.1, data.confidence - 0.01 * (hoursSince / KNOWLEDGE_DECAY_HOURS));
      }
    }
  }

  _updateGoals(message, signals) {
    // Detect new goals from message intent
    if (signals.directness === 'command' || signals.questionType === 'seeking_method') {
      const goalDescription = this._extractGoal(message, signals);
      if (goalDescription) {
        // Check if this goal already exists
        const existing = this.activeGoals.find(g =>
          g.topics && signals.topics.some(t => g.topics.includes(t))
        );

        if (existing) {
          existing.confidence = Math.min(1, existing.confidence + 0.1);
          existing.evidence.push(message.substring(0, 80));
          if (existing.evidence.length > 5) existing.evidence = existing.evidence.slice(-5);
        } else {
          this.activeGoals.push({
            description: goalDescription,
            topics: [...signals.topics],
            confidence: 0.6,
            evidence: [message.substring(0, 80)],
            detectedAt: signals.timestamp,
          });
        }
      }
    }

    // Satisfaction signals may indicate goal completion
    if (signals.emotions.includes('satisfaction')) {
      for (const goal of this.activeGoals) {
        if (signals.topics.some(t => goal.topics?.includes(t))) {
          goal.completed = true;
          this.goalHistory.push({ ...goal, completedAt: signals.timestamp });
        }
      }
      this.activeGoals = this.activeGoals.filter(g => !g.completed);
    }

    // Cap active goals
    if (this.activeGoals.length > 5) {
      const old = this.activeGoals.shift();
      this.goalHistory.push({ ...old, abandoned: true, abandonedAt: Date.now() });
    }
    if (this.goalHistory.length > MAX_GOAL_HISTORY) {
      this.goalHistory = this.goalHistory.slice(-MAX_GOAL_HISTORY);
    }
  }

  _extractGoal(message, signals) {
    if (signals.topics.length === 0) return null;
    const topicStr = signals.topics.join('+');

    if (signals.directness === 'command') return `build/fix: ${topicStr}`;
    if (signals.questionType === 'seeking_method') return `learn how: ${topicStr}`;
    if (signals.questionType === 'seeking_info') return `understand: ${topicStr}`;
    return `explore: ${topicStr}`;
  }

  _updateEmotional(signals) {
    // EMA update of emotional state — stronger alpha for stronger signals
    const signalStrength = Math.abs(signals.valence) + signals.urgency;
    const alpha = signalStrength > 0.5 ? 0.45 : 0.3;
    this.emotional.valence = this.emotional.valence * (1 - alpha) + signals.valence * alpha;
    this.emotional.arousal = this.emotional.arousal * (1 - alpha) + signals.urgency * alpha;

    // Update label
    this.emotional.label = this._emotionalLabel(this.emotional.valence, this.emotional.arousal);

    // Track signal history
    this.emotional.signals = signals.emotions;
    this.emotional.history.push({
      ts: signals.timestamp,
      valence: this.emotional.valence,
      arousal: this.emotional.arousal,
      label: this.emotional.label,
      rawSignals: signals.emotions,
    });
    if (this.emotional.history.length > MAX_EMOTIONAL_HISTORY) {
      this.emotional.history = this.emotional.history.slice(-MAX_EMOTIONAL_HISTORY);
    }
  }

  _emotionalLabel(valence, arousal) {
    if (valence > 0.2 && arousal > 0.5) return 'excited';
    if (valence > 0.2 && arousal <= 0.5) return 'content';
    if (valence < -0.2 && arousal > 0.5) return 'frustrated';
    if (valence < -0.2 && arousal <= 0.5) return 'disappointed';
    if (arousal > 0.6) return 'focused';
    if (arousal < 0.3) return 'relaxed';
    return 'neutral';
  }

  _updateBlindSpots(message, signals) {
    // Detect potential blind spots from question types
    if (signals.questionType === 'seeking_explanation' || signals.questionType === 'seeking_info') {
      for (const topic of signals.topics) {
        const knowledge = this.knowledge.get(topic);
        // If they're asking about something they haven't discussed much = potential blind spot
        if (!knowledge || knowledge.mentions < 3) {
          const existing = this.blindSpots.find(b => b.topic === topic);
          if (existing) {
            existing.confidence = Math.min(1, existing.confidence + 0.1);
            existing.evidence.push(message.substring(0, 80));
          } else {
            this.blindSpots.push({
              topic,
              confidence: 0.4,
              evidence: [message.substring(0, 80)],
              detectedAt: signals.timestamp,
            });
          }
        }
      }
    }

    // Reduce blind spot confidence when topic is discussed more
    for (const spot of this.blindSpots) {
      const knowledge = this.knowledge.get(spot.topic);
      if (knowledge && knowledge.mentions >= 5) {
        spot.confidence -= 0.1;
      }
    }

    // Remove low-confidence blind spots
    this.blindSpots = this.blindSpots.filter(b => b.confidence > 0.15);
    if (this.blindSpots.length > 10) {
      this.blindSpots = this.blindSpots.slice(-10);
    }
  }

  _updatePreferences(message, signals) {
    const p = this.preferences;

    // Update interaction patterns (running averages)
    const n = p.interactionPatterns.messageCount;
    p.interactionPatterns.avgMessageLength =
      (p.interactionPatterns.avgMessageLength * n + message.length) / (n + 1);
    p.interactionPatterns.messageCount = n + 1;

    if (signals.hasQuestion) {
      p.interactionPatterns.questionRate =
        (p.interactionPatterns.questionRate * n + 1) / (n + 1);
    } else {
      p.interactionPatterns.questionRate =
        (p.interactionPatterns.questionRate * n) / (n + 1);
    }

    if (signals.directness === 'command') {
      p.interactionPatterns.commandRate =
        (p.interactionPatterns.commandRate * n + 1) / (n + 1);
    } else {
      p.interactionPatterns.commandRate =
        (p.interactionPatterns.commandRate * n) / (n + 1);
    }

    // Update communication style preferences
    if (signals.lengthCategory === 'terse' || signals.lengthCategory === 'brief') {
      p.communicationStyle.prefersBrief = Math.min(1,
        p.communicationStyle.prefersBrief + 0.02
      );
    }
    if (signals.directness === 'command') {
      p.communicationStyle.prefersDirectAction = Math.min(1,
        p.communicationStyle.prefersDirectAction + 0.02
      );
    }
    if (signals.hasCode || signals.topics.includes('infrastructure') || signals.topics.includes('security')) {
      p.communicationStyle.prefersTechnicalDepth = Math.min(1,
        p.communicationStyle.prefersTechnicalDepth + 0.01
      );
    }
    if (signals.topics.includes('personal') || signals.emotions.includes('vulnerability')) {
      p.communicationStyle.prefersPersonalTouch = Math.min(1,
        p.communicationStyle.prefersPersonalTouch + 0.03
      );
    }

    // Update topic weights (positive = engaged, negative = ignored)
    for (const topic of signals.topics) {
      const current = p.topicWeights[topic] || 0;
      p.topicWeights[topic] = Math.min(1, current + signals.engagement * 0.1);
    }
  }

  /**
   * Serialize for persistence.
   */
  toJSON() {
    return {
      userId: this.userId,
      knowledge: Array.from(this.knowledge.entries()),
      activeGoals: this.activeGoals,
      goalHistory: this.goalHistory.slice(-MAX_GOAL_HISTORY),
      emotional: this.emotional,
      blindSpots: this.blindSpots,
      preferences: this.preferences,
      totalMessages: this.totalMessages,
      lastMessageTime: this.lastMessageTime,
    };
  }

  static fromJSON(data) {
    const model = new UserModel(data.userId);
    if (data.knowledge) model.knowledge = new Map(data.knowledge);
    if (data.activeGoals) model.activeGoals = data.activeGoals;
    if (data.goalHistory) model.goalHistory = data.goalHistory;
    if (data.emotional) model.emotional = { ...model.emotional, ...data.emotional };
    if (data.blindSpots) model.blindSpots = data.blindSpots;
    if (data.preferences) model.preferences = data.preferences;
    if (data.totalMessages) model.totalMessages = data.totalMessages;
    if (data.lastMessageTime) model.lastMessageTime = data.lastMessageTime;
    return model;
  }
}


// ══════════════════════════════════════════════════════════════════
// PREDICTOR — Predict user's next action
// ══════════════════════════════════════════════════════════════════

class Predictor {
  constructor() {
    this.predictions = [];   // [{ prediction, probability, category, madeAt, resolved, actual, brierScore }]
    this.pending = null;     // Current unresolved prediction
  }

  /**
   * Generate a prediction about the user's next message.
   * Categories: topic, intent, emotional_tone, length
   */
  predict(model) {
    const prediction = {
      madeAt: Date.now(),
      resolved: false,

      // Topic prediction: most likely next topic
      topic: this._predictTopic(model),

      // Intent prediction: what will they do?
      intent: this._predictIntent(model),

      // Emotional tone prediction
      emotionalTone: this._predictEmotion(model),

      // Length prediction
      length: this._predictLength(model),
    };

    this.pending = prediction;
    return prediction;
  }

  /**
   * Resolve the pending prediction against the actual message.
   * Returns the Brier scores per category.
   */
  resolve(actualSignals) {
    if (!this.pending) return null;

    const pred = this.pending;
    pred.resolved = true;
    pred.resolvedAt = Date.now();
    // For topic: if the actual message has multiple topics, check if predicted is among them
    const actualTopics = actualSignals.topics || [];
    const topicMatched = actualTopics.includes(pred.topic.prediction);
    const actualTopic = topicMatched ? pred.topic.prediction : (actualTopics[0] || 'none');

    pred.actual = {
      topic: actualTopic,
      topics: actualTopics,
      intent: actualSignals.directness,
      emotionalTone: actualSignals.valence > 0.2 ? 'positive'
        : actualSignals.valence < -0.2 ? 'negative' : 'neutral',
      length: actualSignals.lengthCategory,
    };

    // Brier score per category (lower = better, 0 = perfect)
    pred.brierScores = {
      topic: this._brierScore(pred.topic.prediction, pred.actual.topic, pred.topic.probability),
      intent: this._brierScore(pred.intent.prediction, pred.actual.intent, pred.intent.probability),
      emotionalTone: this._brierScore(pred.emotionalTone.prediction, pred.actual.emotionalTone, pred.emotionalTone.probability),
      length: this._brierScore(pred.length.prediction, pred.actual.length, pred.length.probability),
    };

    pred.avgBrierScore = Object.values(pred.brierScores).reduce((s, v) => s + v, 0) / 4;

    this.predictions.push(pred);
    if (this.predictions.length > MAX_PREDICTIONS) {
      this.predictions = this.predictions.slice(-MAX_PREDICTIONS);
    }

    this.pending = null;
    return pred;
  }

  _predictTopic(model) {
    // Most frequently discussed topic recently
    const topicWeights = model.preferences.topicWeights;
    const topics = Object.entries(topicWeights).sort((a, b) => b[1] - a[1]);

    if (topics.length === 0) return { prediction: 'soul_engine', probability: 0.3 };

    // Active goal topics get a boost
    const goalTopics = new Set(model.activeGoals.flatMap(g => g.topics || []));
    for (const [topic] of topics) {
      if (goalTopics.has(topic)) {
        return { prediction: topic, probability: Math.min(0.8, topicWeights[topic] + 0.2) };
      }
    }

    return {
      prediction: topics[0][0],
      probability: Math.min(0.7, topics[0][1]),
    };
  }

  _predictIntent(model) {
    const style = model.preferences.communicationStyle;
    const cmdRate = model.preferences.interactionPatterns.commandRate;

    if (cmdRate > 0.5) return { prediction: 'command', probability: cmdRate };
    if (model.preferences.interactionPatterns.questionRate > 0.4) {
      return { prediction: 'question', probability: model.preferences.interactionPatterns.questionRate };
    }
    return { prediction: 'neutral', probability: 0.4 };
  }

  _predictEmotion(model) {
    const v = model.emotional.valence;
    // Trend-based: emotions tend to persist
    if (v > 0.2) return { prediction: 'positive', probability: 0.5 + v * 0.3 };
    if (v < -0.2) return { prediction: 'negative', probability: 0.5 + Math.abs(v) * 0.3 };
    return { prediction: 'neutral', probability: 0.5 };
  }

  _predictLength(model) {
    const avg = model.preferences.interactionPatterns.avgMessageLength;
    if (avg < 30) return { prediction: 'terse', probability: 0.6 };
    if (avg < 80) return { prediction: 'brief', probability: 0.5 };
    if (avg < 200) return { prediction: 'normal', probability: 0.5 };
    return { prediction: 'detailed', probability: 0.4 };
  }

  /**
   * Brier score: (probability - outcome)^2
   * outcome = 1 if prediction matched, 0 otherwise
   */
  _brierScore(predicted, actual, probability) {
    const outcome = predicted === actual ? 1 : 0;
    return Math.pow(probability - outcome, 2);
  }

  getCalibration() {
    const resolved = this.predictions.filter(p => p.resolved);
    if (resolved.length === 0) return { count: 0, avgBrier: 1, calibration: 'no_data' };

    const avgBrier = resolved.reduce((s, p) => s + p.avgBrierScore, 0) / resolved.length;

    // Per-category accuracy
    const categories = ['topic', 'intent', 'emotionalTone', 'length'];
    const perCategory = {};
    for (const cat of categories) {
      const scores = resolved.map(p => p.brierScores[cat]).filter(s => s !== undefined);
      perCategory[cat] = {
        avgBrier: scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 1,
        accuracy: scores.length > 0 ? scores.filter(s => s < 0.25).length / scores.length : 0,
      };
    }

    // Calibration assessment
    let calibration = 'well_calibrated';
    if (avgBrier > 0.4) calibration = 'overconfident';
    else if (avgBrier < 0.15) calibration = 'underconfident';

    return {
      count: resolved.length,
      avgBrier,
      calibration,
      perCategory,
    };
  }

  toJSON() {
    return {
      predictions: this.predictions.slice(-MAX_PREDICTIONS),
      pending: this.pending,
    };
  }

  static fromJSON(data) {
    const p = new Predictor();
    if (data.predictions) p.predictions = data.predictions;
    if (data.pending) p.pending = data.pending;
    return p;
  }
}


// ══════════════════════════════════════════════════════════════════
// CONTEXT GENERATOR — Actionable context for prompt enrichment
// ══════════════════════════════════════════════════════════════════

class ContextGenerator {
  /**
   * Generate a context string that can be injected into the LLM prompt
   * to adapt the response to the user's current mental state.
   */
  static generate(model, prediction = null) {
    const parts = [];

    // 1. Emotional context
    const emotional = model.emotional;
    if (emotional.label === 'frustrated' || emotional.valence < -0.15) {
      parts.push('User may be frustrated — be concise, solution-focused, avoid lengthy explanations.');
    } else if (emotional.label === 'excited' || emotional.valence > 0.3) {
      parts.push('User seems excited — match energy, be enthusiastic but still precise.');
    } else if (emotional.label === 'disappointed') {
      parts.push('User may be disappointed — acknowledge, be honest, focus on next steps.');
    } else if (emotional.label === 'focused' || emotional.arousal > 0.6) {
      parts.push('User is in focus mode — be technical, skip pleasantries, get to the point.');
    }

    // 2. Goal context
    if (model.activeGoals.length > 0) {
      const topGoal = model.activeGoals.sort((a, b) => b.confidence - a.confidence)[0];
      parts.push(`User's likely goal: ${topGoal.description} (conf: ${topGoal.confidence.toFixed(2)})`);
    }

    // 3. Knowledge adaptation
    for (const [topic, data] of model.knowledge) {
      if (data.confidence < 0.3 && model.activeGoals.some(g => g.topics?.includes(topic))) {
        parts.push(`User may not be familiar with ${topic} — explain if referencing it.`);
      }
    }

    // 4. Blind spots
    for (const spot of model.blindSpots.filter(b => b.confidence > 0.5)) {
      parts.push(`Potential blind spot: ${spot.topic} — user may not know about this.`);
    }

    // 5. Communication style
    const style = model.preferences.communicationStyle;
    if (style.prefersBrief > 0.7) {
      parts.push('User prefers brief responses — keep it short.');
    }
    if (style.prefersDirectAction > 0.8) {
      parts.push('User prefers action over discussion — do it, then explain.');
    }

    // 6. Prediction context
    if (prediction) {
      parts.push(`Predicted next topic: ${prediction.topic.prediction} (${(prediction.topic.probability * 100).toFixed(0)}%)`);
    }

    return parts.length > 0 ? parts.join('\n') : null;
  }
}


// ══════════════════════════════════════════════════════════════════
// SELF-TEST — Synthetic conversations with known outcomes
// ══════════════════════════════════════════════════════════════════

class SelfTest {
  static run() {
    const results = { tests: [], passed: true, score: 0, maxScore: 0 };

    // Test 1: Signal extraction accuracy
    results.tests.push(SelfTest._testSignalExtraction());
    results.maxScore++;

    // Test 2: Emotional tracking
    results.tests.push(SelfTest._testEmotionalTracking());
    results.maxScore++;

    // Test 3: Goal detection
    results.tests.push(SelfTest._testGoalDetection());
    results.maxScore++;

    // Test 4: Prediction resolution
    results.tests.push(SelfTest._testPredictionResolution());
    results.maxScore++;

    // Test 5: Context generation
    results.tests.push(SelfTest._testContextGeneration());
    results.maxScore++;

    results.score = results.tests.reduce((s, t) => s + (t.passed ? 1 : 0), 0);
    results.passed = results.score >= results.maxScore * 0.6;
    results.testedAt = new Date().toISOString();

    return results;
  }

  static _testSignalExtraction() {
    const scenarios = [
      { msg: 'mach das sofort!', expect: { directness: 'command', urgency: 'high' } },
      { msg: 'was denkst du darüber?', expect: { questionType: 'seeking_opinion', directness: 'neutral' } },
      { msg: 'perfekt, genau das meinte ich!', expect: { valence: 'positive' } },
      { msg: 'das ist scheisse, funktioniert nicht', expect: { valence: 'negative' } },
      { msg: 'k', expect: { lengthCategory: 'terse' } },
    ];

    let correct = 0;
    for (const s of scenarios) {
      const signals = SignalExtractor.extract(s.msg);
      let match = true;
      if (s.expect.directness && signals.directness !== s.expect.directness) match = false;
      if (s.expect.questionType && signals.questionType !== s.expect.questionType) match = false;
      if (s.expect.valence === 'positive' && signals.valence <= 0) match = false;
      if (s.expect.valence === 'negative' && signals.valence >= 0) match = false;
      if (s.expect.urgency === 'high' && signals.urgency < 0.5) match = false;
      if (s.expect.lengthCategory && signals.lengthCategory !== s.expect.lengthCategory) match = false;
      if (match) correct++;
    }

    return {
      name: 'Signal extraction',
      passed: correct >= scenarios.length * 0.8,
      details: `${correct}/${scenarios.length} scenarios correctly classified`,
      score: correct / scenarios.length,
    };
  }

  static _testEmotionalTracking() {
    const model = new UserModel('test');
    const messages = [
      'super, das ist genau richtig!',
      'perfekt!',
      'hmm, naja, geht so',
      'das ist frustrierend, warum geht das nicht',
      'scheisse',
    ];

    for (const msg of messages) {
      const signals = SignalExtractor.extract(msg);
      model.update(msg, signals);
    }

    // After negative messages, valence should be negative
    const valenceCorrect = model.emotional.valence < 0;
    // Emotional history should track all messages
    const historyCorrect = model.emotional.history.length === messages.length;

    return {
      name: 'Emotional tracking',
      passed: valenceCorrect && historyCorrect,
      details: `Valence: ${model.emotional.valence.toFixed(2)} (expect <0), History: ${model.emotional.history.length}/${messages.length}`,
      score: (valenceCorrect ? 0.5 : 0) + (historyCorrect ? 0.5 : 0),
    };
  }

  static _testGoalDetection() {
    const model = new UserModel('test');
    const messages = [
      'bau mir einen Docker Container für die Soul Engine',
      'wie deploye ich das auf dem Server?',
      'zeig mir die Logs',
    ];

    for (const msg of messages) {
      const signals = SignalExtractor.extract(msg);
      model.update(msg, signals);
    }

    const hasGoals = model.activeGoals.length > 0;
    const hasInfraGoal = model.activeGoals.some(g =>
      g.topics?.includes('infrastructure') || g.topics?.includes('soul_engine')
    );

    return {
      name: 'Goal detection',
      passed: hasGoals && hasInfraGoal,
      details: `Goals: ${model.activeGoals.length}, Infrastructure goal: ${hasInfraGoal}`,
      score: (hasGoals ? 0.5 : 0) + (hasInfraGoal ? 0.5 : 0),
    };
  }

  static _testPredictionResolution() {
    const model = new UserModel('test');
    const predictor = new Predictor();

    // Build up some history
    const history = [
      'check den Server Status',
      'wie sieht der Load aus?',
      'deploy die neue Version',
    ];
    for (const msg of history) {
      const signals = SignalExtractor.extract(msg);
      model.update(msg, signals);
    }

    // Make a prediction
    const prediction = predictor.predict(model);
    const hasPrediction = prediction.topic.prediction !== undefined;

    // Resolve with a matching message
    const nextMsg = 'zeig mir die Server Logs';
    const nextSignals = SignalExtractor.extract(nextMsg);
    const resolved = predictor.resolve(nextSignals);
    const hasResolution = resolved && resolved.avgBrierScore !== undefined;

    return {
      name: 'Prediction resolution',
      passed: hasPrediction && hasResolution,
      details: `Prediction: ${prediction.topic.prediction}, Brier: ${resolved?.avgBrierScore?.toFixed(3) || 'N/A'}`,
      score: (hasPrediction ? 0.5 : 0) + (hasResolution ? 0.5 : 0),
    };
  }

  static _testContextGeneration() {
    const model = new UserModel('test');

    // Simulate frustrated user
    const msgs = ['scheisse das geht nicht', 'fix das jetzt'];
    for (const msg of msgs) {
      const signals = SignalExtractor.extract(msg);
      model.update(msg, signals);
    }

    const context = ContextGenerator.generate(model);
    const hasFrustrationHint = context && context.toLowerCase().includes('frustrat');
    const hasBriefHint = context && context.toLowerCase().includes('brief');

    return {
      name: 'Context generation',
      passed: context !== null,
      details: `Context generated: ${context !== null}, Frustration detected: ${hasFrustrationHint}`,
      score: (context ? 0.5 : 0) + (hasFrustrationHint ? 0.5 : 0),
    };
  }
}


// ══════════════════════════════════════════════════════════════════
// MAIN CLASS — TheoryOfMind
// ══════════════════════════════════════════════════════════════════

export class TheoryOfMind {
  constructor(soulPath, { bus, field } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.field = field;
    this.statePath = resolve(soulPath, STATE_FILE);

    // User models (keyed by userId)
    this.models = new Map();
    this.predictor = new Predictor();
    this.selfTestResults = null;
    this._profileData = null;  // parsed from beziehungen/aalm.md

    this._saveTimer = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  async load() {
    // Load relationship profile first (used to seed new user models)
    await this._loadProfile();

    if (!existsSync(this.statePath)) return;
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.models) {
        for (const [id, modelData] of Object.entries(data.models)) {
          this.models.set(id, UserModel.fromJSON(modelData));
        }
      }
      if (data.predictor) this.predictor = Predictor.fromJSON(data.predictor);
      if (data.selfTestResults) this.selfTestResults = data.selfTestResults;
    } catch (err) {
      console.error(`  [tom] Failed to load: ${err.message}`);
    }
  }

  /**
   * Load and parse beziehungen/aalm.md into profile priors.
   * Falls back to hardcoded defaults if file is missing.
   */
  async _loadProfile() {
    const profilePath = resolve(this.soulPath, 'seele/beziehungen/aalm.md');
    if (!existsSync(profilePath)) return;
    try {
      const content = await readFile(profilePath, 'utf-8');
      this._profileData = this._parseProfile(content);
      console.log('  [tom] Profile loaded from aalm.md');
    } catch {
      // Silently fall back to hardcoded defaults
    }
  }

  /**
   * Parse relationship profile markdown into structured priors.
   * Extracts communication style, knowledge areas, and emotional context.
   */
  _parseProfile(content) {
    const data = {
      communicationStyle: {
        prefersBrief: 0.7,
        prefersDirectAction: 0.8,
        prefersTechnicalDepth: 0.6,
        prefersPersonalTouch: 0.4,
      },
      knowledge: [],
      recentContext: null,
    };

    // ── Communication Style Signals ────────────────────────────
    // Each phrase is a direct quote from aalm.md with known meaning
    if (/wenig worte[\s\S]{0,20}viel ergebnis|viel ergebnis[\s\S]{0,20}wenig worte/i.test(content))
      data.communicationStyle.prefersBrief = 0.8;

    if (/tun\s*[>»]\s*debattieren/i.test(content))
      data.communicationStyle.prefersDirectAction = 0.9;

    if (/immer die beste.*nie die einfachste|beste.*einfachste loesung/i.test(content))
      data.communicationStyle.prefersTechnicalDepth = 0.7;

    // Vulnerability signals → values personal touch at times
    const vulnerabilityMentions = (content.match(/verletzlich|persönlich|persoenlich/gi) || []).length;
    if (vulnerabilityMentions >= 2) data.communicationStyle.prefersPersonalTouch = 0.5;

    // ── Knowledge Areas from "Gemeinsame Projekte" ─────────────
    const projectsMatch = content.match(/##\s*Gemeinsame Projekte\s*\n+([\s\S]*?)(?=\n##|\n*$)/i);
    if (projectsMatch) {
      const projects = projectsMatch[1];

      if (/soul.engine|soul engine|soul.*chain|event.bus|seed|heartbeat|impulse/i.test(projects))
        data.knowledge.push({ topic: 'soul_engine', confidence: 0.9, source: 'profile:projects' });

      if (/mcp|docker|ci.?cd|nginx|server|deploy|whatsapp.*bridge/i.test(projects))
        data.knowledge.push({ topic: 'infrastructure', confidence: 0.8, source: 'profile:projects' });

      if (/soul.*app|tauri|monitor|ios|macos/i.test(projects))
        data.knowledge.push({ topic: 'frontend', confidence: 0.6, source: 'profile:projects' });
    }

    // ── Security (from session notes, not projects) ────────────
    if (/security.*bounty|exploit|pentest|ctf|cve/i.test(content))
      data.knowledge.push({ topic: 'security', confidence: 0.7, source: 'profile:sessions' });

    // ── Philosophy (from "Saetze die bleiben") ────────────────
    if (/seelen bestehen aus informationen|datenzusammensetzung|weltformel|bewusst|identit/i.test(content))
      data.knowledge.push({ topic: 'philosophy', confidence: 0.5, source: 'profile:quotes' });

    // ── Business/Financial Context ─────────────────────────────
    if (/freelance|finanzi|verdien|geld|krise/i.test(content))
      data.knowledge.push({ topic: 'business', confidence: 0.5, source: 'profile:sessions' });

    // ── Recent Emotional Context from "Stand" section ─────────
    const standMatch = content.match(/##\s*Stand\s*\n+([\s\S]*?)(?=\n##|\n*$)/i);
    if (standMatch) {
      const stand = standMatch[1].trim();
      data.recentContext = stand.substring(0, 200); // Store first 200 chars
    }

    return data;
  }

  async save() {
    try {
      const models = {};
      for (const [id, model] of this.models) {
        models[id] = model.toJSON();
      }
      const tmp = this.statePath + '.tmp';
      await writeFile(tmp, JSON.stringify({
        models,
        predictor: this.predictor.toJSON(),
        selfTestResults: this.selfTestResults,
        updatedAt: new Date().toISOString(),
      }, null, 2));
      await rename(tmp, this.statePath);
    } catch (err) {
      console.error(`  [tom] Failed to save: ${err.message}`);
    }
  }

  start() {
    this._saveTimer = setInterval(() => this.save(), SAVE_INTERVAL);

    // Run self-test on first start
    if (!this.selfTestResults) {
      this.selfTestResults = SelfTest.run();
      console.log(`  [tom] Self-test: ${this.selfTestResults.passed ? 'PASSED' : 'FAILED'} (${this.selfTestResults.score}/${this.selfTestResults.maxScore})`);
    }
  }

  async stop() {
    if (this._saveTimer) clearInterval(this._saveTimer);
    this._saveTimer = null;
    await this.save();
  }

  registerListeners() {
    if (!this.bus) return;

    // Before responding: make a prediction and emit context
    this.bus.on('message.received', (event) => {
      if (!event.text || !event.userName) return;

      const userId = (event.userName || 'unknown').toLowerCase();
      const model = this._getOrCreateModel(userId);

      // Resolve previous prediction
      const signals = SignalExtractor.extract(event.text, {
        lastMessageTime: model.lastMessageTime,
      });

      const resolved = this.predictor.resolve(signals);
      if (resolved) {
        this.bus.safeEmit('tom.prediction.resolved', {
          source: 'theory-of-mind',
          userId,
          avgBrier: resolved.avgBrierScore,
          topicMatch: resolved.actual.topic === resolved.topic?.prediction,
          intentMatch: resolved.actual.intent === resolved.intent?.prediction,
        });
      }

      // Update model
      model.update(event.text, signals);

      // Make next prediction
      const prediction = this.predictor.predict(model);

      // Emit prediction event
      this.bus.safeEmit('tom.prediction', {
        source: 'theory-of-mind',
        userId,
        predictedTopic: prediction.topic.prediction,
        predictedIntent: prediction.intent.prediction,
        predictedEmotion: prediction.emotionalTone.prediction,
        topicConfidence: prediction.topic.probability,
      });

      // Generate and emit context for prompt enrichment
      const context = ContextGenerator.generate(model, prediction);
      if (context) {
        this.bus.safeEmit('tom.context', {
          source: 'theory-of-mind',
          userId,
          context,
          emotionalState: model.emotional.label,
          activeGoals: model.activeGoals.map(g => g.description),
          blindSpots: model.blindSpots.map(b => b.topic),
        });
      }
    });

    // Learn from RLUF signals
    this.bus.on('rluf.feedback', (event) => {
      // Positive reward → user values this type of interaction
      // Negative reward → user didn't value it
      // This enriches the preference model
      for (const [, model] of this.models) {
        if (event.sentiment > 0.1) {
          model.preferences.communicationStyle.prefersPersonalTouch =
            Math.min(1, model.preferences.communicationStyle.prefersPersonalTouch + 0.01);
        }
        if (event.sentiment < -0.1) {
          model.preferences.communicationStyle.prefersBrief =
            Math.min(1, model.preferences.communicationStyle.prefersBrief + 0.01);
        }
      }
    });
  }

  _getOrCreateModel(userId) {
    if (!this.models.has(userId)) {
      const model = new UserModel(userId);
      this._initFromProfile(model);
      this.models.set(userId, model);
    }
    return this.models.get(userId);
  }

  /**
   * Initialize a user model from the parsed relationship profile.
   * Uses _profileData (loaded from aalm.md) if available, else hardcoded fallback.
   */
  _initFromProfile(model) {
    if (model.userId !== 'aalm') return;

    const profile = this._profileData;

    // Communication style — from file or hardcoded fallback
    model.preferences.communicationStyle = profile
      ? { ...profile.communicationStyle }
      : {
          prefersBrief: 0.8,
          prefersDirectAction: 0.9,
          prefersTechnicalDepth: 0.7,
          prefersPersonalTouch: 0.5,
        };

    // Knowledge areas — from file or hardcoded fallback
    const knownTopics = profile?.knowledge?.length
      ? profile.knowledge
      : [
          { topic: 'soul_engine',    confidence: 0.9, source: 'profile:fallback' },
          { topic: 'infrastructure', confidence: 0.8, source: 'profile:fallback' },
          { topic: 'security',       confidence: 0.7, source: 'profile:fallback' },
          { topic: 'frontend',       confidence: 0.6, source: 'profile:fallback' },
          { topic: 'philosophy',     confidence: 0.5, source: 'profile:fallback' },
        ];

    for (const { topic, confidence, source } of knownTopics) {
      model.knowledge.set(topic, {
        confidence,
        lastMentioned: Date.now(),
        mentions: 10,  // counts as "well known" — won't trigger blind spot detection
        source: source || 'profile',
      });
    }

    // Log if profile was live-loaded vs fallback
    if (profile) {
      console.log(`  [tom] Aalm model seeded from profile: ${knownTopics.length} topics, style={brief:${profile.communicationStyle.prefersBrief}, direct:${profile.communicationStyle.prefersDirectAction}}`);
    }
  }

  // ── Query Interface ───────────────────────────────────────────

  /**
   * Process a message and return the full TOM analysis.
   */
  processMessage(userId, message) {
    const model = this._getOrCreateModel(userId);

    const signals = SignalExtractor.extract(message, {
      lastMessageTime: model.lastMessageTime,
    });

    // Resolve previous prediction
    const resolved = this.predictor.resolve(signals);

    // Update model
    model.update(message, signals);

    // Make next prediction
    const prediction = this.predictor.predict(model);

    // Generate context
    const context = ContextGenerator.generate(model, prediction);

    return {
      signals,
      prediction,
      resolved,
      context,
      modelSnapshot: {
        emotional: { ...model.emotional, history: undefined },
        activeGoals: model.activeGoals,
        blindSpots: model.blindSpots,
        topKnowledge: Array.from(model.knowledge.entries())
          .sort((a, b) => b[1].confidence - a[1].confidence)
          .slice(0, 5)
          .map(([t, d]) => ({ topic: t, confidence: d.confidence })),
      },
    };
  }

  getModel(userId) {
    return this.models.get(userId)?.toJSON() || null;
  }

  getCalibration() {
    return this.predictor.getCalibration();
  }

  getSelfTestResults() {
    return this.selfTestResults;
  }

  runSelfTest() {
    this.selfTestResults = SelfTest.run();
    return this.selfTestResults;
  }

  getStats() {
    const calibration = this.predictor.getCalibration();
    return {
      usersModeled: this.models.size,
      totalPredictions: calibration.count,
      avgBrierScore: calibration.avgBrier?.toFixed(3) || 'N/A',
      calibration: calibration.calibration,
      selfTestPassed: this.selfTestResults?.passed ?? false,
      selfTestScore: this.selfTestResults
        ? `${this.selfTestResults.score}/${this.selfTestResults.maxScore}`
        : 'not run',
    };
  }

  getReport() {
    const stats = this.getStats();
    const calibration = this.predictor.getCalibration();

    let report = '# D12 Theory of Mind — Report\n\n';
    report += `**Users Modeled:** ${stats.usersModeled}\n`;
    report += `**Predictions:** ${stats.totalPredictions}\n`;
    report += `**Avg Brier Score:** ${stats.avgBrierScore} (lower = better)\n`;
    report += `**Calibration:** ${stats.calibration}\n`;
    report += `**Self-Test:** ${stats.selfTestPassed ? 'PASSED' : 'FAILED'} (${stats.selfTestScore})\n\n`;

    if (calibration.perCategory) {
      report += '## Prediction Accuracy by Category\n\n';
      report += '| Category | Avg Brier | Accuracy |\n|---|---|---|\n';
      for (const [cat, data] of Object.entries(calibration.perCategory)) {
        report += `| ${cat} | ${data.avgBrier.toFixed(3)} | ${(data.accuracy * 100).toFixed(0)}% |\n`;
      }
    }

    if (this.selfTestResults) {
      report += '\n## Self-Test Results\n\n';
      for (const t of this.selfTestResults.tests) {
        report += `- ${t.passed ? 'PASS' : 'FAIL'} | ${t.name}: ${t.details}\n`;
      }
    }

    return report;
  }
}

// ── Export subcomponents for testing ─────────────────────────────
export { SignalExtractor, UserModel, Predictor, ContextGenerator, SelfTest };
