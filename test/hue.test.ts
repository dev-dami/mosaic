import { describe, expect, test } from "bun:test";
import { hueDistance, isSafeHue, MIN_SITE_HUE_GAP, siteHue, snapHue } from "../src/host/hue";

const origins = Array.from({ length: 200 }, (_, i) => `https://site-${i}.example`);

describe("site hues", () => {
  test("every assigned hue avoids red, amber, green and the accent", () => {
    for (const o of origins) {
      const h = siteHue(o);
      expect(isSafeHue(h)).toBe(true);
      for (const reserved of [27, 66, 80, 92, 150]) expect(hueDistance(h, reserved)).toBeGreaterThan(12);
      // The accent (primary buttons, focus) keeps a 30 degree moat.
      expect(hueDistance(h, 268)).toBeGreaterThanOrEqual(30);
    }
  });

  test("is stable per origin", () => {
    expect(siteHue("http://localhost:4101")).toBe(siteHue("http://localhost:4101"));
  });

  test("keeps apart from hues already taken", () => {
    const minGap = (t: number[]) => Math.min(...t.flatMap((a, i) => t.slice(i + 1).map((b) => hueDistance(a, b))));
    for (let s = 0; s < 40; s++) {
      const taken: number[] = [];
      for (const o of origins.slice(s * 5, s * 5 + 5)) taken.push(siteHue(o, taken));
      // Three sites always get the full gap; the safe bands are under 100 degrees wide, so five
      // sites share it but stay clearly apart.
      expect(minGap(taken.slice(0, 3))).toBeGreaterThanOrEqual(MIN_SITE_HUE_GAP);
      // Up to four sites take the band edges, 47 degrees or more apart.
      expect(minGap(taken.slice(0, 4))).toBeGreaterThanOrEqual(47);
      expect(minGap(taken)).toBeGreaterThanOrEqual(24);
    }
  });

  test("a picked hue snaps out of a reserved band", () => {
    expect(isSafeHue(snapHue(150))).toBe(true);
    expect(isSafeHue(snapHue(27))).toBe(true);
    expect(isSafeHue(snapHue(268))).toBe(true);
    expect(snapHue(200)).toBe(200);
  });
});
