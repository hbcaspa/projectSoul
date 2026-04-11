/**
 * AutoProfile — Self-updating profile memory built from sessions.
 *
 * Inspired by DeepTutor's Dual Memory Dimensions:
 * - Summary dimension (learning progress) → our session stats
 * - Profile dimension (identity/preferences) → THIS MODULE
 *
 * The profile automatically builds and updates from:
 * 1. Completed sessions → extract interaction patterns
 * 2. Feedback events → track preferences
 * 3. Message patterns → detect communication style
 *
 * Stored in SQLite alongside other memories.
 * The profile is injected into the UnifiedContext for all subsystems.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const PROFILE_FILE = '.soul-profile.json';
const MIN_SESSIONS_FOR_PROFILE = 3;
const PROFILE_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 min cooldown

export class AutoProfile {
  constructor({ soulPath, bus, llm, sessionManager } = {}) {
    this.soulPath = soulPath;
    this.bus = bus || null;
    this.llm = llm || null;
    this.sessionManager = sessionManager || null;
    this.profile = null;
    this._lastUpdate = 0;
    this._pendingFeedback = [];

    this._loadFromDisk();
  }

  /**
   * Register event bus listeners for automatic profile building.
   */
  registerListeners() {
    if (!this.bus) return;

    // Update profile after session completion
    this.bus.on('session.transition', (event) => {
      if (event.to === 'completed') {
        this._scheduleUpdate('session_completed');
      }
    });

    // Track feedback for preference learning
    this.bus.on('rluf.feedback', (event) => {
      this._pendingFeedback.push({
        reward: event.reward,
        sentiment: event.sentiment,
        type: event.impulseType,
        ts: Date.now(),
      });
      // Update after accumulating feedback
      if (this._pendingFeedback.length >= 5) {
        this._scheduleUpdate('feedback_accumulated');
      }
    });

    // Track message patterns
    this.bus.on('message.received', (event) => {
      if (event.source === 'claude-code' && event.text) {
        this._trackMessagePattern(event);
      }
    });

    console.log('  AutoProfile: listeners registered');
  }

  /**
   * Get the current profile (or a default if not yet built).
   */
  getProfile() {
    return this.profile || this._defaultProfile();
  }

  /**
   * Force a profile rebuild from session history.
   */
  async rebuild() {
    return this._buildProfile('manual_rebuild');
  }

  /**
   * Get profile stats for the API.
   */
  getStats() {
    return {
      hasProfile: !!this.profile,
      lastUpdated: this.profile?.lastUpdated || null,
      version: this.profile?.version || 0,
      feedbackCount: this._pendingFeedback.length,
      traits: this.profile?.traits ? Object.keys(this.profile.traits).length : 0,
    };
  }

  // ── Private Methods ──────────────────────────────

  _defaultProfile() {
    return {
      version: 0,
      lastUpdated: null,
      // Interaction patterns
      patterns: {
        avgSessionDuration: null,
        preferredLanguage: 'de',
        communicationStyle: 'unknown',
        topicInterests: [],
        activeHours: [],
      },
      // Learned preferences
      preferences: {
        verbosity: 'normal',     // terse, normal, detailed
        autonomy: 'balanced',     // guided, balanced, autonomous
        feedbackTone: 'neutral',  // positive, neutral, critical
      },
      // Personality traits derived from interactions
      traits: {},
      // Relationship summary
      relationship: {
        trustLevel: 0.5,
        totalSessions: 0,
        totalTurns: 0,
        positiveRatio: 0.5,
      },
    };
  }

  _loadFromDisk() {
    const filePath = resolve(this.soulPath, PROFILE_FILE);
    if (existsSync(filePath)) {
      try {
        this.profile = JSON.parse(readFileSync(filePath, 'utf-8'));
      } catch {
        this.profile = null;
      }
    }
  }

  _saveToDisk() {
    if (!this.profile) return;
    const filePath = resolve(this.soulPath, PROFILE_FILE);
    try {
      writeFileSync(filePath, JSON.stringify(this.profile, null, 2));
    } catch (err) {
      console.error(`  [AutoProfile] Save failed: ${err.message}`);
    }
  }

  _scheduleUpdate(trigger) {
    const now = Date.now();
    if (now - this._lastUpdate < PROFILE_UPDATE_INTERVAL) return;

    // Debounce: wait 10s after trigger
    clearTimeout(this._updateTimer);
    this._updateTimer = setTimeout(() => this._buildProfile(trigger), 10000);
  }

  _trackMessagePattern(event) {
    // Lightweight pattern tracking (no LLM needed)
    if (!this.profile) this.profile = this._defaultProfile();

    const hour = new Date().getHours();
    if (!this.profile.patterns.activeHours.includes(hour)) {
      this.profile.patterns.activeHours.push(hour);
      // Keep only the 12 most frequent hours
      if (this.profile.patterns.activeHours.length > 12) {
        this.profile.patterns.activeHours = this.profile.patterns.activeHours.slice(-12);
      }
    }
  }

  async _buildProfile(trigger) {
    this._lastUpdate = Date.now();

    // Need session manager for history
    if (!this.sessionManager) return;

    const stats = this.sessionManager.getStats();
    if (stats.total < MIN_SESSIONS_FOR_PROFILE) return;

    const base = this.profile || this._defaultProfile();

    // Update relationship stats from session data
    base.relationship.totalSessions = stats.total;
    base.relationship.positiveRatio = stats.completionRate || 0.5;

    // Calculate feedback-based preferences
    if (this._pendingFeedback.length > 0) {
      const avgReward = this._pendingFeedback.reduce((s, f) => s + f.reward, 0) / this._pendingFeedback.length;
      base.relationship.trustLevel = Math.min(1.0, Math.max(0.0,
        base.relationship.trustLevel * 0.8 + avgReward * 0.2
      ));
      this._pendingFeedback = [];
    }

    // LLM-based trait extraction (if available, with rate limiting)
    if (this.llm && trigger === 'session_completed') {
      try {
        const recentSessions = this.sessionManager.getRecentSessions(5);
        const sessionSummaries = recentSessions
          .filter(s => s.summary)
          .map(s => s.summary)
          .join('\n');

        if (sessionSummaries.length > 50) {
          const response = await this.llm.generate(
            'Du analysierst Interaktionsmuster. Antworte NUR mit validem JSON.',
            [],
            `Basierend auf diesen Session-Zusammenfassungen, extrahiere Persoenlichkeitsmerkmale und Praeferenzen des Gespraechspartners.

Sessions:
${sessionSummaries.slice(0, 2000)}

Antworte mit JSON:
{
  "communicationStyle": "direkt|reflektiv|explorativ|pragmatisch",
  "topicInterests": ["thema1", "thema2"],
  "verbosity": "terse|normal|detailed",
  "traits": { "trait_name": 0.0-1.0 }
}`,
            { maxTokens: 512, temperature: 0.2 }
          );

          const jsonMatch = response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const extracted = JSON.parse(jsonMatch[0]);
            if (extracted.communicationStyle) base.patterns.communicationStyle = extracted.communicationStyle;
            if (extracted.topicInterests) base.patterns.topicInterests = extracted.topicInterests.slice(0, 10);
            if (extracted.verbosity) base.preferences.verbosity = extracted.verbosity;
            if (extracted.traits) Object.assign(base.traits, extracted.traits);
          }
        }
      } catch (err) {
        console.error(`  [AutoProfile] LLM extraction failed: ${err.message}`);
      }
    }

    base.version = (base.version || 0) + 1;
    base.lastUpdated = new Date().toISOString();
    this.profile = base;
    this._saveToDisk();

    if (this.bus) {
      this.bus.safeEmit('profile.updated', {
        source: 'auto-profile',
        version: base.version,
        trigger,
      });
    }

    console.log(`  [AutoProfile] Profile updated (v${base.version}, trigger: ${trigger})`);
  }
}
