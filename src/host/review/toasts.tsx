// Toasts echo each write's answer. They are never the only record: the receipt stays in the
// document and in the activity log. A toast waits while a site's sheet is showing, so Mosaic never
// draws over the site's own prompt; so does the one short burst when everything is published.
import { CheckIcon, ProhibitIcon, WarningIcon } from "@phosphor-icons/react";
import confetti from "canvas-confetti";
import { formatHex, modeOklch, modeRgb, useMode as registerMode } from "culori/fn";
import { useEffect, useRef } from "react";
import { toast, Toaster } from "sonner";
import { hostOf } from "../doc";
import { siteHue } from "../hue";
import { useHueStyle } from "../primitives";
import { useMosaic, type Receipt } from "../state";
import { resultLinks } from "./status";

registerMode(modeRgb);
registerMode(modeOklch);

type Echo = Receipt & { links: { key: string; path: string; href: string }[] };

export function Toasts() {
  const { state, model } = useMosaic();
  const seen = useRef(0);
  const queue = useRef<Echo[]>([]);
  const hadPending = useRef(false);
  const burstDue = useRef(false);

  // Queue every new write receipt.
  useEffect(() => {
    const fresh = state.receipts.filter((r) => r.id > seen.current);
    if (fresh.length === 0) return;
    seen.current = Math.max(seen.current, ...fresh.map((r) => r.id));
    for (const rc of fresh.reverse()) {
      if (!rc.write) continue;
      const ref = model.refs.find((r) => r.origin === rc.origin && r.cap.title === rc.title);
      const run = ref ? state.runs[ref.key] : undefined;
      queue.current.push({ ...rc, links: rc.outcome === "done" && run?.status === "done" ? resultLinks(run.output, rc.origin) : [] });
    }
  }, [state.receipts]);

  // Every planned write published: one short burst, in the sites' own hues.
  const pending = model.pendingWrites.length;
  useEffect(() => {
    if (pending > 0) hadPending.current = true;
    else if (hadPending.current && model.writes.length > 0) {
      hadPending.current = false;
      burstDue.current = true;
    }
  }, [pending, model.writes.length]);

  // Flush once no site's sheet is up.
  useEffect(() => {
    if (state.confirming) {
      toast.dismiss();
      return;
    }
    for (const echo of queue.current.splice(0)) toast.custom(() => <Echo echo={echo} />, { duration: 5000 });
    if (burstDue.current) {
      burstDue.current = false;
      const origin = document.querySelector(".rv-count")?.getBoundingClientRect();
      const colors = [...new Set(model.writes.map((w) => state.hues[w.origin] ?? siteHue(w.origin)))].map((h) => formatHex({ mode: "oklch", l: 0.7, c: 0.14, h }) ?? "#888");
      void confetti({
        particleCount: 46,
        spread: 62,
        startVelocity: 32,
        gravity: 1.1,
        ticks: 140,
        scalar: 0.85,
        colors,
        disableForReducedMotion: true,
        origin: origin ? { x: (origin.left + origin.width / 2) / window.innerWidth, y: origin.top / window.innerHeight } : { x: 0.5, y: 0.9 },
      });
    }
  });

  return <Toaster position="top-right" offset={{ top: 60, right: 16 }} mobileOffset={{ top: 56, left: 8, right: 8 }} gap={10} toastOptions={{ unstyled: true }} />;
}

function Echo({ echo }: { echo: Echo }) {
  const hue = useHueStyle();
  const host = hostOf(echo.origin);
  const ok = echo.outcome === "done";
  return (
    <div className={`rv-toast ${echo.outcome}`} style={hue(echo.origin)}>
      <span className="rv-toast-icon" aria-hidden="true">
        {ok ? <CheckIcon weight="bold" /> : echo.outcome === "denied" ? <ProhibitIcon weight="bold" /> : <WarningIcon weight="bold" />}
      </span>
      <div className="rv-toast-text">
        <b>{ok ? `Published on ${host}` : echo.outcome === "denied" ? `Denied on ${host}` : `Didn't go through on ${host}`}</b>
        <span>
          {echo.title}
          {ok ? "" : echo.outcome === "denied" ? ". Nothing changed." : `. ${echo.detail}`}
          {echo.links.map((l) => (
            <a key={l.key} href={l.href} target="_blank" rel="noreferrer">
              {l.path}
            </a>
          ))}
        </span>
      </div>
    </div>
  );
}
