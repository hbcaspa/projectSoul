// Node-Konfiguration + lokale Key-Verwaltung.
// Keys liegen in localStorage (lokale Desktop-App, einziger Nutzer) — NIE im Bundle.

import type { NodeConfig } from "./types";

export const NODES: NodeConfig[] = [
  { id: "mac", label: "macbook", base: "http://localhost:3002", local: true },
  // alm-Server: alms Engine lauscht nur lokal (Firewall) → NICHT öffentlich exponiert.
  // Erreichbar über einen lokalen SSH-Tunnel (Mac:3103 → alm-Engine:3002), sicher,
  // nichts öffentlich. Tunnel-Befehl siehe seele/INFRASTRUKTUR.md / README.
  // Base per localStorage 'soulosx.base.alm' überschreibbar (getBase), falls der Port wechselt.
  { id: "alm", label: "server", base: "http://localhost:3103", local: false },
];

const keyKey = (nodeId: string) => `soulosx.key.${nodeId}`;
const baseKey = (nodeId: string) => `soulosx.base.${nodeId}`;

export function getKey(nodeId: string): string {
  try { return localStorage.getItem(keyKey(nodeId)) || ""; } catch { return ""; }
}
export function setKey(nodeId: string, key: string): void {
  try { localStorage.setItem(keyKey(nodeId), key); } catch { /* */ }
}
export function clearKey(nodeId: string): void {
  try { localStorage.removeItem(keyKey(nodeId)); } catch { /* */ }
}

export function getBase(node: NodeConfig): string {
  try { return localStorage.getItem(baseKey(node.id)) || node.base; } catch { return node.base; }
}
export function setBase(nodeId: string, base: string): void {
  try { localStorage.setItem(baseKey(nodeId), base); } catch { /* */ }
}

// Welche Nodes sind aktiv (haben einen Key)? Für den MVP reicht der lokale Mac-Node.
export function configuredNodes(): NodeConfig[] {
  return NODES.map((n) => ({ ...n, base: getBase(n) }));
}
