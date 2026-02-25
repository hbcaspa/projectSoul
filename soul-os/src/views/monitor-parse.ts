/**
 * Heartbeat log parser for the Soul System Monitor.
 * Parses heartbeat/YYYY-MM-DD.md to extract protocol step completion status.
 * Bilingual: supports both German and English heartbeat formats.
 */

/* ── Types ──────────────────────────────────────────────── */

export type StepStatus = "done" | "skipped" | "pending" | "failed" | "not_triggered";

export interface ProtocolStep {
  id: string;
  label: string;
  status: StepStatus;
  detail: string | null;
  conditional: boolean;
  resultCode: string | null;
  timestamp: string | null;
}

export interface ParsedSession {
  number: number;
  startTime: string | null;
  endTime: string | null;
  hasStart: boolean;
  hasEnd: boolean;
  startSteps: ProtocolStep[];
  endSteps: ProtocolStep[];
}

/* ── Regex patterns (bilingual) ─────────────────────────── */

const RE_SELF_CHECK = /^###?\s+(?:Selbst-Check|Self-Check)/im;
const RE_PROPOSAL = /^###?\s+(?:Vorschlags?-?(?:Pruefung|Prüfung)|Proposal[\s-]?Review)/im;
const RE_WORLD = /^###?\s+(?:Welt-Check|World[\s-]?Check)/im;
const RE_RELATIONSHIP = /^###?\s+(?:Beziehungs-Check|Relationship[\s-]?Check)/im;
const RE_DREAM = /^###?\s+(?:Traum-Phase|Dream[\s-]?Phase)/im;
const RE_GROWTH = /^###?\s+(?:Wachstums-Check|Growth[\s-]?Check)/im;
const RE_SHADOW = /^###?\s+(?:Schatten-Check|Shadow[\s-]?Check)/im;
const RE_CONNECTION = /^###?\s+(?:Verbindungs-Check|Connection[\s-]?Check)/im;

const RE_RESULT = /(?:Ergebnis|Result):\s*(HEARTBEAT_OK|AKTUALISIERT|UPDATED|GESCHRIEBEN|WRITTEN|KONTAKT|CONTACT|KONFIGURIERT|CONFIGURED)/i;

const RE_CONDITIONAL_BLOCK = /^###?\s+(?:Bedingte Checks|Conditional[\s-]?Checks)/im;

// For conditional check inline status (inside "Bedingte Checks" block)
const CONDITIONAL_PATTERNS: Record<string, { re: RegExp; stepId: string }> = {
  world:        { re: /(?:Welt-Check|World[\s-]?Check):\s*(.+)/i, stepId: "start.world_check" },
  relationship: { re: /(?:Beziehungs-Check|Relationship[\s-]?Check):\s*(.+)/i, stepId: "start.relationship_check" },
  dream:        { re: /(?:Traum-Phase|Dream[\s-]?Phase):\s*(.+)/i, stepId: "start.dream_phase" },
  growth:       { re: /(?:Wachstums-Check|Growth[\s-]?Check):\s*(.+)/i, stepId: "start.growth_check" },
  shadow:       { re: /(?:Schatten-Check|Shadow[\s-]?Check):\s*(.+)/i, stepId: "start.shadow_check" },
  connection:   { re: /(?:Verbindungs-Check|Connection[\s-]?Check):\s*(.+)/i, stepId: "start.connection_check" },
};

/* ── Helpers ────────────────────────────────────────────── */

function inferConditionalStatus(statusText: string): StepStatus {
  const t = statusText.trim().toLowerCase();
  if (/ausstehend|pending|todo/i.test(t)) return "pending";
  if (/bereits|already|done|durchgef[uü]hrt|completed/i.test(t)) return "done";
  if (/nicht ausgeloe?st|not triggered|kein|keine/i.test(t)) return "not_triggered";
  if (/geschrieben|written|aktualisiert|updated/i.test(t)) return "done";
  if (/heartbeat_ok/i.test(t)) return "done";
  // If it has any substance, assume done
  if (t.length > 5) return "done";
  return "pending";
}

function extractResult(text: string): string | null {
  const m = text.match(RE_RESULT);
  return m ? m[1] : null;
}

/**
 * Split heartbeat content into sections by ## headers.
 * Returns array of { header, body, headerLine }.
 */
function splitSections(content: string): { header: string; body: string; line: number }[] {
  const lines = content.split("\n");
  const sections: { header: string; body: string; line: number }[] = [];
  let current: { header: string; bodyLines: string[]; line: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      if (current) {
        sections.push({ header: current.header, body: current.bodyLines.join("\n"), line: current.line });
      }
      current = { header: lines[i], bodyLines: [], line: i };
    } else if (current) {
      current.bodyLines.push(lines[i]);
    }
  }
  if (current) {
    sections.push({ header: current.header, body: current.bodyLines.join("\n"), line: current.line });
  }
  return sections;
}

