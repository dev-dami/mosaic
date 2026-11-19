// Site hues. The host assigns every connected site a hue from its origin, so a site cannot pick
// another site's colour. Hues stay inside two bands that are clear of the semantic colours
// (red 27, amber 66-92, green 150) and of the accent (268), so a site's mark never reads as
// "error", "warning", "done" or "selected".
// Owner: foundation (shared). Pure, no DOM.
import { hueOf } from "./doc";

/** Inclusive hue bands a site may use, in degrees. */
export const SITE_HUE_BANDS: readonly (readonly [number, number])[] = [
  [182, 250],
  [285, 350],
];

/** Hues reserved for meaning. Documented here so a hue picker can show why a band is closed. */
export const RESERVED_HUES = [
  { name: "danger", from: 0, to: 45 },
  { name: "warning", from: 46, to: 110 },
  { name: "success", from: 111, to: 181 },
  { name: "accent", from: 251, to: 284 },
  { name: "danger", from: 351, to: 360 },
] as const;

const WIDTHS = SITE_HUE_BANDS.map(([a, b]) => b - a);
const SPAN = WIDTHS.reduce((s, w) => s + w, 0);
/** Two connected sites keep at least this many degrees apart when possible: wide enough that three
 * sites read as three colours (violet, magenta, teal), not three shades of one. */
export const MIN_SITE_HUE_GAP = 34;

const norm = (h: number) => ((h % 360) + 360) % 360;

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(norm(a) - norm(b));
  return Math.min(d, 360 - d);
}

export function isSafeHue(h: number): boolean {
  const x = norm(h);
  return SITE_HUE_BANDS.some(([a, b]) => x >= a && x <= b);
}

/** Position along the joined bands (0..SPAN) to a hue. */
function fromPosition(p: number): number {
  let x = ((p % SPAN) + SPAN) % SPAN;
  for (let i = 0; i < SITE_HUE_BANDS.length; i++) {
    const [a] = SITE_HUE_BANDS[i]!;
    const w = WIDTHS[i]!;
    if (x <= w) return a + x;
    x -= w;
  }
  return SITE_HUE_BANDS[0]![0];
}

/** The nearest hue a site may use. A safe hue is returned unchanged (rounded). */
export function snapHue(h: number): number {
  const x = norm(h);
  if (isSafeHue(x)) return Math.round(x);
  let best = SITE_HUE_BANDS[0]![0];
  for (const [a, b] of SITE_HUE_BANDS) {
    for (const edge of [a, b]) if (hueDistance(x, edge) < hueDistance(x, best)) best = edge;
  }
  return best;
}

/**
 * The hue for a site: a hash of its origin placed inside the safe bands. If that is closer than
 * MIN_SITE_HUE_GAP to a hue already `taken`, it moves along the bands to the first position that
 * keeps the gap, or else to the position farthest from every taken hue. Deterministic.
 */
export function siteHue(origin: string, taken: readonly number[] = []): number {
  const base = (hueOf(origin) / 360) * SPAN;
  const steps = 28;
  let best = Math.round(fromPosition(base));
  let bestGap = -1;
  for (let i = 0; i < steps; i++) {
    const h = Math.round(fromPosition(base + (i * SPAN) / steps));
    const gap = taken.length ? Math.min(...taken.map((t) => hueDistance(t, h))) : 360;
    if (gap >= MIN_SITE_HUE_GAP) return h;
    if (gap > bestGap) [best, bestGap] = [h, gap];
  }
  return best;
}
