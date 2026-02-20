// Neon Neural color palette — ANSI 24-bit truecolor
// All colors use \x1b[38;2;R;G;Bm (foreground) and \x1b[48;2;R;G;Bm (background)

const PALETTE = {
  // Primary glow colors
  cyan:     [0, 255, 255],
  magenta:  [255, 0, 200],
  gold:     [255, 200, 0],
  white:    [220, 220, 255],
  dimWhite: [100, 100, 130],

  // Node-specific colors
  kern:        [255, 60, 60],     // Red — immutable core
  bewusstsein: [0, 255, 200],     // Cyan-green — consciousness
  schatten:    [160, 0, 255],     // Purple — shadow
  traeume:     [100, 100, 255],   // Blue — dreams
  wachstum:    [0, 255, 100],     // Green — growth
  garten:      [180, 255, 0],     // Lime — garden
  mem:         [255, 200, 0],     // Gold — memories
  bonds:       [255, 100, 150],   // Pink — relationships
  interessen:  [0, 200, 255],     // Sky blue — interests
  heartbeat:   [255, 50, 50],     // Red pulse — heartbeat
  seed:        [255, 255, 255],   // White — seed (identity)
  manifest:    [255, 150, 0],     // Orange — manifest
  evolution:   [200, 100, 255],   // Violet — evolution
  statelog:    [80, 200, 180],    // Teal — state log

  // Background
  bg:       [8, 8, 20],
  bgLight:  [15, 15, 35],

  // Connection line
  line:     [40, 40, 80],
  lineGlow: [80, 80, 160],
};

function fg(rgb) {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function bg(rgb) {
  return `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

// Interpolate between two colors
function lerp(colorA, colorB, t) {
  return [
    Math.round(colorA[0] + (colorB[0] - colorA[0]) * t),
    Math.round(colorA[1] + (colorB[1] - colorA[1]) * t),
    Math.round(colorA[2] + (colorB[2] - colorA[2]) * t),
  ];
}

// Sine-wave glow (0..1 oscillation)
function glow(tick, speed = 1) {
  return (Math.sin(tick * speed) + 1) / 2;
}

// Dim a color by factor (0..1)
function dim(rgb, factor) {
  return [
    Math.round(rgb[0] * factor),
    Math.round(rgb[1] * factor),
    Math.round(rgb[2] * factor),
  ];
}

module.exports = { PALETTE, fg, bg, RESET, BOLD, DIM, lerp, glow, dim };
