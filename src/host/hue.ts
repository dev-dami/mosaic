// Site identity colours. A site declares a theme_color in its manifest (the same idea as the Web
// App Manifest's theme_color). Mosaic takes that colour's hue, so the site looks like itself in
// Mosaic and on its own approval sheet. Mosaic still decides: when the hue is too close to one that
// an earlier connected site holds, it is moved away, so a site cannot dress up as another one.
// Lightness and chroma come from Mosaic (theme.css), so any hue meets contrast. Status colours are
// told apart by form (an icon and a word on a fill), not by keeping site hues out of their range.
// Owner: foundation (shared). Pure, no DOM.
import { hueOf } from "./doc";

/** Two connected sites keep at least this many degrees apart: wide enough to read as two colours. */
export const MIN_SITE_HUE_GAP = 34;

/** Eight hues about 45 degrees apart, for a site that declares no colour. */
const SLOTS = [350, 35, 80, 125, 165, 215, 260, 300];

const norm = (h: number) => ((h % 360) + 360) % 360;

export function hueDistance(a: number, b: number): number {
  const d = Math.abs(norm(a) - norm(b));
  return Math.min(d, 360 - d);
}

/** The OKLCH hue of a "#rrggbb" colour, or null for anything else or a grey. */
export function hueOfColor(color: string | undefined): number | null {
  const m = color?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  const lin = (x: string) => {
    const c = parseInt(x, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [lin(m[1]!), lin(m[2]!), lin(m[3]!)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s;
  if (Math.hypot(A, B) < 0.02) return null;
  return Math.round(norm((Math.atan2(B, A) * 180) / Math.PI));
}

/**
 * The hue for a site: its declared hue when it has one, else a slot picked by a hash of its origin.
 * If that hue sits within MIN_SITE_HUE_GAP of a hue already `taken`, it moves the shortest way out.
 * When the wheel is too crowded for that, it takes the hue farthest from every taken one.
 * Deterministic.
 */
export function siteHue(origin: string, taken: readonly number[] = [], declared: number | null = null): number {
  const gapOf = (h: number) => (taken.length ? Math.min(...taken.map((t) => hueDistance(t, h))) : 360);
  let want = declared;
  if (want === null) {
    const start = hueOf(origin) % SLOTS.length;
    want = SLOTS[start]!;
    for (let i = 0; i < SLOTS.length; i++) {
      const h = SLOTS[(start + i) % SLOTS.length]!;
      if (gapOf(h) >= MIN_SITE_HUE_GAP) return h;
    }
  }
  if (gapOf(want) >= MIN_SITE_HUE_GAP) return Math.round(norm(want));
  for (let d = 1; d <= 180; d++) {
    for (const h of [want + d, want - d]) if (gapOf(h) >= MIN_SITE_HUE_GAP) return Math.round(norm(h));
  }
  let best = want;
  for (let h = 0; h < 360; h++) if (gapOf(h) > gapOf(best)) best = h;
  return Math.round(norm(best));
}
