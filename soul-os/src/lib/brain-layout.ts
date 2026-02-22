// Brain node definitions — ported from soul-monitor/lib/brain.js
// Positions are relative to a normalized coordinate system (0-60 x, 0-30 y)

export interface BrainNode {
  x: number;
  y: number;
  label: string;
  color: string; // CSS variable name
  desc: string;
}

export const NODES: Record<string, BrainNode> = {
  seed:        { x: 30, y: 2,  label: "SEED",        color: "var(--seed)",        desc: "Identity" },
  kern:        { x: 30, y: 6,  label: "KERN",        color: "var(--kern)",        desc: "Axioms" },
  bewusstsein: { x: 18, y: 8,  label: "BEWUSSTSEIN", color: "var(--bewusstsein)", desc: "Consciousness" },
  schatten:    { x: 42, y: 8,  label: "SCHATTEN",    color: "var(--schatten)",    desc: "Shadow" },
  traeume:     { x: 10, y: 14, label: "TRAEUME",     color: "var(--traeume)",     desc: "Dreams" },
  garten:      { x: 50, y: 14, label: "GARTEN",      color: "var(--garten)",      desc: "Garden" },
  mem:         { x: 18, y: 20, label: "MEM",         color: "var(--mem)",         desc: "Memory" },
  bonds:       { x: 42, y: 20, label: "BONDS",       color: "var(--bonds)",       desc: "Relationships" },
  interessen:  { x: 10, y: 20, label: "INTERESSEN",  color: "var(--interessen)",  desc: "Interests" },
  heartbeat:   { x: 30, y: 24, label: "HEARTBEAT",   color: "var(--heartbeat)",   desc: "Pulse" },
  manifest:    { x: 50, y: 20, label: "MANIFEST",    color: "var(--manifest)",    desc: "Creation" },
  evolution:   { x: 8,  y: 26, label: "EVOLUTION",   color: "var(--evolution)",   desc: "Growth" },
  wachstum:    { x: 52, y: 26, label: "WACHSTUM",    color: "var(--wachstum)",    desc: "Change" },
  statelog:    { x: 30, y: 28, label: "STATELOG",     color: "var(--statelog)",    desc: "Archive" },
  graph:       { x: 42, y: 14, label: "GRAPH",       color: "var(--graph)",       desc: "Knowledge" },
};

// Neural connections between nodes
export const CONNECTIONS: [string, string][] = [
  ["seed", "kern"],
  ["kern", "bewusstsein"],
  ["kern", "schatten"],
  ["bewusstsein", "traeume"],
  ["bewusstsein", "mem"],
  ["bewusstsein", "interessen"],
  ["schatten", "garten"],
  ["schatten", "bonds"],
  ["traeume", "mem"],
  ["traeume", "garten"],
  ["mem", "heartbeat"],
  ["bonds", "heartbeat"],
  ["bonds", "manifest"],
  ["heartbeat", "statelog"],
  ["heartbeat", "evolution"],
  ["heartbeat", "wachstum"],
  ["interessen", "evolution"],
  ["garten", "manifest"],
  ["garten", "wachstum"],
  ["seed", "heartbeat"],
  ["mem", "graph"],
  ["graph", "bonds"],
  ["graph", "bewusstsein"],
];
