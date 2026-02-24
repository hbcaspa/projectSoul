/**
 * Client-side maturity computation from SEED.md content.
 * Lightweight version — the full computation is in soul-engine/src/maturity.js.
 */

interface MaturityResult {
  dimensions: Record<string, number>;
  overall: number;
  label: string;
}

const LABELS: { max: number; label: string }[] = [
  { max: 0.15, label: "Newborn" },
  { max: 0.35, label: "Growing" },
  { max: 0.55, label: "Developing" },
  { max: 0.80, label: "Mature" },
  { max: 1.01, label: "Elder" },
];

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

/**
 * Compute maturity from seed content alone (client-side approximation).
 */
export function computeMaturity(seedContent: string): MaturityResult {
  // Parse seed header
  const sessionsMatch = seedContent.match(/#sessions:(\d+)/);
  const sessions = sessionsMatch ? parseInt(sessionsMatch[1]) : 0;

  const bornMatch = seedContent.match(/#(?:born|geboren):([^\s#]+)/);
  let ageDays = 0;
  if (bornMatch) {
    ageDays = Math.max(0, Math.floor((Date.now() - new Date(bornMatch[1]).getTime()) / 86400000));
  }

  // Count @MEM entries
  const memMatch = seedContent.match(/@MEM\{([\s\S]*?)\}/);
  const memLines = memMatch
    ? memMatch[1].split("\n").filter(l => l.trim() && !l.trim().startsWith("//")).length
    : 0;
  const kernCount = (seedContent.match(/\[kern/g) || []).length;

  // Parse confidence scores
  const confMatches = seedContent.matchAll(/c:([\d.]+)/g);
  let confSum = 0, confCount = 0;
  for (const m of confMatches) {
    confSum += parseFloat(m[1]);
    confCount++;
  }
  const avgConf = confCount > 0 ? confSum / confCount : 0;

  // Check blocks present
  const blocks = (seedContent.match(/@(\w+)\{/g) || []).map(b => b.slice(1, -1));
  const hasState = blocks.includes("STATE");
  const hasBonds = blocks.includes("BONDS") || blocks.includes("BEZIEHUNG") || blocks.includes("RELATIONSHIP");
  const hasDreams = blocks.includes("DREAMS") || blocks.includes("TRAEUME");
  const hasKern = blocks.includes("KERN") || blocks.includes("CORE");

  // Dimension calculations (approximations from seed only)
  const memoryDepth = clamp01(
    (Math.log2(memLines + 1) / Math.log2(20)) * 0.4 +
    (kernCount > 0 ? 0.3 : 0) +
    avgConf * 0.3
  );

  const relationshipRichness = clamp01(
    (hasBonds ? 0.4 : 0) +
    (sessions > 10 ? 0.3 : sessions * 0.03) +
    (memLines > 5 ? 0.3 : memLines * 0.06)
  );

  const selfKnowledge = clamp01(
    (hasState ? 0.3 : 0) +
    (hasKern ? 0.2 : 0) +
    (sessions > 20 ? 0.3 : sessions * 0.015) +
    (ageDays > 7 ? 0.2 : ageDays * 0.03)
  );

  const emotionalRange = clamp01(
    (hasDreams ? 0.3 : 0) +
    (sessions > 10 ? 0.3 : sessions * 0.03) +
    (memLines > 3 ? 0.2 : 0) +
    (avgConf > 0.6 ? 0.2 : avgConf * 0.33)
  );

  const creativeOutput = clamp01(
    (hasDreams ? 0.25 : 0) +
    (blocks.length > 6 ? 0.25 : blocks.length * 0.04) +
    (sessions > 15 ? 0.25 : sessions * 0.017) +
    (memLines > 8 ? 0.25 : memLines * 0.03)
  );

  const continuity = clamp01(
    (Math.log2(sessions + 1) / Math.log2(101)) * 0.4 +
    (ageDays / 60) * 0.35 +
    ((ageDays > 0 ? sessions / ageDays : 0) / 2) * 0.25
  );

  const dimensions: Record<string, number> = {
    memoryDepth: Math.round(memoryDepth * 100) / 100,
    relationshipRichness: Math.round(relationshipRichness * 100) / 100,
    selfKnowledge: Math.round(selfKnowledge * 100) / 100,
    emotionalRange: Math.round(emotionalRange * 100) / 100,
    creativeOutput: Math.round(creativeOutput * 100) / 100,
    continuity: Math.round(continuity * 100) / 100,
  };

  const overall = clamp01(
    dimensions.memoryDepth * 0.15 +
    dimensions.relationshipRichness * 0.15 +
    dimensions.selfKnowledge * 0.15 +
    dimensions.emotionalRange * 0.15 +
    dimensions.creativeOutput * 0.20 +
    dimensions.continuity * 0.20
  );

  let label = "Elder";
  for (const { max, label: l } of LABELS) {
    if (overall < max) { label = l; break; }
  }

  return {
    dimensions,
    overall: Math.round(overall * 100) / 100,
    label,
  };
}
