// Toasts echo each write's answer, bottom right, above the review bar. They are never the only
// record: the card in the review drawer becomes the receipt and the activity log keeps it. A toast
// waits while a site's sheet is showing, so Mosaic never draws over the site's own prompt.
import { CheckIcon, ProhibitIcon, WarningIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { toast, Toaster } from "sonner";
import { Origin, useHueStyle } from "../primitives";
import { useMosaic, type Receipt } from "../state";
import { resultLinks } from "./status";
import { useReviewUi } from "./ui";

type Echo = Receipt & { links: { key: string; path: string; href: string }[] };

export function Toasts() {
  const { state, model } = useMosaic();
  const seen = useRef(0);
  const queue = useRef<Echo[]>([]);
  // Beside the side panel when it is open (wide screens), never on top of it.
  const { open } = useReviewUi();
  const [wide, setWide] = useState(() => matchMedia("(min-width: 1200px)").matches);
  useEffect(() => {
    const mq = matchMedia("(min-width: 1200px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const right = open && wide ? "calc(var(--review-side) + 16px)" : 16;

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

  // Flush once no site's sheet is up.
  useEffect(() => {
    if (state.confirming) {
      toast.dismiss();
      return;
    }
    for (const echo of queue.current.splice(0)) toast.custom(() => <Echo echo={echo} />, { duration: 5000 });
  });

  return <Toaster position="bottom-right" offset={{ bottom: open && wide ? 16 : 92, right }} mobileOffset={{ bottom: 84, left: 8, right: 8 }} gap={10} toastOptions={{ unstyled: true }} />;
}

function Echo({ echo }: { echo: Echo }) {
  const hue = useHueStyle();
  const name = echo.siteName;
  const ok = echo.outcome === "done";
  return (
    <div className={`rv-toast ${echo.outcome}`} style={hue(echo.origin)}>
      <span className="rv-toast-icon" aria-hidden="true">
        {ok ? <CheckIcon weight="bold" /> : echo.outcome === "denied" ? <ProhibitIcon weight="bold" /> : <WarningIcon weight="bold" />}
      </span>
      <div className="rv-toast-text">
        <b>{ok ? `Published on ${name}` : echo.outcome === "denied" ? `Denied on ${name}` : `Didn't go through on ${name}`}</b>
        <Origin origin={echo.origin} />
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
