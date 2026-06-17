// Node-Konfiguration + lokale Key-Verwaltung.
// Keys liegen in localStorage (lokale Desktop-App, einziger Nutzer) — NIE im Bundle.

import type { NodeConfig } from "./types";

export const NODES: NodeConfig[] = [
  { id: "mac", label: "macbook", base: "http://localhost:3002", local: true },
  // alm-Server: über die Domain erreichbar; engine_fetch (Rust/reqwest) umgeht CORS.
  // base bei Bedarf in den Einstellungen anpassbar (siehe key/base-Storage unten).
  { id: "alm", label: "server", base: "https://alm-solutions.de", local: false },
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
