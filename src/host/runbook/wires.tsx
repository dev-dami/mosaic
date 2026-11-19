// Data-flow wires: hand-inked strokes in the left gutter, from the output a value comes from to the
// input it fills. Measured from the DOM: an element with data-flow-dst="<capKey>|<field>" is joined
// to the element with the matching data-flow-src, or to its block's data-flow-anchor until that
// output exists (drawn as a dotted pencil line). Below 640px there are no wires: tokens and the
// "feeds" row carry the flow instead.
import * as m from "motion/react-m";
import { getStroke } from "perfect-freehand";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { CapKey } from "../doc";

type Pt = [number, number];
type Wire = { id: string; src: CapKey; hue: number; pending: boolean; ink: string; center: string; head: string; start: Pt };

const MIN_WIDTH = 640;

/** perfect-freehand outline points → a closed SVG path (quadratic midpoints, as its docs suggest). */
function outline(points: number[][]): string {
  if (points.length < 2) return "";
  const avg = (a: number, b: number) => (a + b) / 2;
  let d = `M${points[0]![0]!.toFixed(1)},${points[0]![1]!.toFixed(1)} Q`;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[(i + 1) % points.length]!;
    d += `${x0!.toFixed(1)},${y0!.toFixed(1)} ${avg(x0!, x1!).toFixed(1)},${avg(y0!, y1!).toFixed(1)} `;
  }
  return d + "Z";
}

/** Small deterministic wobble so two wires never look machine-identical. */
function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function cubic(p0: Pt, c0: Pt, c1: Pt, p1: Pt, steps: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * c0[0] + 3 * u * t * t * c1[0] + t * t * t * p1[0], u * u * u * p0[1] + 3 * u * u * t * c0[1] + 3 * u * t * t * c1[1] + t * t * t * p1[1]]);
  }
  return out;
}

function hueOfEl(el: Element): number {
  const holder = el.closest("[style*='--h']") ?? el;
  return Number(getComputedStyle(holder).getPropertyValue("--h")) || 0;
}

