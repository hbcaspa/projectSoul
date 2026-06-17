/**
 * STT — Speech-to-Text für eingehende Sprachnachrichten (Telegram Voice etc.).
 * Nutzt Gemini-Audio (inlineData) — beide Nodes haben GEMINI_API_KEY, kein
 * Modell-Download, kein zusätzlicher Provider nötig. Gemini akzeptiert audio/ogg
 * (Telegram-Voice = OGG/Opus) direkt.
 *
 * Stufe 0 von "agentische Selbst-Erweiterung": die häufige Lücke (Voice transkribieren)
 * deterministisch fest verdrahtet — der OpenClaw-Ansatz "verdrahtet statt emergent"
 * für wiederkehrende Aufgaben.
 *
 * Wirft NIE — gibt bei Fehler null zurück (der Aufruferpfad degradiert dann sauber).
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

export async function transcribeAudio(buffer, mimeType = 'audio/ogg', {
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.STT_MODEL || process.env.GEMINI_MODEL || 'gemini-3.5-flash',
} = {}) {
  if (!apiKey || !buffer || !buffer.length) return null;
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const m = genAI.getGenerativeModel({ model });
    const result = await m.generateContent([
      { inlineData: { mimeType, data: Buffer.from(buffer).toString('base64') } },
      { text: 'Transkribiere diese Sprachnachricht wörtlich. Gib AUSSCHLIESSLICH den gesprochenen Text zurück — keine Einleitung, keine Anführungszeichen, keine Beschreibung. Falls keine Sprache erkennbar ist, gib einen leeren String zurück.' },
    ]);
    const text = (result.response.text() || '').trim();
    return text || null;
  } catch (err) {
    console.error(`  [stt] Transkription fehlgeschlagen: ${err.message}`);
    return null;
  }
}
