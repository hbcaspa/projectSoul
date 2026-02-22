// Soul color palette — ported from soul-monitor/lib/colors.js
// All colors as [R, G, B] tuples for Canvas rendering

export const PALETTE: Record<string, [number, number, number]> = {
  // Primary glow colors
  cyan:     [0, 255, 255],
  magenta:  [255, 0, 200],
  gold:     [255, 200, 0],
  white:    [220, 220, 255],
  dimWhite: [100, 100, 130],

  // Node-specific colors
  kern:        [255, 60, 60],
  bewusstsein: [0, 255, 200],
  schatten:    [160, 0, 255],
  traeume:     [100, 100, 255],
  wachstum:    [0, 255, 100],
  garten:      [180, 255, 0],
  mem:         [255, 200, 0],
  bonds:       [255, 100, 150],
  interessen:  [0, 200, 255],
  heartbeat:   [255, 50, 50],
  seed:        [255, 255, 255],
  manifest:    [255, 150, 0],
  evolution:   [200, 100, 255],
  statelog:    [80, 200, 180],
  graph:       [0, 220, 180],

  // Background
  bg:       [8, 8, 20],
  bgLight:  [15, 15, 35],

  // Connection lines
  line:     [40, 40, 80],
  lineGlow: [80, 80, 160],
};

/** Interpolate between two RGB colors */
export function lerp(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Sine-wave glow (0..1 oscillation) */
export function glow(tick: number, speed = 1): number {
  return (Math.sin(tick * speed) + 1) / 2;
}

/** Dim a color by factor (0..1) */
export function dim(
  rgb: [number, number, number],
  factor: number,
): [number, number, number] {
  return [
    Math.round(rgb[0] * factor),
    Math.round(rgb[1] * factor),
    Math.round(rgb[2] * factor),
  ];
}

/** Convert RGB tuple to CSS color string */
export function rgb(color: [number, number, number]): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

/** Convert RGB tuple to CSS color string with alpha */
export function rgba(color: [number, number, number], alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}
