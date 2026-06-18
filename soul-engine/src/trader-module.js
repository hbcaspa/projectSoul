/**
 * Trader Module — Autonomes Paper-Trading-System
 *
 * Integriert Trader Arena in die Soul Engine:
 *  - Läuft täglich um 08:00 UTC via Cron
 *  - Führt paper_trader.py aus (Signal Engine → Position Management)
 *  - Sendet Telegram-Notifications bei BUY/SELL/Stop-Loss
 *  - Pusht Events auf den Event Bus
 *
 * Konfiguration via .env:
 *   TRADER_ARENA_PATH=/path/to/trader-arena
 *   TRADER_ENABLED=true
 *   TRADER_CRON=0 8 * * *  (täglich 08:00 UTC)
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import cron from 'node-cron';

const execAsync = promisify(exec);

export class TraderModule {
  constructor({ bus, telegram, soulPath }) {
    this.bus       = bus;
    this.telegram  = telegram;
    this.soulPath  = soulPath;
    this.task      = null;
    this.enabled   = process.env.TRADER_ENABLED === 'true';
    this.arenaPath = process.env.TRADER_ARENA_PATH
      || join(soulPath, '..', 'trader-arena');
    this.cronExpr  = process.env.TRADER_CRON || '0 8 * * *';  // 08:00 UTC daily
    this.python    = process.env.PYTHON_BIN || 'python3';
  }

  start() {
    if (!this.enabled) {
      console.log('  [trader] Disabled (TRADER_ENABLED != true)');
      return;
    }

    if (!existsSync(this.arenaPath)) {
      console.warn(`  [trader] Arena path not found: ${this.arenaPath}`);
      return;
    }

    console.log(`  [trader] Starting — cron: ${this.cronExpr}`);

    this.task = cron.schedule(this.cronExpr, async () => {
      try {
        await this.runDailyTrader();
      } catch (err) {
        // Nur loggen — Trader-Fehler sind Ops-Rauschen, gehören nicht in Aalms
        // persönlichen Chat ("was soll ich damit"). Echte Trade-Ergebnisse melden
        // sich weiterhin (gegatet) über die Awareness-/Freund-Stimme.
        console.error(`  [trader] Cron error: ${err.message}`);
      }
    });

    // Also register event: manual trigger via bus
    this.bus?.on('trader.run', async () => {
      console.log('  [trader] Manual run triggered via event bus');
      await this.runDailyTrader();
    });

    console.log('  [trader] Scheduled ✓');
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  async runDailyTrader() {
    console.log('  [trader] Running daily paper trader...');

    const cmd = `cd "${this.arenaPath}" && ${this.python} modules/paper_trader.py run 2>&1`;

    let stdout = '';
    let exitCode = 0;

    try {
      const env = {
      ...process.env,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
      GEMINI_MODEL:   process.env.GEMINI_MODEL   || 'gemini-1.5-flash',
    };
    const result = await execAsync(cmd, { timeout: 120_000, env });
      stdout = result.stdout;
    } catch (err) {
      stdout = err.stdout || '';
      exitCode = err.code || 1;
    }

    // Parse summary JSON from output (paper_trader.py prints a JSON summary at the end)
    let summary = null;
    const jsonMatch = stdout.match(/\{[\s\S]*"action"[\s\S]*\}/);
    if (jsonMatch) {
      try { summary = JSON.parse(jsonMatch[0]); } catch {}
    }

    // Emit on event bus
    this.bus?.emit('trader.daily.complete', {
      timestamp: new Date().toISOString(),
      summary,
      exitCode,
      output: stdout.slice(-2000),   // last 2000 chars
    });

    // Telegram notifications
    if (summary) {
      await this._notifyOnSummary(summary);
    } else if (exitCode !== 0) {
      // Fehlgeschlagener Run → NUR loggen, kein Telegram (sonst Fehler-Spam,
      // besonders bei häufigem Cron). Aalm will damit nichts anfangen müssen.
      console.warn(`  [trader] Run fehlgeschlagen (exit ${exitCode}) — nur geloggt, kein Telegram.`);
    } else {
      // Try to parse signal from output directly
      await this._notifyOnOutput(stdout);
    }

    console.log(`  [trader] Daily run complete (exit ${exitCode})`);
    return summary;
  }

  async _notifyOnSummary(summary) {
    const { action, coin, confidence, s8_phase, pnl_eur, win_rate_pct, open_count } = summary;

    const phaseEmoji = {
      ALT_SEASON:      '🚀',
      ROTATION_ACTIVE: '🔄',
      ROTATION_EARLY:  '⚡',
      BTC_SEASON:      '₿',
      EXIT:            '🔴',
      UNKNOWN:         '❓',
    }[s8_phase] || '📊';

    let msg = `${phaseEmoji} *Trader — ${new Date().toLocaleDateString('de')}*\n`;
    msg += `Phase: \`${s8_phase}\`\n\n`;

    if (action === 'BUY' && coin) {
      msg += `✅ *BUY Signal: ${coin}*\n`;
      msg += `Confidence: ${Math.round((confidence || 0) * 100)}%\n`;
      msg += `Position eröffnet ✓\n`;
    } else if (action === 'SELL') {
      msg += `🔴 *EXIT — Alle Positionen geschlossen*\n`;
    } else {
      msg += `⏸ HOLD — Kein Signal heute\n`;
    }

    if (pnl_eur != null) {
      const pnlEmoji = pnl_eur >= 0 ? '📈' : '📉';
      msg += `\n${pnlEmoji} PnL gesamt: ${pnl_eur >= 0 ? '+' : ''}€${pnl_eur?.toFixed(2)}\n`;
      msg += `Win Rate: ${win_rate_pct?.toFixed(1)}%\n`;
    }

    if (open_count != null) {
      msg += `Offene Positionen: ${open_count}/3\n`;
    }

    await this._notify(msg);
  }

  async _notifyOnOutput(stdout) {
    // Fallback: extract key info from text output
    const hasSignal = stdout.includes('BUY') && stdout.includes('SIGNAL:');
    const hasHold   = stdout.includes('HOLD');
    const hasTrap   = stdout.includes('FUNDING TRAP');
    const hasStop   = stdout.includes('[STOP]');

    if (hasStop) {
      const stopMatch = stdout.match(/\[STOP\] (\w+) Stop-Loss @ \$([0-9.]+) \| PnL: ([+-]?[0-9.]+%)/);
      if (stopMatch) {
        await this._notify(
          `⛔ *Stop-Loss ausgelöst*\n${stopMatch[1]} @ $${stopMatch[2]}\nPnL: ${stopMatch[3]}`
        );
      }
    } else if (hasSignal) {
      const sigMatch = stdout.match(/SIGNAL: (\w+) BUY \(([0-9]+%)\)/);
      await this._notify(
        sigMatch
          ? `✅ *BUY Signal*\n${sigMatch[1]} — Confidence: ${sigMatch[2]}`
          : `✅ *BUY Signal erkannt* — Details im Dashboard`
      );
    } else if (hasTrap) {
      await this._notify(`⚠️ *Funding Trap erkannt* — kein Einstieg, Fakeout-Warnung`);
    } else if (hasHold) {
      // HOLD: only notify once per day (morning summary)
      const today = new Date().toISOString().slice(0, 10);
      if (this._lastHoldNotifyDate !== today) {
        this._lastHoldNotifyDate = today;
        const phaseMatch = stdout.match(/Phase:\s+(\w+)\s+\(Score:\s*(\d+)\)/);
        const phase = phaseMatch ? phaseMatch[1] : 'UNKNOWN';
        const score = phaseMatch ? phaseMatch[2] : '?';
        await this._notify(`📊 *Trader — ${new Date().toLocaleDateString('de')}*\nPhase: \`${phase}\` (Score: ${score})\n⏸ HOLD — Kein Signal heute`);
      }
    }
  }

  async _notify(text) {
    if (!this.telegram) return;
    try {
      await this.telegram.sendToOwner(text);
    } catch (err) {
      console.warn(`  [trader] Telegram notify failed: ${err.message}`);
    }
  }

  /**
   * Returns portfolio summary for the SoulOS dashboard API.
   */
  async getPortfolioSummary() {
    const posFile = join(this.arenaPath, 'backtests', 'positions.jsonl');
    const sigFile = join(this.arenaPath, 'backtests', 'signals.jsonl');

    const readJsonl = (path) => {
      if (!existsSync(path)) return [];
      return readFileSync(path, 'utf8')
        .split('\n').filter(l => l.trim())
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    };

    const positions = readJsonl(posFile);
    const signals   = readJsonl(sigFile);

    const open   = positions.filter(p => p.status === 'OPEN');
    const closed = positions.filter(p => p.status !== 'OPEN');
    const wins   = closed.filter(p => (p.pnl_pct || 0) > 0);

    return {
      open_positions:  open,
      total_trades:    positions.length,
      wins:            wins.length,
      losses:          closed.length - wins.length,
      win_rate_pct:    closed.length ? Math.round(wins.length / closed.length * 100) : 0,
      total_pnl_eur:   Math.round(closed.reduce((s, p) => s + (p.pnl_eur || 0), 0) * 100) / 100,
      last_signal:     signals.length ? signals[signals.length - 1] : null,
    };
  }
}
