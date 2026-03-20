import { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";

// Dashboard API URL — falls back to standalone server if engine API not available
const API_BASE = import.meta.env.VITE_TRADER_API
  || "http://localhost:3005/api";

// ── Types ─────────────────────────────────────────────────────

interface NewsData {
  available: boolean;
  timestamp?: string;
  overall?: number;
  coins?: Record<string, number>;
  top_news?: Array<{ title: string; source: string; url: string; sentiment: number; coins: string[]; published: string }>;
  article_count?: number;
  age_minutes?: number;
}

interface Portfolio {
  open_positions: Position[];
  closed_count: number;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  total_pnl_eur: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  profit_factor: number | null;
  paper_budget_eur: number;
  last_signal: Signal | null;
  pnl_timeline: PnlPoint[];
}

interface Position {
  id: string;
  coin: string;
  status: string;
  entry_price: number;
  entry_time: string;
  position_eur: number;
  stop_loss_price: number;
  confidence: number;
  s8_phase: string;
  contributing_strategies: string[];
  exit_price: number | null;
  exit_time: string | null;
  pnl_pct: number | null;
  pnl_eur: number | null;
  current_price?: number;
  current_pnl_pct?: number;
}

interface Signal {
  timestamp: string;
  action: string;
  coin: string;
  confidence: number;
  s8_phase: string;
  s8_score: number;
  contributing_strategies: string[];
  reason: string;
}

interface PnlPoint {
  date: string;
  pnl: number;
  cumPnl: number;
  coin: string;
}

// ── Constants ─────────────────────────────────────────────────

const PHASE_COLOR: Record<string, string> = {
  ALT_SEASON:      "#00ff88",
  ROTATION_ACTIVE: "#00c8ff",
  ROTATION_EARLY:  "#ffcc00",
  BTC_SEASON:      "#ff9600",
  ALT_MANIA:       "#ff66cc",
  EXIT:            "#ff4466",
  UNKNOWN:         "#404060",
};

const ACTION_COLOR: Record<string, string> = {
  BUY:   "#00ff88",
  SELL:  "#ff4466",
  HOLD:  "#404060",
  PAUSE: "#ffcc00",
};

// ── Helpers ───────────────────────────────────────────────────

const fmt = (n: number, d = 2) => (n ?? 0).toFixed(d);
const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${fmt(n, 1)}%`;
const fmtEur = (n: number) => `${n >= 0 ? "+" : ""}€${fmt(Math.abs(n))}`;

// ── Sub-components ─────────────────────────────────────────────

function StatCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 10,
      padding: "12px 16px",
    }}>
      <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || "#e0e0f0" }}>
        {value}
      </div>
      {sub && <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function SignalPill({ action }: { action: string }) {
  const color = ACTION_COLOR[action] || "#404060";
  return (
    <span style={{
      color,
      background: `${color}22`,
      border: `1px solid ${color}`,
      borderRadius: 4,
      padding: "2px 8px",
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 1,
      fontFamily: "monospace",
    }}>
      {action}
    </span>
  );
}

function PhasePill({ phase, score }: { phase: string; score?: number }) {
  const color = PHASE_COLOR[phase] || "#404060";
  return (
    <span style={{
      color,
      background: `${color}18`,
      border: `1px solid ${color}55`,
      borderRadius: 4,
      padding: "2px 8px",
      fontSize: 11,
      fontFamily: "monospace",
    }}>
      {phase}{score != null ? ` (${score})` : ""}
    </span>
  );
}

function PositionRow({ p }: { p: Position }) {
  const isOpen = p.status === "OPEN";
  const pnl = isOpen ? p.current_pnl_pct : p.pnl_pct;
  const pnlColor = (pnl ?? 0) >= 0 ? "#00ff88" : "#ff4466";

  return (
    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <td style={{ padding: "8px 10px", color: "#00c8ff", fontWeight: 600 }}>{p.coin}</td>
      <td style={{ padding: "8px 10px" }}>
        <span style={{
          fontSize: 10,
          color: isOpen ? "#00ff88" : p.status === "CLOSED_WIN" ? "#00ff88" : "#ff4466",
        }}>
          {isOpen ? "● OFFEN" : p.status === "CLOSED_WIN" ? "✓ WIN" : "✗ LOSS"}
        </span>
      </td>
      <td style={{ padding: "8px 10px", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
        ${fmt(p.entry_price, 4)}
      </td>
      <td style={{ padding: "8px 10px", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
        {isOpen
          ? `$${fmt(p.current_price ?? p.entry_price, 4)}`
          : p.exit_price ? `$${fmt(p.exit_price, 4)}` : "—"}
      </td>
      <td style={{ padding: "8px 10px", color: pnlColor, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
        {pnl != null ? fmtPct(pnl) : "—"}
      </td>
      <td style={{ padding: "8px 10px", color: pnlColor, fontVariantNumeric: "tabular-nums" }}>
        {p.pnl_eur != null ? fmtEur(p.pnl_eur) : "—"}
      </td>
      <td style={{ padding: "8px 10px", color: "rgba(255,255,255,0.3)", fontSize: 10 }}>
        {p.contributing_strategies?.map(s => s.split("_")[0]).join(", ")}
      </td>
    </tr>
  );
}

// ── Main Component ─────────────────────────────────────────────

export default function TraderView() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [news, setNews] = useState<NewsData | null>(null);
  const [tab, setTab] = useState<"overview" | "positions" | "signals" | "news">("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState("");

  const load = useCallback(async () => {
    try {
      const [p, s, n] = await Promise.all([
        fetch(`${API_BASE}/portfolio`).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
        fetch(`${API_BASE}/signals`).then(r => r.json()),
        fetch(`${API_BASE}/news`).then(r => r.json()).catch(() => null),
      ]);
      setPortfolio(p);
      setSignals(s);
      setNews(n);
      setError(null);
      setLastRefresh(new Date().toLocaleTimeString("de"));
    } catch (e: any) {
      setError(`Dashboard-Server nicht erreichbar: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
      Lade Trading-Daten...
    </div>
  );

  if (error) return (
    <div style={{ padding: 24 }}>
      <div style={{
        background: "rgba(255,68,102,0.08)", border: "1px solid rgba(255,68,102,0.3)",
        borderRadius: 8, padding: "16px 20px", color: "#ff4466",
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Dashboard-Server offline</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>{error}</div>
        <div style={{ fontSize: 11, marginTop: 8, color: "rgba(255,255,255,0.3)" }}>
          Start: <code>cd trader-arena/dashboard && npm start</code>
        </div>
      </div>
    </div>
  );

  const p = portfolio!;
  const pnlColor = p.total_pnl_eur >= 0 ? "#00ff88" : "#ff4466";
  const lastSig = p.last_signal;

  return (
    <div style={{ height: "100%", overflow: "auto", padding: "20px 20px" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#00ff88", letterSpacing: 3, fontFamily: "monospace" }}>
            TRADER ARENA
          </div>
          <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, marginTop: 2 }}>
            Paper Trading · Budget €{p.paper_budget_eur}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          {lastSig && (
            <div style={{ display: "flex", gap: 8 }}>
              <PhasePill phase={lastSig.s8_phase} score={lastSig.s8_score} />
              <SignalPill action={lastSig.action} />
            </div>
          )}
          <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 10 }}>
            ↻ {lastRefresh}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
        <StatCard
          label="Gesamt PnL"
          value={fmtEur(p.total_pnl_eur)}
          sub={`${p.closed_count} Trades abgeschlossen`}
          color={pnlColor}
        />
        <StatCard
          label="Win Rate"
          value={`${fmt(p.win_rate_pct, 1)}%`}
          sub={`${p.wins}W / ${p.losses}L`}
          color={p.win_rate_pct >= 50 ? "#00ff88" : "#ff4466"}
        />
        <StatCard
          label="Profit Factor"
          value={p.profit_factor != null ? fmt(p.profit_factor, 2) : "—"}
          sub={`Ø ${fmtPct(p.avg_win_pct)} / ${fmtPct(p.avg_loss_pct)}`}
          color={p.profit_factor != null && p.profit_factor >= 1.5 ? "#00ff88" : "#ffcc00"}
        />
        <StatCard
          label="Positionen"
          value={`${p.open_positions.length}/3`}
          sub="offen (max 3)"
          color="#00c8ff"
        />
      </div>

      {/* Last Signal */}
      {lastSig && (
        <div style={{
          background: `${PHASE_COLOR[lastSig.s8_phase] || "#404060"}0d`,
          border: `1px solid ${PHASE_COLOR[lastSig.s8_phase] || "#404060"}44`,
          borderLeft: `3px solid ${PHASE_COLOR[lastSig.s8_phase] || "#404060"}`,
          borderRadius: 8,
          padding: "12px 16px",
          marginBottom: 20,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <SignalPill action={lastSig.action} />
              {lastSig.coin && (
                <span style={{ color: "#00c8ff", fontWeight: 700, fontFamily: "monospace" }}>
                  {lastSig.coin}
                </span>
              )}
              <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 11 }}>
                {Math.round(lastSig.confidence * 100)}% Confidence
              </span>
            </div>
            <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 11 }}>
              {lastSig.timestamp?.slice(0, 16).replace("T", " ")} UTC
            </span>
          </div>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 12, lineHeight: 1.5 }}>
            {lastSig.reason?.slice(0, 200)}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        {(["overview", "positions", "signals", "news"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "7px 16px", fontSize: 12,
            color: tab === t ? "#00ff88" : "rgba(255,255,255,0.35)",
            borderBottom: tab === t ? "2px solid #00ff88" : "2px solid transparent",
            fontFamily: "monospace",
          }}>
            {t === "overview" ? "Übersicht" : t === "positions" ? "Positionen" : t === "signals" ? "Signale" : "News"}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === "overview" && (
        <div>
          {p.pnl_timeline.length > 1 ? (
            <div style={{
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8, padding: "16px", marginBottom: 16,
            }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
                Kumulativer PnL
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={p.pnl_timeline}>
                  <XAxis dataKey="date" tick={{ fill: "#404060", fontSize: 9 }} tickLine={false} />
                  <YAxis tick={{ fill: "#404060", fontSize: 9 }} tickLine={false} tickFormatter={v => `€${v}`} />
                  <Tooltip
                    contentStyle={{ background: "#0e0e1a", border: "1px solid #1e1e30", borderRadius: 6, fontSize: 11 }}
                    formatter={(v: any) => [`€${(v as number).toFixed(2)}`, "PnL"]}
                  />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
                  <Line type="monotone" dataKey="cumPnl" stroke="#00ff88" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{
              background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 8, padding: "32px 16px", textAlign: "center",
              color: "rgba(255,255,255,0.2)", fontSize: 12, marginBottom: 16,
            }}>
              Chart erscheint nach dem ersten abgeschlossenen Trade
            </div>
          )}

          {p.open_positions.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                Offene Positionen
              </div>
              <PositionsTable positions={p.open_positions} />
            </>
          )}
        </div>
      )}

      {/* Positions */}
      {tab === "positions" && <PositionsTable positions={p.open_positions} />}

      {/* News */}
      {tab === "news" && <NewsTab news={news} />}

      {/* Signals */}
      {tab === "signals" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {signals.map((s, i) => (
            <div key={i} style={{
              background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
              borderLeft: `2px solid ${ACTION_COLOR[s.action] || "#404060"}`,
              borderRadius: 6, padding: "10px 14px",
            }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                <SignalPill action={s.action} />
                {s.coin && <span style={{ color: "#00c8ff", fontWeight: 600, fontFamily: "monospace" }}>{s.coin}</span>}
                <PhasePill phase={s.s8_phase} />
                <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 10 }}>
                  {Math.round(s.confidence * 100)}%
                </span>
                <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 10, marginLeft: "auto" }}>
                  {s.timestamp?.slice(0, 16).replace("T", " ")}
                </span>
              </div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>
                {s.reason?.slice(0, 160)}
              </div>
            </div>
          ))}
          {signals.length === 0 && (
            <div style={{ color: "rgba(255,255,255,0.2)", padding: "32px", textAlign: "center", fontSize: 12 }}>
              Noch keine Signale — erster täglicher Run steht aus (08:00 UTC)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SentimentBar({ value, label }: { value: number; label: string }) {
  const clamp = Math.max(-1, Math.min(1, value));
  const pct = ((clamp + 1) / 2) * 100;
  const color = clamp > 0.1 ? "#00ff88" : clamp < -0.1 ? "#ff4466" : "#ffcc00";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <div style={{ width: 48, color: "rgba(255,255,255,0.5)", fontSize: 11, fontFamily: "monospace", flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.07)", borderRadius: 3, position: "relative" }}>
        <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: 6, background: "rgba(255,255,255,0.2)" }} />
        {clamp >= 0
          ? <div style={{ position: "absolute", left: "50%", width: `${pct - 50}%`, height: 6, background: color, borderRadius: "0 3px 3px 0" }} />
          : <div style={{ position: "absolute", right: `${50}%`, width: `${50 - pct}%`, height: 6, background: color, borderRadius: "3px 0 0 3px" }} />
        }
      </div>
      <div style={{ width: 40, color, fontSize: 11, fontFamily: "monospace", textAlign: "right" }}>
        {clamp >= 0 ? "+" : ""}{clamp.toFixed(2)}
      </div>
    </div>
  );
}