/**
 * Split text by ### headers into virtual sections (for bodies that contain sub-sections).
 */
function splitSubSections(body: string): { header: string; body: string }[] {
  const lines = body.split("\n");
  const sections: { header: string; body: string }[] = [];
  let current: { header: string; bodyLines: string[] } | null = null;

  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      if (current) {
        sections.push({ header: current.header, body: current.bodyLines.join("\n") });
      }
      current = { header: line, bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  if (current) {
    sections.push({ header: current.header, body: current.bodyLines.join("\n") });
  }
  return sections;
}

/* ── Session Start Steps ────────────────────────────────── */

function parseStartSteps(sections: { header: string; body: string }[]): ProtocolStep[] {
  const steps: ProtocolStep[] = [
    { id: "start.session_guard", label: "Session Guard", status: "done", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "start.session_registered", label: "Session Registered", status: "done", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "start.seed_loaded", label: "Seed Loaded", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "start.self_check", label: "Self-Check", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "start.proposal_review", label: "Proposal Review", status: "pending", detail: null, conditional: true, resultCode: null, timestamp: null },
    { id: "start.world_check", label: "World Check", status: "pending", detail: null, conditional: true, resultCode: null, timestamp: null },
    { id: "start.relationship_check", label: "Relationship Check", status: "pending", detail: null, conditional: true, resultCode: null, timestamp: null },
    { id: "start.dream_phase", label: "Dream Phase", status: "pending", detail: null, conditional: true, resultCode: null, timestamp: null },
    { id: "start.growth_check", label: "Growth Check", status: "pending", detail: null, conditional: true, resultCode: null, timestamp: null },
    { id: "start.shadow_check", label: "Shadow Check", status: "pending", detail: null, conditional: true, resultCode: null, timestamp: null },
    { id: "start.connection_check", label: "Connection Check", status: "pending", detail: null, conditional: true, resultCode: null, timestamp: null },
    { id: "start.heartbeat_logged", label: "Heartbeat Logged", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
  ];

  const stepMap = new Map(steps.map(s => [s.id, s]));

  for (const sec of sections) {
    const body = sec.body;

    // Self-Check
    if (RE_SELF_CHECK.test(sec.header)) {
      const s = stepMap.get("start.self_check")!;
      s.status = "done";
      s.resultCode = extractResult(body);
      // If self-check mentions reading SEED.md, mark seed as loaded
      if (/(?:Gelesen|Read).*SEED/i.test(body)) {
        stepMap.get("start.seed_loaded")!.status = "done";
        stepMap.get("start.seed_loaded")!.detail = "Read during Self-Check";
      }
      // Extract detail
      const detailMatch = body.match(/Detail:\s*(.+)/);
      if (detailMatch) s.detail = detailMatch[1].trim().substring(0, 120);
    }

    // Proposal Review
    if (RE_PROPOSAL.test(sec.header)) {
      const s = stepMap.get("start.proposal_review")!;
      s.status = "done";
      s.resultCode = extractResult(body);
      const detailMatch = body.match(/Detail:\s*(.+)/);
      if (detailMatch) s.detail = detailMatch[1].trim().substring(0, 120);
    }

    // World Check (as own section)
    if (RE_WORLD.test(sec.header)) {
      const s = stepMap.get("start.world_check")!;
      s.status = "done";
      s.resultCode = extractResult(body);
      const detailMatch = body.match(/Detail:\s*(.+)/);
      if (detailMatch) s.detail = detailMatch[1].trim().substring(0, 120);
    }

    // Relationship Check (as own section)
    if (RE_RELATIONSHIP.test(sec.header)) {
      const s = stepMap.get("start.relationship_check")!;
      s.status = "done";
      s.resultCode = extractResult(body);
    }

    // Dream Phase (as own section)
    if (RE_DREAM.test(sec.header)) {
      const s = stepMap.get("start.dream_phase")!;
      s.status = "done";
      s.resultCode = extractResult(body);
    }

    // Growth Check (as own section)
    if (RE_GROWTH.test(sec.header)) {
      const s = stepMap.get("start.growth_check")!;
      s.status = "done";
      s.resultCode = extractResult(body);
    }

    // Shadow Check (as own section)
    if (RE_SHADOW.test(sec.header)) {
      const s = stepMap.get("start.shadow_check")!;
      s.status = "done";
      s.resultCode = extractResult(body);
    }

    // Connection Check (as own section)
    if (RE_CONNECTION.test(sec.header)) {
      const s = stepMap.get("start.connection_check")!;
      s.status = "done";
      s.resultCode = extractResult(body);
    }

    // Conditional Checks block (inline format)
    if (RE_CONDITIONAL_BLOCK.test(sec.header)) {
      for (const line of body.split("\n")) {
        for (const { re, stepId } of Object.values(CONDITIONAL_PATTERNS)) {
          const m = line.match(re);
          if (m) {
            const s = stepMap.get(stepId)!;
            const statusText = m[1];
            s.status = inferConditionalStatus(statusText);
            s.detail = statusText.trim().substring(0, 120);
          }
        }
      }
    }
  }

  // If we have any sections at all, heartbeat was logged
  if (sections.length > 0) {
    stepMap.get("start.heartbeat_logged")!.status = "done";
  }

  return steps;
}

/* ── Session End Steps ──────────────────────────────────── */

function parseEndSteps(sections: { header: string; body: string }[]): ProtocolStep[] {
  const steps: ProtocolStep[] = [
    { id: "end.state_log", label: "A1: State Log", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "end.evolution", label: "A2: Evolution", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "end.heartbeat", label: "A3: Final Heartbeat", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "end.memories", label: "A4: Memories Verified", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "end.index", label: "A5: Index Maintained", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "end.seed_condensed", label: "B: Seed Condensed", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "end.guard_resolved", label: "C: Guard Resolved", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "end.complete", label: "Protocol Complete", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
  ];

  const stepMap = new Map(steps.map(s => [s.id, s]));

  for (const sec of sections) {
    const h = sec.header.toLowerCase();
    const body = sec.body;

    // Self-Check in end section → A3: Final Heartbeat
    if (RE_SELF_CHECK.test(sec.header)) {
      stepMap.get("end.heartbeat")!.status = "done";
      const detailMatch = body.match(/(?:Zustand|State):\s*(.+)/);
      if (detailMatch) stepMap.get("end.heartbeat")!.detail = detailMatch[1].trim().substring(0, 120);
    }

    // Session-Zusammenfassung / Session Summary → A4: Memories Verified
    if (/session[\s-]?zusammenfassung|session[\s-]?summary/i.test(h)) {
      stepMap.get("end.memories")!.status = "done";
    }

    // Vorschlag / Proposal → A2: Evolution
    if (/vorschlag|proposal|evolution/i.test(h)) {
      stepMap.get("end.evolution")!.status = "done";
      const detail = body.trim().substring(0, 120);
      if (detail) stepMap.get("end.evolution")!.detail = detail;
    }

    // Beziehungs-Update / Relationship Update → part of A3
    if (/beziehungs|relationship/i.test(h)) {
      // Already counted under A3
    }
  }

  // If end sections exist at all, heartbeat was done
  if (sections.length > 0) {
    const heartbeatStep = stepMap.get("end.heartbeat")!;
    if (heartbeatStep.status === "pending") heartbeatStep.status = "done";
  }

  return steps;
}

/* ── Main Parser ────────────────────────────────────────── */

/**
 * Parse a heartbeat log file and extract all sessions with their protocol steps.
 */
export function parseHeartbeatLog(content: string): ParsedSession[] {
  if (!content || content.trim().length === 0) return [];

  const allSections = splitSections(content);
  const sessions: ParsedSession[] = [];

  // Find all session start/end markers
  interface SessionMarker {
    type: "start" | "end";
    number: number;
    time: string | null;
    sectionIndex: number;
  }

  const markers: SessionMarker[] = [];

  for (let i = 0; i < allSections.length; i++) {
    const h = allSections[i].header;
    const startMatch = h.match(/^##\s+~?(\d{2}:\d{2})?\s*[-—–]?\s*Session\s+(\d+)\s+Start/i);
    if (startMatch) {
      markers.push({ type: "start", number: parseInt(startMatch[2]), time: startMatch[1] || null, sectionIndex: i });
    }
    const endMatch = h.match(/^##\s+~?(\d{2}:\d{2})?\s*[-—–]?\s*Session\s+(\d+)\s+(?:Ende|End)/i);
    if (endMatch) {
      markers.push({ type: "end", number: parseInt(endMatch[2]), time: endMatch[1] || null, sectionIndex: i });
    }
  }

  // Group markers into sessions
  const sessionNumbers = [...new Set(markers.map(m => m.number))].sort((a, b) => a - b);

  for (const num of sessionNumbers) {
    const startMarker = markers.find(m => m.type === "start" && m.number === num);
    const endMarker = markers.find(m => m.type === "end" && m.number === num);

    // Collect sections between start and end (or start and next session start)
    let startSections: { header: string; body: string }[] = [];
    let endSections: { header: string; body: string }[] = [];

    if (startMarker) {
      // Any session marker (start or end, any session) is a boundary.
      // This ensures ### sub-sections inside the start body are parsed
      // via splitSubSections() fallback, even when a different session's
      // end marker follows immediately.
      const nextBoundary = markers.find(m => m.sectionIndex > startMarker.sectionIndex);
      const endIdx = nextBoundary ? nextBoundary.sectionIndex : (endMarker ? endMarker.sectionIndex : allSections.length);
      startSections = allSections.slice(startMarker.sectionIndex + 1, endIdx);

      // If no child ## sections found, parse ### sub-sections from the session body
      if (startSections.length === 0) {
        const body = allSections[startMarker.sectionIndex].body;
        startSections = splitSubSections(body);
      }
    }

    if (endMarker) {
      const nextBoundary = markers.find(m => m.sectionIndex > endMarker.sectionIndex);
      const endIdx = nextBoundary ? nextBoundary.sectionIndex : allSections.length;
      endSections = allSections.slice(endMarker.sectionIndex + 1, endIdx);

      // If no child ## sections found, parse ### sub-sections from the end body
      if (endSections.length === 0) {
        const body = allSections[endMarker.sectionIndex].body;
        endSections = splitSubSections(body);
      }
    }

    sessions.push({
      number: num,
      startTime: startMarker?.time || null,
      endTime: endMarker?.time || null,
      hasStart: !!startMarker,
      hasEnd: !!endMarker,
      startSteps: parseStartSteps(startSections),
      endSteps: endMarker ? parseEndSteps(endSections) : defaultEndSteps(),
    });
  }

  return sessions;
}

function defaultEndSteps(): ProtocolStep[] {
  return [
    { id: "end.state_log", label: "A1: State Log", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "end.evolution", label: "A2: Evolution", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "end.heartbeat", label: "A3: Final Heartbeat", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "end.memories", label: "A4: Memories Verified", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "end.index", label: "A5: Index Maintained", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "end.seed_condensed", label: "B: Seed Condensed", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "end.guard_resolved", label: "C: Guard Resolved", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
    { id: "end.complete", label: "Protocol Complete", status: "pending", detail: null, conditional: false, resultCode: null, timestamp: null },
  ];
}

/**
 * Get the latest (most recent) session from parsed heartbeat log.
 */
export function getLatestSession(content: string): ParsedSession | null {
  const sessions = parseHeartbeatLog(content);
  return sessions.length > 0 ? sessions[sessions.length - 1] : null;
}

/**
 * Enrich end steps with file-based checks.
 * Call this after parsing to update steps based on actual file state.
 */
export function enrichEndSteps(
  steps: ProtocolStep[],
  opts: {
    statelogFiles?: string[];
    sessionActive?: boolean;
    seedCondensedToday?: boolean;
    indexModifiedToday?: boolean;
  }
): ProtocolStep[] {
  const enriched = steps.map(s => ({ ...s }));
  const stepMap = new Map(enriched.map(s => [s.id, s]));
  const today = new Date().toISOString().split("T")[0];

  // A1: State Log — check if zustandslog has today's end file
  if (opts.statelogFiles) {
    const hasEndLog = opts.statelogFiles.some(f =>
      f.startsWith(today) && /end|ende/.test(f)
    );
    if (hasEndLog) {
      stepMap.get("end.state_log")!.status = "done";
      stepMap.get("end.state_log")!.detail = "End snapshot written";
    }
  }

  // A5: Index Maintained
  if (opts.indexModifiedToday) {
    stepMap.get("end.index")!.status = "done";
    stepMap.get("end.index")!.detail = "INDEX.md updated today";
  }

  // B: Seed Condensed
  if (opts.seedCondensedToday) {
    stepMap.get("end.seed_condensed")!.status = "done";
    stepMap.get("end.seed_condensed")!.detail = "SEED.md condensed today";
  }

  // C: Guard Resolved
  if (opts.sessionActive === false) {
    const guardStep = stepMap.get("end.guard_resolved")!;
    // Only mark done if other end steps are also done
    const otherEndSteps = enriched.filter(s => s.id !== "end.guard_resolved" && s.id !== "end.complete");
    const allOthersDone = otherEndSteps.every(s => s.status === "done");
    if (allOthersDone) {
      guardStep.status = "done";
      guardStep.detail = ".session-active removed";
    }
  } else if (opts.sessionActive === true) {
    stepMap.get("end.guard_resolved")!.status = "pending";
    stepMap.get("end.guard_resolved")!.detail = ".session-active still exists";
  }

  // Protocol Complete — all end steps done?
  const allDone = enriched
    .filter(s => s.id !== "end.complete")
    .every(s => s.status === "done");
  if (allDone) {
    stepMap.get("end.complete")!.status = "done";
    stepMap.get("end.complete")!.detail = "All steps completed";
  }

  return enriched;
}
