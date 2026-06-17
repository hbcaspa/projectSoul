/**
 * CapabilityGapDetector — der "mhh, wie krieg ich das hin?"-Reflex.
 *
 * Stufe 2 von 3. ZWECK: NUR Erkennung + Event-Emission.
 *
 * Wenn die Soul eine Aufgabe NICHT erledigen kann (ReActLoop endet ohne
 * Loesung, Modell signalisiert explizit Unfaehigkeit, oder ein Tool fehlt),
 * emittiert dieser Detector ein 'capability.gap'-Event auf dem EventBus.
 *
 * Was spaeter (Stufe 3) damit passiert — Resolver, MCP-Tool-Discovery,
 * Foundry/Skill-Bau — ist STRIKT NICHT Sache dieser Datei. Hier wird
 * NICHTS ausgefuehrt, NICHTS gebaut, kein Tool aufgerufen, kein Code
 * generiert. Das ist eine reine Sensorik-Komponente.
 *
 * SICHERHEIT / DESIGN:
 * - inspect() wirft NIE. Jeder Fehler => false (fail-safe: lieber eine Luecke
 *   verpassen als faelschlich einen nachgelagerten Foundry-Pfad triggern).
 * - Konservative Heuristik. Im Zweifel KEINE Luecke melden. Ein verpasstes
 *   Gap kostet hoechstens eine manuelle Nachfrage; ein falsch-positives Gap
 *   kann (in Stufe 3, hinter Gates) autonomes Tool-Bauen anstossen. Die
 *   asymmetrischen Kosten rechtfertigen Zurueckhaltung.
 * - Das Event ist nur ein Signal. Die Entscheidung, ob daraus jemals ein
 *   exec-artiger Pfad wird, liegt ausschliesslich beim ApprovalGate +
 *   FOUNDRY_ENABLED in spaeteren Stufen — niemals hier.
 */

// Unfaehigkeits-Signale (DE + EN). Bewusst eng gehalten: explizite
// Selbst-Aussagen der Unfaehigkeit, nicht jede Verneinung. Wir wollen
// "ich kann das nicht / mir fehlt ein Tool", aber NICHT z.B. "das Wetter
// kann ich dir nicht garantieren" als Smalltalk faelschlich treffen — daher
// koppeln wir die meisten Phrasen an Faehigkeits-/Tool-/Moeglichkeits-Kontext.
const INABILITY_PATTERNS = [
  // Deutsch — explizite Unfaehigkeit
  /\bkann ich (?:leider )?nicht\b/i,
  /\bich kann (?:das|dir das|dies|es) (?:leider )?nicht\b/i,
  /\bich habe kein(?:e|en)? (?:tool|werkzeug|zugriff|moeglichkeit|möglichkeit|funktion)\b/i,
  /\bmir fehlt(?: ein| das| die| der)?\b/i,
  /\bkeine moeglichkeit\b/i,
  /\bkeine möglichkeit\b/i,
  /\bdazu (?:fehlt|habe ich kein)\b/i,
  /\bnicht in der lage\b/i,
  // English — explicit inability
  /\bi can'?t\b/i,
  /\bi cannot\b/i,
  /\bi'?m unable to\b/i,
  /\bi am unable to\b/i,
  /\bunable to\b/i,
  /\bnot able to\b/i,
  /\bi don'?t have (?:a|the|any) (?:tool|access|way|capability|means)\b/i,
  /\bi do not have (?:a|the|any) (?:tool|access|way|capability|means)\b/i,
  /\bno tool (?:available|for that|to)\b/i,
  /\bi lack (?:a|the|any)?\s*(?:tool|access|capability|means)\b/i,
];

export class CapabilityGapDetector {
  /**
   * @param {object}  opts
   * @param {object}  opts.bus    - SoulEventBus (safeEmit). Optional; ohne Bus
   *                                 wird erkannt aber nichts emittiert.
   * @param {object}  opts.logger - Optionaler Logger ({ info, warn, error }).
   *                                 Faellt auf console zurueck.
   */
  constructor({ bus, logger } = {}) {
    this.bus = bus || null;
    this.logger = logger || null;
    this.stats = { inspected: 0, gapsDetected: 0, errors: 0 };
  }

