import { describe, expect, test } from "bun:test";
import { hueDistance, isSafeHue, MIN_SITE_HUE_GAP, siteHue, snapHue } from "../src/host/hue";

const origins = Array.from({ length: 200 }, (_, i) => `https://site-${i}.example`);

describe("site hues", () => {
  test("every assigned hue avoids red, amber, green and the accent", () => {
    for (const o of origins) {
      const h = siteHue(o);
      expect(isSafeHue(h)).toBe(true);
      for (const reserved of [27, 66, 80, 92, 150, 268]) expect(hueDistance(h, reserved)).toBeGreaterThan(12);
    }
  });

  test("is stable per origin", () => {
    expect(siteHue("http://localhost:4101")).toBe(siteHue("http://localhost:4101"));
  });

  test("keeps apart from hues already taken", () => {
    const taken: number[] = [];
    for (const o of origins.slice(0, 5)) taken.push(siteHue(o, taken));
    for (let i = 0; i < taken.length; i++) for (let j = i + 1; j < taken.length; j++) expect(hueDistance(taken[i]!, taken[j]!)).toBeGreaterThanOrEqual(MIN_SITE_HUE_GAP);
  });

  test("a picked hue snaps out of a reserved band", () => {
    expect(isSafeHue(snapHue(150))).toBe(true);
    expect(isSafeHue(snapHue(27))).toBe(true);
    expect(isSafeHue(snapHue(268))).toBe(true);
    expect(snapHue(200)).toBe(200);
  });
});
