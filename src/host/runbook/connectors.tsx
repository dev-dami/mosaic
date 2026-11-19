// Data-flow wires: lines in the gutter from an output to the inputs it fills.
// Measured from the DOM: any element with data-flow-dst="<capKey>|<field>" is joined to the element
// with the matching data-flow-src, or to its block's data-flow-anchor until that output exists.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { CapKey } from "../doc";

type Path = { d: string; hue: number; live: boolean; pending: boolean; end: [number, number]; id: string };

export function Connectors({ container, pulse }: { container: RefObject<HTMLDivElement | null>; pulse: { cap: CapKey; at: number } | null }) {
  const [paths, setPaths] = useState<Path[]>([]);
  const last = useRef("");
  const measure = useCallback(() => {
    const box = container.current;
    if (!box || box.clientWidth < 640) {
      if (last.current !== "[]") setPaths([]);
      last.current = "[]";
      return;
    }
    const b = box.getBoundingClientRect();
    const lanes = new Map<string, number>();
    const out: Path[] = [];
    box.querySelectorAll<HTMLElement>("[data-flow-dst]").forEach((dst) => {
      const ref = dst.dataset.flowDst!;
      const [cap] = ref.split("|");
      const src = box.querySelector<HTMLElement>(`[data-flow-src="${CSS.escape(ref)}"]`);
      const anchor = src ?? box.querySelector<HTMLElement>(`[data-flow-anchor="${CSS.escape(cap!)}"]`);
      if (!anchor) return;
      if (!lanes.has(ref)) lanes.set(ref, lanes.size);
      const lane = lanes.get(ref)!;
      const s = anchor.getBoundingClientRect();
      const t = dst.getBoundingClientRect();
      const sx = (src ? s.left : s.left + 4) - b.left;
      const sy = (src ? s.top + s.height / 2 : s.top + 14) - b.top;
      const tx = t.left - b.left - 4;
      const ty = t.top + 13 - b.top;
      const x = 14 + lane * 8;
      const r = Math.min(10, Math.abs(ty - sy) / 2);
      const dir = ty >= sy ? 1 : -1;
      const d = `M ${sx} ${sy} H ${x + r} Q ${x} ${sy} ${x} ${sy + r * dir} V ${ty - r * dir} Q ${x} ${ty} ${x + r} ${ty} H ${tx}`;
      const hue = Number(getComputedStyle(dst.closest("[style*='--h']") ?? anchor).getPropertyValue("--h")) || 0;
      const srcHue = Number(getComputedStyle(anchor.closest("[style*='--h']") ?? anchor).getPropertyValue("--h")) || hue;
      out.push({ d, hue: srcHue, live: false, pending: !src, end: [tx, ty], id: `${ref}->${out.length}` });
    });
    const key = JSON.stringify(out);
    if (key !== last.current) {
      last.current = key;
      setPaths(out);
    }
  }, [container]);

  useLayoutEffect(measure);
  useEffect(() => {
    const box = container.current;
    if (!box) return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, container]);

  return (
    <svg className="connectors" aria-hidden="true">
      {paths.map((p) => {
        const live = pulse && p.id.startsWith(pulse.cap + "|") && Date.now() - pulse.at < 1200;
        return (
          <g key={p.id + (live ? pulse!.at : "")} style={{ "--h": String(p.hue) } as CSSProperties} className={`${p.pending ? "pending" : ""} ${live ? "live" : ""}`}>
            <path d={p.d} className="wire" />
            <circle cx={p.end[0]} cy={p.end[1]} r="2.5" className="wire-end" />
          </g>
        );
      })}
    </svg>
  );
}