export function Wires({ container, pulse, hot }: { container: RefObject<HTMLDivElement | null>; pulse: { cap: CapKey; at: number } | null; hot: CapKey | null }) {
  const [wires, setWires] = useState<Wire[]>([]);
  const last = useRef("");
  const measure = useCallback(() => {
    const box = container.current;
    if (!box || box.clientWidth < MIN_WIDTH) {
      if (last.current !== "[]") setWires([]);
      last.current = "[]";
      return;
    }
    const b = box.getBoundingClientRect();
    const lanes = new Map<string, number>();
    const out: Wire[] = [];
    box.querySelectorAll<HTMLElement>("[data-flow-dst]").forEach((dst) => {
      if (dst.getClientRects().length === 0) return;
      const ref = dst.dataset.flowDst!;
      const [cap] = ref.split("|");
      const src = box.querySelector<HTMLElement>(`[data-flow-src="${CSS.escape(ref)}"]`);
      const anchor = src ?? box.querySelector<HTMLElement>(`[data-flow-anchor="${CSS.escape(cap!)}"]`);
      if (!anchor) return;
      const srcCard = anchor.closest<HTMLElement>(".cap") ?? anchor;
      const dstCard = dst.closest<HTMLElement>(".cap") ?? dst;
      if (srcCard === dstCard) return;
      if (!lanes.has(ref)) lanes.set(ref, lanes.size);
      const lane = lanes.get(ref)!;
      const s = anchor.getBoundingClientRect();
      const sc = srcCard.getBoundingClientRect();
      const t = dst.getBoundingClientRect();
      const tc = dstCard.getBoundingClientRect();
      const p0: Pt = [sc.left - b.left - 3, (src ? s.top + s.height / 2 : s.top + 22) - b.top];
      const p1: Pt = [tc.left - b.left - 5, t.top + Math.min(t.height / 2, 12) - b.top];
      const w = seed(ref + out.length);
      const reach = Math.min(Math.max(p0[0], p1[0]) - 6, 34 + lane * 9 + Math.min(16, Math.abs(p1[1] - p0[1]) / 60));
      const c0: Pt = [p0[0] - reach * (0.9 + w * 0.2), p0[1] + (p1[1] - p0[1]) * (0.08 + w * 0.05)];
      const c1: Pt = [p1[0] - reach * (1.05 - w * 0.15), p1[1] - (p1[1] - p0[1]) * (0.1 + w * 0.04)];
      const steps = Math.max(12, Math.round(Math.abs(p1[1] - p0[1]) / 14));
      const pts = cubic(p0, c0, c1, p1, steps);
      const center = `M${p0[0]},${p0[1]} C${c0[0]},${c0[1]} ${c1[0]},${c1[1]} ${p1[0]},${p1[1]}`;
      const ink = outline(getStroke(pts, { size: 2.6, thinning: 0.55, smoothing: 0.6, streamline: 0.4, simulatePressure: true, start: { taper: 14 }, end: { taper: 0 }, last: true }));
      // Arrowhead: two short pen strokes back from the end, along the end tangent.
      const [ex, ey] = p1;
      const [px, py] = pts[pts.length - 2]!;
      const ang = Math.atan2(ey - py, ex - px);
      const arm = (da: number): Pt[] => [
        [ex - 7 * Math.cos(ang + da), ey - 7 * Math.sin(ang + da)],
        [ex, ey],
      ];
      const head = [arm(0.55), arm(-0.55)].map((a) => outline(getStroke(a, { size: 2.4, thinning: 0.3, simulatePressure: false, last: true }))).join(" ");
      out.push({ id: `${ref}->${dstCard.id || out.length}`, src: cap!, hue: hueOfEl(srcCard), pending: !src, ink, center, head, start: p0 });
    });
    const key = JSON.stringify(out);
    if (key !== last.current) {
      last.current = key;
      setWires(out);
    }
  }, [container]);

  useLayoutEffect(() => {
    measure();
    // Steps may still be moving (layout animation, entrance); measure again once they settle.
    const t1 = setTimeout(measure, 260);
    const t2 = setTimeout(measure, 560);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  });
  useEffect(() => {
    const box = container.current;
    if (!box) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(box);
    box.querySelectorAll(".cap").forEach((el) => ro.observe(el));
    window.addEventListener("resize", measure);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  });

  const now = Date.now();
  return (
    <svg className={`wires ${hot ? "has-hot" : ""}`} aria-hidden="true">
      {wires.map((w) => {
        const live = !!pulse && pulse.cap === w.src && now - pulse.at < 1500;
        const cls = `wire ${w.pending ? "pending" : "inked"} ${hot === w.src ? "hot" : ""}`;
        const style = { "--h": String(w.hue) } as CSSProperties;
        if (w.pending) {
          return (
            <g key={w.id} className={cls} style={style}>
              <path d={w.center} className="pencil" />
              <circle cx={w.start[0]} cy={w.start[1]} r="2" className="wire-dot" />
            </g>
          );
        }
        const maskId = `wm-${seed(w.id).toString(36).slice(2)}-${w.id.length}`;
        return (
          <g key={w.id + (live ? pulse!.at : "")} className={cls} style={style}>
            {live && (
              <mask id={maskId} maskUnits="userSpaceOnUse">
                <m.path d={w.center} fill="none" stroke="#fff" strokeWidth={14} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }} />
              </mask>
            )}
            <g mask={live ? `url(#${maskId})` : undefined}>
              <path d={w.ink} className="ink" />
              <path d={w.head} className="ink head" />
            </g>
            <circle cx={w.start[0]} cy={w.start[1]} r="2.6" className="wire-dot" />
          </g>
        );
      })}
    </svg>
  );
}
