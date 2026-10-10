/** Formatting + color helpers shared across the Block I/O screens. */

export const WEEKDAYS: { day: string; label: string }[] = [
  { day: 'M', label: 'Mon' },
  { day: 'T', label: 'Tue' },
  { day: 'W', label: 'Wed' },
  { day: 'R', label: 'Thu' },
  { day: 'F', label: 'Fri' },
];

export const HOURS: number[] = Array.from({ length: 15 }, (_, i) => i + 7); // 7..21

export function hourLabel(h: number): string {
  const ampm = h < 12 ? 'a' : 'p';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${ampm}`;
}

/** "7 AM" / "3 PM" long form for sliders + readouts. */
export function hourLabelLong(h: number): string {
  const ampm = h < 12 ? 'AM' : 'PM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ampm}`;
}

export function fmtInt(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '0';
  return Math.round(n).toLocaleString('en-US');
}

export function fmtNum(n: number | undefined | null, digits = 1): string {
  if (n == null || Number.isNaN(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Compact currency, e.g. $204.9K / $1.2M. */
export function fmtMoney(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

/** Low–high range as a string using a formatter. */
export function fmtRange(low: number, high: number, fmt: (n: number) => string): string {
  return `${fmt(low)} – ${fmt(high)}`;
}

/* ----- Data colours -----
 * The UI chrome is strictly grayscale. Only TWO data colours carry meaning,
 * kept in one place so charts, the 3D map, the heatmap and the KPIs all agree:
 *   • ENERGY ON  — Illini orange, ramped #5A2206 → #FF5F05 → #FFB37A (busiest).
 *   • POWERED DOWN / SAVED — ice blue #6EC1FF (also used for positive deltas and
 *     savings figures; headline numbers themselves stay white). */
export const COLOR_RUNNING = '#ff5f05'; // Illini orange — occupied / energy on
export const COLOR_SAVED = '#6ec1ff'; // ice blue — optimized / freed / powered down / savings
/** @deprecated kept as aliases so existing chart code keeps compiling. */
export const COLOR_CURRENT = COLOR_RUNNING;
export const COLOR_OPTIMIZED = COLOR_SAVED;
export const COLOR_FREED = COLOR_SAVED;

/** RGB triples for deck.gl layers (which take [r,g,b] / [r,g,b,a], not hex). */
export const ENERGY_ON_RGB: [number, number, number] = [255, 95, 5];
export const POWERED_DOWN_RGB: [number, number, number] = [110, 193, 255];

/**
 * Sequential Illini-orange ramp for occupancy magnitude: an empty cell recedes
 * to near-black; busier cells climb the orange ramp from a deep ember up to a
 * bright, slightly-washed orange. Perceptually increasing in lightness + warmth.
 */
const SEQ_HEAT = ['#2a1206', '#5a2206', '#8f3608', '#c04a05', '#ff5f05', '#ff8a3d', '#ffb37a'];

/** Empty-window (0 occupancy) tile — a near-black pane that recedes. */
const EMPTY_TILE = '#141416';

/**
 * Heatmap cell background for an occupancy count. 0 → dark "empty" cell;
 * 1..max → steps along the orange heat ramp.
 */
export function occupancyColor(count: number, max: number): string {
  if (count <= 0) return EMPTY_TILE;
  const steps = SEQ_HEAT.length;
  const idx = Math.min(steps - 1, Math.max(0, Math.round((count / Math.max(1, max)) * (steps - 1))));
  return SEQ_HEAT[idx];
}

/** Linear interpolation between two [r,g,b] colours. */
function lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

const RAMP_LOW: [number, number, number] = [90, 34, 6]; // #5A2206 ember
const RAMP_MID: [number, number, number] = [255, 95, 5]; // #FF5F05 Illini orange
const RAMP_HIGH: [number, number, number] = [255, 179, 122]; // #FFB37A busiest

/**
 * Occupancy magnitude as an RGB triple on the orange energy ramp, for deck.gl
 * extrusions and columns. `t` in 0..1 (sections / max). Returns ember → orange →
 * washed-orange; 0 maps to the ramp floor so a lit building is always visibly orange.
 */
export function energyRampRgb(t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t));
  return k < 0.5 ? lerpRgb(RAMP_LOW, RAMP_MID, k / 0.5) : lerpRgb(RAMP_MID, RAMP_HIGH, (k - 0.5) / 0.5);
}

/** Text color that stays readable on a given occupancy cell. */
export function occupancyTextColor(count: number, max: number): string {
  if (count <= 0) return 'var(--mono-ink-faint, #6b6b73)';
  const ratio = count / Math.max(1, max);
  return ratio > 0.6 ? '#0a0a0b' : '#ededed';
}
