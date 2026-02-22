/**
 * RLUF — Reinforcement Learning from User Feedback.
 *
 * Learns from implicit user signals to improve impulse scheduling
 * and memory confidence. No explicit thumbs up/down needed.
 *
 * Signals: response latency, sentiment keywords, topic continuation,
 * message length, explicit feedback words.
 *
 * State persisted in .soul-rluf-state (JSON)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const STATE_FILE = '.soul-rluf-state';

const POSITIVE_KEYWORDS = new Set([
  'danke', 'toll', 'super', 'gut', 'genau', 'richtig', 'stimmt', 'perfekt',
  'wunderbar', 'klasse', 'prima', 'ja', 'absolut', 'definitiv', 'cool',
  'interessant', 'spannend', 'schoen', 'stark', 'beeindruckend',
  'thanks', 'great', 'good', 'exactly', 'right', 'correct', 'perfect',
  'wonderful', 'awesome', 'yes', 'absolutely', 'definitely', 'interesting',
  'amazing', 'love', 'nice', 'excellent', 'brilliant', 'impressive',
]);

const NEGATIVE_KEYWORDS = new Set([
  'nein', 'falsch', 'schlecht', 'fehler', 'quatsch', 'unsinn',
  'nervig', 'langweilig', 'egal', 'stopp', 'aufhoeren', 'vergiss',
  'no', 'wrong', 'bad', 'error', 'nonsense', 'boring', 'annoying',
  'stop', 'forget', 'incorrect', 'useless', 'terrible', 'awful',
]);

const LEARNING_RATE = 0.1;
const CONFIDENCE_RATE = 0.05;

export class FeedbackLearner {
  constructor({ soulPath, db, impulseState, bus }) {
    this.soulPath = soulPath;
    this.db = db || null;
    this.impulseState = impulseState || null;
    this.bus = bus || null;
    this.statePath = resolve(soulPath, STATE_FILE);

    this.lastImpulseType = null;
    this.lastImpulseTime = null;
    this.lastResponseTime = null;
    this.impulseWeights = {};
    this.totalFeedback = 0;
    this.sessionFeedback = [];

    this._loadState();
  }

  /**
   * Called when a user message arrives. Computes reward from implicit signals.
   */
  onUserResponse(userMessage, latencyMs = null) {
    const signal = {
      timestamp: Date.now(),
      impulseType: this.lastImpulseType,
      reward: 0,
      components: {},
    };

    // Latency reward
    if (latencyMs !== null) {
      if (latencyMs < 5 * 60 * 1000) signal.components.latency = 0.3;
      else if (latencyMs < 30 * 60 * 1000) signal.components.latency = 0.1;
      else if (latencyMs > 60 * 60 * 1000) signal.components.latency = -0.1;
      else signal.components.latency = 0;
    }

    // Sentiment
    const words = userMessage.toLowerCase().split(/[\s,.!?;:]+/).filter(Boolean);
    let posCount = 0, negCount = 0;
    for (const word of words) {
      if (POSITIVE_KEYWORDS.has(word)) posCount++;
      if (NEGATIVE_KEYWORDS.has(word)) negCount++;
    }
    if (posCount > negCount) signal.components.sentiment = 0.2 * Math.min(posCount, 3);
    else if (negCount > posCount) signal.components.sentiment = -0.2 * Math.min(negCount, 3);
    else signal.components.sentiment = 0;

    // Engagement (message length proxy)
    if (userMessage.length > 200) signal.components.engagement = 0.15;
    else if (userMessage.length > 50) signal.components.engagement = 0.05;
    else if (userMessage.length < 10) signal.components.engagement = -0.05;
    else signal.components.engagement = 0;

    // Topic continuation (question mark)
    signal.components.continuation = userMessage.includes('?') ? 0.1 : 0;

    // Aggregate
    signal.reward = Math.max(-1, Math.min(1,
      Object.values(signal.components).reduce((s, v) => s + v, 0)
    ));

    // Update impulse weights
    if (signal.impulseType && signal.reward !== 0) {
      const current = this.impulseWeights[signal.impulseType] || 1.0;
      this.impulseWeights[signal.impulseType] = Math.max(0.1, Math.min(3.0,
        current + LEARNING_RATE * signal.reward
      ));
    }

    // Update memory confidence
    if (this.db && signal.reward !== 0) {
      this._updateRecentMemoryConfidence(signal.reward);
    }

    this.totalFeedback++;
    this.sessionFeedback.push(signal);
    this.lastImpulseType = null;

    this._saveState();

    if (this.bus) {
      this.bus.safeEmit('rluf.feedback', {
        source: 'rluf',
        reward: signal.reward,
        sentiment: signal.components.sentiment || 0,
        impulseType: signal.impulseType,
        components: signal.components,
      });
    }

    return signal;
  }

  onImpulseFired(impulseType) {
    this.lastImpulseType = impulseType;
    this.lastImpulseTime = Date.now();
  }

  getImpulseWeights() {
    return { ...this.impulseWeights };
  }

  getStats() {
    const avgReward = this.sessionFeedback.length > 0
      ? this.sessionFeedback.reduce((s, f) => s + f.reward, 0) / this.sessionFeedback.length
      : 0;

    return {
      totalFeedback: this.totalFeedback,
      sessionFeedback: this.sessionFeedback.length,
      avgSessionReward: Math.round(avgReward * 100) / 100,
      impulseWeights: { ...this.impulseWeights },
      topImpulseType: this._getTopImpulseType(),
    };
  }

  registerListeners() {
    if (!this.bus) return;

    this.bus.on('impulse.fired', (event) => {
      this.onImpulseFired(event.impulseType || event.type);
    });

    this.bus.on('message.responded', () => {
      this.lastResponseTime = Date.now();
    });

    this.bus.on('message.received', (event) => {
      if (event.channel === 'telegram' || event.channel === 'whatsapp') {
        const latency = this.lastResponseTime ? Date.now() - this.lastResponseTime : null;
        this.onUserResponse(event.text || '', latency);
      }
    });
  }

  _updateRecentMemoryConfidence(reward) {
    try {
      const recent = this.db.searchStructured({ limit: 3 });
      for (const mem of recent) {
        const newConf = mem.confidence + CONFIDENCE_RATE * reward;
        this.db.updateConfidence(mem.id, newConf);
      }
    } catch { /* DB might not be ready */ }
  }

  _getTopImpulseType() {
    const entries = Object.entries(this.impulseWeights);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0][0];
  }

  _loadState() {
    try {
      if (existsSync(this.statePath)) {
        const data = JSON.parse(readFileSync(this.statePath, 'utf-8'));
        this.impulseWeights = data.impulseWeights || {};
        this.totalFeedback = data.totalFeedback || 0;
      }
    } catch { /* start fresh */ }
  }

  _saveState() {
    try {
      writeFileSync(this.statePath, JSON.stringify({
        impulseWeights: this.impulseWeights,
        totalFeedback: this.totalFeedback,
        lastUpdated: new Date().toISOString(),
      }, null, 2));
    } catch { /* best effort */ }
  }
}
