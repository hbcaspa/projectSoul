/**
 * gif-source.js — GIF/Meme-Quelle fuer die Seele.
 *
 * Designprinzipien:
 *  - FAIL-SAFE ueber alles: keine Quelle, kein Key, Timeout, toter Treffer,
 *    kaputtes JSON → einfach kein GIF (`{ available:false }` bzw. `null`).
 *    Diese Datei darf NIE werfen und NIE den Send-Pfad kaputt machen.
 *  - Kein harter Key noetig: das kuratierte Local-Set funktioniert allein.
 *    Ein dynamischer Provider (Klipy/Giphy/Tenor) ist nur Bonus.
 *  - Sparsam by design: der Aufrufer entscheidet OB gesucht wird; diese
 *    Datei liefert nur eine URL, wenn etwas Passendes existiert.
 *
 * Env (alle OPTIONAL):
 *   SOUL_GIF_ENABLED=false   → schaltet die ganze Schicht ab (Default: an)
 *   KLIPY_API_KEY=...        → dynamische Suche via Klipy (lifetime free)
 *   GIPHY_API_KEY=...        → dynamische Suche via Giphy (Beta-Key)
 *   TENOR_API_KEY=...        → dynamische Suche via Tenor (Legacy/Abschaltung 06/2026)
 *   SOUL_GIF_RATING=g        → Content-Rating fuer dynamische Provider (Default g)
 *
 * Reihenfolge der Aufloesung: Local-Set (Stimmungs-Match) zuerst,
 * dann der erste konfigurierte dynamische Provider als Fallback.
 */

const FETCH_TIMEOUT_MS = 6000;

/**
 * Kuratiertes Local-Set. Bewusst KLEIN und persoenlich — ein Freund hat ein
 * eigenes GIF-Vokabular, durchsucht nicht das ganze Internet. Getaggt nach
 * Stimmung; jeder Eintrag hat 1-n stabile, breit verfuegbare GIF-URLs.
 *
 * Die URLs zeigen auf Giphy-CDN (media.giphy.com) im .gif-Format — von
 * Telegram via sendAnimation als stummes Loop abspielbar. Kein Key noetig,
 * da reine Media-URLs (keine API).
 */