  /**
   * Pruefe ein ReActLoop-Ergebnis auf eine Capability-Luecke.
   *
   * loopResult-Form (siehe react-loop.js run()):
   *   { response: string, iterations: number, toolCalls: object[], totalTokens: number }
   * Optional koennen Aufrufer zusaetzlich anreichern:
   *   { maxIterationsReached?: boolean, maxIterations?: number, resolved?: boolean }
   *
   * @param {object} loopResult - Ergebnis von ReActLoop.run() (oder aequivalent).
   * @param {object} [context]  - Frei: { userMessage, channel, sessionId, ... }.
   *                               Wird unveraendert ins Event gereicht (zur
   *                               spaeteren Resolver-Nutzung).
   * @returns {boolean} true, wenn eine Luecke erkannt UND ein Event emittiert
   *                    wurde (bzw. erkannt, falls kein Bus); sonst false.
   */
  inspect(loopResult, context = {}) {
    // Harte Garantie: niemals werfen. Im Fehlerfall fail-safe => false.
    try {
      this.stats.inspected++;

      if (!loopResult || typeof loopResult !== 'object') {
        // Nichts Auswertbares => konservativ keine Luecke.
        return false;
      }

      const reason = this._detectReason(loopResult);
      if (!reason) {
        return false;
      }

      const description = this._buildDescription(reason, loopResult);

      const payload = {
        source: 'gap-detector',
        reason: reason.code,
        description,
        // Nur einen schlanken, sicheren Kontext mitgeben (keine riesigen Blobs).
        context: this._safeContext(context),
        ts: Date.now(),
      };

      this.stats.gapsDetected++;

      if (this.bus && typeof this.bus.safeEmit === 'function') {
        // safeEmit isoliert Handler-Fehler selbst; trotzdem defensiv umschliessen.
        this.bus.safeEmit('capability.gap', payload);
      }

      this._log('info', `capability gap detected (${reason.code}): ${description}`);
      return true;
    } catch (err) {
      // Erkennung darf den Live-Pfad NIE crashen. Fehler => keine Luecke.
      this.stats.errors++;
      this._log('error', `inspect() failed safely: ${err && err.message}`);
      return false;
    }
  }

  /**
   * Heuristik: liegt eine Luecke vor? Gibt {code, detail} zurueck oder null.
   * Reihenfolge nach Aussagekraft: explizite Tool-Fehlmeldung > explizite
   * Modell-Unfaehigkeit > "Loop ohne Resolution".
   */
  _detectReason(loopResult) {
    const text = this._extractText(loopResult);

    // 1) Aufrufer hat explizit signalisiert, dass die Aufgabe geloest ist.
    //    Dann NIE eine Luecke melden (klares Negativsignal hat Vorrang).
    if (loopResult.resolved === true) {
      return null;
    }

    // 2) Tool-Fehlsignal: der Loop hat einen Tool-Aufruf versucht, der mit
    //    einem klaren Fehler endete, der auf "Tool fehlt/unbekannt" deutet.
    const missingTool = this._detectMissingTool(loopResult);
    if (missingTool) {
      return { code: 'missing_tool', detail: missingTool };
    }

    // 3) Explizite Unfaehigkeits-Aussage im finalen Text.
    if (text && this._matchesInability(text)) {
      return { code: 'model_signaled_inability', detail: this._snippet(text) };
    }

    // 4) Loop ohne Resolution: maxIterations erreicht und keine finale
    //    Textantwort. Konservativ: nur werten, wenn das Flag explizit
    //    gesetzt ist ODER der Fallback-Antworttext der "konnte nicht
    //    abschliessen"-Marker des ReActLoop ist.
    if (this._loopExhausted(loopResult, text)) {
      return { code: 'loop_unresolved', detail: this._snippet(text) };
    }

    return null;
  }

  /**
   * Erkennt, ob ein Tool-Aufruf fehlschlug, weil ein Tool fehlt/unbekannt ist.
   * Schaut konservativ in toolCalls[].result nach klaren Fehler-Markern.
   */
  _detectMissingTool(loopResult) {
    const calls = Array.isArray(loopResult.toolCalls) ? loopResult.toolCalls : [];
    for (const call of calls) {
      const result = call && typeof call.result === 'string' ? call.result : '';
      if (!result) continue;
      // ReActLoop formatiert Tool-Fehler als "Error executing <name>: <msg>".
      // Wir verlangen einen Fehler-Marker PLUS einen "nicht vorhanden"-Hinweis,
      // um normale Laufzeitfehler (Netzwerk etc.) nicht als Capability-Gap zu
      // werten.
      const looksLikeError = /\berror executing\b/i.test(result) || /\bfehler\b/i.test(result);
      const looksMissing =
        /\b(unknown|unbekannt|not found|nicht gefunden|no such tool|kein(?:e|en)? (?:tool|werkzeug)|not registered|nicht registriert|undefined tool)\b/i.test(
          result
        );
      if (looksLikeError && looksMissing) {
        return `tool '${call.name}' unavailable: ${this._snippet(result)}`;
      }
    }
    return null;
  }