function NewsTab({ news }: { news: NewsData | null }) {
  if (!news || !news.available) {
    return (
      <div style={{ color: "rgba(255,255,255,0.2)", padding: "32px", textAlign: "center", fontSize: 12 }}>
        <div>Noch keine News-Daten</div>
        <div style={{ marginTop: 8, fontSize: 11 }}>Werden beim nächsten Trader-Run (alle 15 min) geladen</div>
      </div>
    );
  }

  const overall = news.overall ?? 0;
  const overallColor = overall > 0.1 ? "#00ff88" : overall < -0.1 ? "#ff4466" : "#ffcc00";
  const overallLabel = overall > 0.2 ? "Bullish" : overall > 0.05 ? "Leicht bullish" : overall < -0.2 ? "Bearish" : overall < -0.05 ? "Leicht bearish" : "Neutral";
  const sortedCoins = Object.entries(news.coins || {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Overall + age */}
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{
          flex: 1,
          background: `${overallColor}08`, border: `1px solid ${overallColor}33`,
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Markt-Sentiment
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, color: overallColor, fontFamily: "monospace" }}>
            {overall >= 0 ? "+" : ""}{overall.toFixed(2)}
          </div>
          <div style={{ fontSize: 11, color: overallColor, marginTop: 4 }}>{overallLabel}</div>
        </div>
        <div style={{
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 8, padding: "14px 16px", minWidth: 120,
        }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Datenalter
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: (news.age_minutes ?? 0) > 30 ? "#ffcc00" : "#e0e0f0" }}>
            {news.age_minutes ?? "?"}m
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>{news.article_count ?? 0} Artikel</div>
        </div>
      </div>

      {/* Coin sentiment bars */}
      {sortedCoins.length > 0 && (
        <div style={{
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Coin-Sentiment
          </div>
          {sortedCoins.map(([coin, val]) => (
            <SentimentBar key={coin} label={coin} value={val} />
          ))}
        </div>
      )}

      {/* Top headlines */}
      {news.top_news && news.top_news.length > 0 && (
        <div style={{
          background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 8, padding: "14px 16px",
        }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Top Headlines
          </div>
          {news.top_news.map((article, i) => {
            const sc = article.sentiment;
            const ac = sc > 0.1 ? "#00ff88" : sc < -0.1 ? "#ff4466" : "#ffcc00";
            return (
              <div key={i} style={{
                borderBottom: i < news.top_news!.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                paddingBottom: 8, marginBottom: 8,
                display: "flex", gap: 10, alignItems: "flex-start",
              }}>
                <div style={{
                  width: 36, flexShrink: 0,
                  color: ac, fontSize: 10, fontFamily: "monospace",
                  paddingTop: 2,
                }}>
                  {sc >= 0 ? "+" : ""}{sc.toFixed(2)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", lineHeight: 1.4 }}>
                    {article.title}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
                    {article.source} · {article.coins.join(", ")}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PositionsTable({ positions }: { positions: Position[] }) {
  if (positions.length === 0) {
    return (
      <div style={{ color: "rgba(255,255,255,0.2)", padding: "24px", textAlign: "center", fontSize: 12 }}>
        Keine offenen Positionen
      </div>
    );
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          {["Coin", "Status", "Einstieg", "Aktuell", "PnL %", "PnL €", "Strategien"].map(h => (
            <th key={h} style={{
              padding: "6px 10px", color: "rgba(255,255,255,0.25)", fontSize: 10,
              textAlign: "left", textTransform: "uppercase", letterSpacing: 1, fontWeight: 400,
            }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {positions.map(p => <PositionRow key={p.id} p={p} />)}
      </tbody>
    </table>
  );
}