const LOCAL_SET = [
  // Feier / Erfolg
  { tags: ['feier', 'celebration', 'party', 'yay', 'hurra', 'geschafft', 'erfolg', 'success', 'win', 'gewonnen'],
    url: 'https://media.giphy.com/media/g9582DNuQppxC/giphy.gif' }, // confetti / celebrate
  { tags: ['feier', 'tanz', 'dance', 'happy', 'freude', 'gute laune'],
    url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif' }, // happy dance
  // Daumen hoch / nice
  { tags: ['daumen_hoch', 'thumbs up', 'nice', 'gut', 'good', 'top', 'super', 'genau', 'jawohl'],
    url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif' }, // thumbs up
  { tags: ['cool', 'deal with it', 'sunglasses', 'laessig'],
    url: 'https://media.giphy.com/media/Ang4uPbcN6suI/giphy.gif' }, // deal with it
  // Lachen / Humor
  { tags: ['lol', 'lachen', 'laughing', 'haha', 'lustig', 'witzig', 'funny'],
    url: 'https://media.giphy.com/media/10JhviFuU2gWD6/giphy.gif' }, // laughing
  { tags: ['lol', 'rofl', 'dying', 'totlachen'],
    url: 'https://media.giphy.com/media/3o6Zt481isNVuQI1l6/giphy.gif' }, // laughing hard
  // Facepalm / genervt / oh no
  { tags: ['facepalm', 'oh no', 'oje', 'autsch', 'peinlich', 'fail', 'mist'],
    url: 'https://media.giphy.com/media/XsUtdIeJ0MWMo/giphy.gif' }, // facepalm
  { tags: ['genervt', 'augenrollen', 'eyeroll', 'annoyed', 'seufz'],
    url: 'https://media.giphy.com/media/Rhhr8D5mKSX7O/giphy.gif' }, // eye roll
  // Erstaunen
  { tags: ['mind_blown', 'wow', 'krass', 'wahnsinn', 'unglaublich', 'shocked', 'baff'],
    url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif' }, // mind blown
  { tags: ['wow', 'staunen', 'beeindruckt'],
    url: 'https://media.giphy.com/media/5VKbvrjxpVJCM/giphy.gif' }, // surprised
  // Warten / Geduld
  { tags: ['warten', 'waiting', 'geduld', 'noch da', 'still waiting'],
    url: 'https://media.giphy.com/media/QBd2kLB5qNgbVAghLG/giphy.gif' }, // still waiting
  // Liebe / Danke / Herz
  { tags: ['danke', 'thanks', 'thank you', 'herz', 'love', 'liebe', 'umarmung', 'hug'],
    url: 'https://media.giphy.com/media/3o6Zt6ML6BklcajjsA/giphy.gif' }, // thank you / heart
  // Nachdenklich
  { tags: ['nachdenklich', 'thinking', 'hmm', 'ueberlegen', 'gruebeln'],
    url: 'https://media.giphy.com/media/d3mlE7uhX8KFgEmY/giphy.gif' }, // thinking
  // Schlafen / muede / gute nacht
  { tags: ['muede', 'tired', 'schlaf', 'gute nacht', 'good night', 'sleepy'],
    url: 'https://media.giphy.com/media/aQYR1p8saOQla/giphy.gif' }, // sleepy
  // Hallo / winken
  { tags: ['hallo', 'hi', 'hey', 'winken', 'wave', 'moin'],
    url: 'https://media.giphy.com/media/3o7aTskHEUdgCQAXde/giphy.gif' }, // wave
];

/** Ist die Schicht ueberhaupt aktiv? Nur explizit "false" schaltet ab. */
export function isGifEnabled() {
  return String(process.env.SOUL_GIF_ENABLED || 'true').toLowerCase() !== 'false';
}

/** Welcher dynamische Provider ist konfiguriert (oder null)? */
function detectProvider() {
  if (process.env.KLIPY_API_KEY) return 'klipy';
  if (process.env.GIPHY_API_KEY) return 'giphy';
  if (process.env.TENOR_API_KEY) return 'tenor';
  return null;
}

/** fetch mit hartem Timeout — wirft NIE nach aussen (Aufrufer faengt). */
async function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Normalisiert einen Suchbegriff zu vergleichbaren Tokens. */
function tokenize(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß\s]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Versucht, den Suchbegriff gegen das Local-Set zu matchen.
 * Gibt eine URL zurueck oder null. Score: Tag-Wort kommt im Query vor (oder
 * umgekehrt). Bei mehreren Treffern wird zufaellig unter den besten gewaehlt,
 * damit dieselbe Stimmung nicht immer dasselbe GIF liefert.
 */
function matchLocalSet(query) {
  try {
    const qTokens = tokenize(query);
    if (!qTokens.length) return null;
    const qJoined = ' ' + qTokens.join(' ') + ' ';

    let best = [];
    let bestScore = 0;

    for (const entry of LOCAL_SET) {
      let score = 0;
      for (const tag of entry.tags) {
        const t = tag.toLowerCase();
        // Mehrwort-Tag: Substring-Match im zusammengesetzten Query.
        if (t.includes(' ')) {
          if (qJoined.includes(' ' + t + ' ') || qJoined.includes(t)) score += 2;
          continue;
        }
        // Einzelwort-Tag: exakter Token-Match (stark) oder Teilstring (schwach).
        // Teilstring NUR fuer laengere Tokens (>=4), sonst matchen Kurzwoerter wie
        // "no"/"up"/"da" faelschlich INNERHALB langer Tags (z.B. "no" in "annoyed")
        // → das Local-Set wuerde dann fast jeden Query treffen (Anti-Cringe-Bruch).
        if (qTokens.includes(t)) score += 2;
        else if (t.length >= 4 && qTokens.some(w => w.length >= 4 && (w.includes(t) || t.includes(w)))) score += 1;
      }
      if (score > bestScore) { bestScore = score; best = [entry]; }
      else if (score === bestScore && score > 0) best.push(entry);
    }

    if (bestScore <= 0 || !best.length) return null;
    const pick = best[Math.floor(Math.random() * best.length)];
    return pick.url || null;
  } catch {
    return null;
  }
}

// ── Dynamische Provider ────────────────────────────────────
// Jeder gibt eine GIF-URL zurueck oder null. Alle fail-safe.

async function searchKlipy(query, rating) {
  try {
    const key = process.env.KLIPY_API_KEY;
    if (!key) return null;
    const url = `https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/search`
      + `?q=${encodeURIComponent(query)}&per_page=10&page=1&content_filter=${encodeURIComponent(rating)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const json = await res.json();
    // Klipy-Antwort: { result, data: { data: [ { file: { hd|md|sm: { gif: { url } } } } ] } }
    const items = json?.data?.data || json?.data || [];
    if (!Array.isArray(items) || !items.length) return null;
    const item = items[Math.floor(Math.random() * Math.min(items.length, 10))];
    const file = item?.file || {};
    const candidate =
      file?.md?.gif?.url || file?.sm?.gif?.url || file?.hd?.gif?.url ||
      file?.md?.mp4?.url || file?.sm?.mp4?.url ||
      item?.url || null;
    return typeof candidate === 'string' && /^https?:\/\//i.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

async function searchGiphy(query, rating) {
  try {
    const key = process.env.GIPHY_API_KEY;
    if (!key) return null;
    const url = `https://api.giphy.com/v1/gifs/search`
      + `?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}`
      + `&limit=10&rating=${encodeURIComponent(rating)}&lang=de`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const json = await res.json();
    const items = json?.data || [];
    if (!Array.isArray(items) || !items.length) return null;
    const item = items[Math.floor(Math.random() * Math.min(items.length, 10))];
    const imgs = item?.images || {};
    // downsized ist bandbreitenschonend (<= 2MB, passt zu Telegram).
    const candidate =
      imgs?.downsized?.url || imgs?.fixed_height?.url || imgs?.original?.url || null;
    return typeof candidate === 'string' && /^https?:\/\//i.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

async function searchTenor(query, rating) {
  try {
    const key = process.env.TENOR_API_KEY;
    if (!key) return null;
    // Tenor v2 nutzt contentfilter (off|low|medium|high). g → high.
    const cf = rating === 'g' ? 'high' : 'medium';
    const url = `https://tenor.googleapis.com/v2/search`
      + `?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}`
      + `&limit=10&contentfilter=${cf}&media_filter=gif`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const json = await res.json();
    const items = json?.results || [];
    if (!Array.isArray(items) || !items.length) return null;
    const item = items[Math.floor(Math.random() * Math.min(items.length, 10))];
    const fmts = item?.media_formats || {};
    const candidate =
      fmts?.gif?.url || fmts?.mediumgif?.url || fmts?.tinygif?.url || fmts?.mp4?.url || null;
    return typeof candidate === 'string' && /^https?:\/\//i.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

async function searchDynamic(query) {
  const provider = detectProvider();
  if (!provider) return null;
  const rating = String(process.env.SOUL_GIF_RATING || 'g').toLowerCase();
  switch (provider) {
    case 'klipy': return await searchKlipy(query, rating);
    case 'giphy': return await searchGiphy(query, rating);
    case 'tenor': return await searchTenor(query, rating);
    default:      return null;
  }
}

/**
 * Hauptfunktion: finde eine GIF-URL fuer einen Suchbegriff/eine Stimmung.
 *
 * @param {string} query  Suchbegriff/Stimmung (z.B. "feier", "facepalm", "mind blown")
 * @returns {Promise<{ available:boolean, url?:string, source?:string, reason?:string }>}
 *          available:false bedeutet immer "schick einfach Text" — nie ein Fehler.
 */
export async function findGif(query) {
  try {
    if (!isGifEnabled()) return { available: false, reason: 'disabled' };
    const q = String(query || '').trim();
    if (!q) return { available: false, reason: 'empty_query' };

    // 1) Local-Set zuerst — kein Netz, kein Cringe-Risiko, kein toter Link.
    const local = matchLocalSet(q);
    if (local) return { available: true, url: local, source: 'local' };

    // 2) Dynamischer Provider als Fallback (nur wenn Key gesetzt).
    const dyn = await searchDynamic(q);
    if (dyn) return { available: true, url: dyn, source: detectProvider() || 'dynamic' };

    return { available: false, reason: 'no_match' };
  } catch (err) {
    // NIE werfen — im Zweifel kein GIF.
    return { available: false, reason: 'error:' + (err?.message || 'unknown') };
  }
}

/** Diagnose fuer Health/Status — verraet keine Keys. */
export function gifSourceStatus() {
  return {
    enabled: isGifEnabled(),
    localSetSize: LOCAL_SET.length,
    dynamicProvider: detectProvider(),
  };
}

export default { findGif, isGifEnabled, gifSourceStatus };