  /**
   * Loop gilt nur dann als "unresolved", wenn entweder der Aufrufer das
   * maxIterationsReached-Flag durchreicht, oder der ReActLoop seinen
   * bekannten Fallback-Antworttext gesetzt hat. Reines Erreichen von
   * iterations === maxIterations ohne diese Marker reicht NICHT (zu unsicher).
   */
  _loopExhausted(loopResult, text) {
    const flagged = loopResult.maxIterationsReached === true;

    // Bekannter Fallback-String aus react-loop.js (run(), maxIter erreicht).
    const fallbackMarker =
      typeof text === 'string' &&
      /konnte die aufgabe nicht in den verfuegbaren schritten abschliessen/i.test(text);

    if (!flagged && !fallbackMarker) {
      return false;
    }

    // Zusatzbedingung: keine echte Antwort. Wenn ein nennenswerter Text
    // vorliegt, der NICHT der Fallback-Marker ist, gehen wir davon aus, dass
    // doch etwas Brauchbares zurueckkam => keine Luecke.
    if (text && !fallbackMarker && text.trim().length > 40) {
      return false;
    }

    return true;
  }

  /** Regex-Match gegen Unfaehigkeits-Signale. */
  _matchesInability(text) {
    for (const re of INABILITY_PATTERNS) {
      if (re.test(text)) return true;
    }
    return false;
  }

  /** Holt den finalen Antworttext robust aus verschiedenen Formen. */
  _extractText(loopResult) {
    if (!loopResult) return '';
    if (typeof loopResult.response === 'string') return loopResult.response;
    if (typeof loopResult.text === 'string') return loopResult.text;
    if (typeof loopResult.content === 'string') return loopResult.content;
    return '';
  }

  /** Baut eine menschenlesbare, knappe Beschreibung der Luecke. */
  _buildDescription(reason, loopResult) {
    switch (reason.code) {
      case 'missing_tool':
        return `Aufgabe nicht erledigbar — fehlendes Werkzeug: ${reason.detail}`;
      case 'model_signaled_inability':
        return `Modell signalisierte Unfaehigkeit: "${reason.detail}"`;
      case 'loop_unresolved': {
        const iters = Number.isFinite(loopResult.iterations) ? loopResult.iterations : '?';
        return `ReActLoop endete ohne Loesung nach ${iters} Iteration(en).`;
      }
      default:
        return 'Capability-Luecke erkannt.';
    }
  }

  /** Schneidet Text fuer Logs/Events auf eine sichere Laenge. */
  _snippet(text, max = 200) {
    if (typeof text !== 'string') return '';
    const t = text.trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }

  /**
   * Reduziert den uebergebenen Kontext auf eine schlanke, serialisierbare
   * Form. Keine Funktionen, keine riesigen Strings — das Event soll leicht
   * bleiben (es wird u.a. cross-process geloggt).
   */
  _safeContext(context) {
    if (!context || typeof context !== 'object') return {};
    const out = {};
    for (const key of ['userMessage', 'channel', 'sessionId', 'task', 'origin']) {
      const val = context[key];
      if (typeof val === 'string') {
        out[key] = this._snippet(val, 500);
      } else if (typeof val === 'number' || typeof val === 'boolean') {
        out[key] = val;
      }
    }
    return out;
  }

  _log(level, msg) {
    try {
      const tag = '[gap-detector]';
      if (this.logger && typeof this.logger[level] === 'function') {
        this.logger[level](`${tag} ${msg}`);
      } else if (level === 'error') {
        console.error(`${tag} ${msg}`);
      }
      // info/warn ohne expliziten Logger absichtlich still halten (kein Spam).
    } catch {
      // Logging darf nie eine Ausnahme propagieren.
    }
  }

  getStats() {
    return { ...this.stats };
  }
}
