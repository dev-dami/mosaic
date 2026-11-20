import { describe, expect, test } from "bun:test";
import { hueDistance, hueOfColor, MIN_SITE_HUE_GAP, siteHue } from "../src/host/hue";

const origins = Array.from({ length: 200 }, (_, i) => `https://site-${i}.example`);
const minGap = (t: number[]) => Math.min(...t.flatMap((a, i) => t.slice(i + 1).map((b) => hueDistance(a, b))));

describe("site hues", () => {
  test("reads the hue of a declared colour", () => {
    expect(hueOfColor("#ff0000")).toBeGreaterThan(20);
    expect(hueOfColor("#ff0000")).toBeLessThan(35);
    expect(hueOfColor("#2f6fec")).toBeGreaterThan(250);
    expect(hueOfColor("#2f6fec")).toBeLessThan(270);
    expect(hueOfColor("#808080")).toBeNull();
    expect(hueOfColor("blue")).toBeNull();
    expect(hueOfColor(undefined)).toBeNull();
  });

  test("a site keeps its own colour when no connected site is close", () => {
    expect(siteHue("https://a.example", [], 300)).toBe(300);
    expect(siteHue("https://a.example", [200, 40], 300)).toBe(300);
  });

  test("a site cannot take a colour another connected site already shows", () => {
    // Same declared colour as an earlier site: moved the shortest way out of its reach.
    const h = siteHue("https://copycat.example", [300], 300);
    expect(hueDistance(h, 300)).toBeGreaterThanOrEqual(MIN_SITE_HUE_GAP);
    expect(hueDistance(h, 300)).toBeLessThanOrEqual(MIN_SITE_HUE_GAP + 1);
    expect(hueDistance(siteHue("https://near.example", [300], 310), 300)).toBeGreaterThanOrEqual(MIN_SITE_HUE_GAP);
  });

  test("is stable per origin", () => {
    expect(siteHue("http://localhost:4101")).toBe(siteHue("http://localhost:4101"));
  });

  test("sites without a declared colour keep apart", () => {
    for (let s = 0; s < 40; s++) {
      const taken: number[] = [];
      for (const o of origins.slice(s * 5, s * 5 + 5)) taken.push(siteHue(o, taken));
      expect(minGap(taken)).toBeGreaterThanOrEqual(MIN_SITE_HUE_GAP);
    }
  });

  test("a crowded wheel still gives the most distant hue", () => {
    const taken = Array.from({ length: 12 }, (_, i) => i * 30);
    const h = siteHue("https://late.example", taken, 0);
    expect(Math.min(...taken.map((t) => hueDistance(t, h)))).toBe(15);
  });
});
