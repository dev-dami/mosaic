// The review dock: a floating bar at the bottom of the page that counts the writes waiting for
// approval, and opens upward into their cards. On phones it is a drawer you can drag down to close.
// Each card's one button asks its site; the site's own approval sheet is where the person approves.
import NumberFlow from "@number-flow/react";
import { CaretDownIcon, CheckIcon, PaperPlaneTiltIcon, ProhibitIcon } from "@phosphor-icons/react";
import { domMax, LazyMotion, m, MotionConfig, useDragControls, type PanInfo } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { tinykeys } from "tinykeys";
import { capAnchor, hostOf, type CapRef } from "../doc";
import { Button, Kbd, Monogram, Tooltip, useHueStyle } from "../primitives";
import { useMosaic } from "../state";
import { WriteCard } from "./publish";
import { writeStatus, type WriteStatus } from "./status";
import { Toasts } from "./toasts";
import { closeReview, openReview, toggleReview, useReviewUi } from "./ui";

const EASE: [number, number, number, number] = [0, 0.5, 0.5, 1];
const STATE_WORD: Record<WriteStatus, string> = { idle: "not sent yet", running: "sending", waiting: "waiting for your answer", done: "published", denied: "denied", failed: "failed" };

export function ReviewDock() {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">
        <Dock />
        <Toasts />
      </MotionConfig>
    </LazyMotion>
  );
}

function useNarrow() {
  const query = "(max-width: 640px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** Keep the dock centred on the document column (the <main> the runbook renders), whatever the rail's width. */
function useDockFrame(ref: React.RefObject<HTMLDivElement | null>, active: boolean) {
  useLayoutEffect(() => {
    if (!active) return;
    const main = document.querySelector("main");
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const r = main?.getBoundingClientRect();
      const left = r ? r.left : 0;
      const width = r ? r.width : window.innerWidth;
      el.style.setProperty("--dock-cx", `${left + width / 2}px`);
      el.style.setProperty("--dock-room", `${width}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    if (main) ro.observe(main);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [active]);
}

function Dock() {
  const { state, model, actions } = useMosaic();
  const { open, focus, nonce } = useReviewUi();
  const hue = useHueStyle();
  const narrow = useNarrow();
  const dock = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const drag = useDragControls();

  const allWrites = model.refs.filter((r) => r.cap.side_effects === "write");
  const planned = model.writes;
  const plannedKeys = new Set(planned.map((w) => w.key));
  const offPlan = allWrites.filter((w) => !plannedKeys.has(w.key));
  const pending = model.pendingWrites;
  const has = allWrites.length > 0;
  useDockFrame(dock, has);

  // ⌘↵ / Ctrl↵ opens or closes the dock; Esc closes it (unless a site's sheet is up: that is the site's).
  const latest = useRef({ has, open, confirming: state.confirming });
  latest.current = { has, open, confirming: state.confirming };
  useEffect(
    () =>
      tinykeys(window, {
        "$mod+Enter": (e) => {
          if (!latest.current.has) return;
          e.preventDefault();
          toggleReview();
        },
        Escape: () => {
          if (latest.current.open && !latest.current.confirming) closeReview();
        },
      }),
    [],
  );

  // Links to a write elsewhere on the page ("Later: publish release") open the dock at that card.
  const keyById = useRef(new Map<string, CapRef["key"]>());
  keyById.current = new Map(allWrites.map((w) => [capAnchor(w.key), w.key]));
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
      const key = a && keyById.current.get(a.getAttribute("href")!.slice(1));
      if (!key) return;
      e.preventDefault();
      openReview(key);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Bring the asked-for card into view, or move focus into the panel; give focus back on close.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => {
        const card = focus ? document.getElementById(capAnchor(focus)) : null;
        if (card && list.current?.contains(card)) {
          card.scrollIntoView({ block: "nearest", behavior: "smooth" });
          card.classList.remove("flash");
          void card.offsetWidth;
          card.classList.add("flash");
        }
      }, 60);
      wasOpen.current = true;
      return () => clearTimeout(t);
    }
    if (wasOpen.current && dock.current?.contains(document.activeElement)) toggle.current?.focus();
    wasOpen.current = false;
  }, [open, nonce]);

  // Fold back to the bar once a write is published (the tile turns green, the receipt lands in the
  // document), so the dock doesn't sit over the page. "Send all" keeps it open until it finishes.
  // A denied write keeps it open: its card says what happened and offers to ask again.
  const doneCount = allWrites.filter((w) => state.runs[w.key]?.status === "done").length;
  const lastDone = useRef(doneCount);
  useEffect(() => {
    if (state.sending) return;
    if (doneCount > lastDone.current) {
      lastDone.current = doneCount;
      const t = setTimeout(closeReview, 650);
      return () => clearTimeout(t);
    }
    lastDone.current = doneCount;
  }, [doneCount, state.sending]);

  if (!has) return null;

  const waiting = state.confirming ? model.connFor(state.confirming) : undefined;
  const next = pending.find((w) => writeStatus(state, w) !== "done");
  const denied = pending.find((w) => writeStatus(state, w) === "denied");
  const allDone = pending.length === 0 && planned.length > 0;
  const sendReason = state.sending
    ? "Sending now, one site at a time"
    : pending.length === 0
      ? "Everything here is published"
      : state.confirming
        ? `Answer the prompt from ${hostOf(state.confirming)} first`
        : pending.some((w) => !model.readyOf(w.origin))
          ? "A site is still starting its bridge"
          : null;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 80 || info.velocity.y > 500) closeReview();
  };

  return (
    <>
      <m.div className="rv-scrim" initial={false} animate={{ opacity: open && narrow ? 1 : 0 }} style={{ pointerEvents: open && narrow ? "auto" : "none" }} onClick={closeReview} aria-hidden="true" />
      <m.div
        ref={dock}
        className={`rv-dock ${open ? "open" : ""} ${allDone ? "all-done" : ""}`}
        role="region"
        aria-label="Review changes"
        drag={narrow && open ? "y" : false}
        dragListener={false}
        dragControls={drag}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.7 }}
        dragSnapToOrigin
        onDragEnd={onDragEnd}
      >
        <m.div
          id="rv-panel"
          className="rv-panel"
          initial={false}
          animate={open ? "open" : "closed"}
          variants={{
            open: { height: "auto", opacity: 1, visibility: "visible" },
            closed: { height: 0, opacity: 0, transitionEnd: { visibility: "hidden" } },
          }}
          transition={{ duration: 0.2, ease: EASE }}
          inert={!open}
        >
          <div className="rv-handle" onPointerDown={(e) => drag.start(e)} aria-hidden="true">
            <span />
          </div>
          <div className="rv-panel-head">
            <div className="rv-panel-title">
              <h2>Review and publish</h2>
              <p>Each change goes to its own site, and you approve it there. Mosaic can't approve for you.</p>
            </div>
            <Button variant="primary" icon={<PaperPlaneTiltIcon />} onClick={() => void actions.sendAll()} disabledReason={sendReason}>
              {pending.length > 1 ? `Send all ${pending.length}` : "Send for approval"}
            </Button>
          </div>
          <div className="rv-list" ref={list}>
            {planned.map((w, i) => (
              <WriteCard key={w.key} r={w} index={i + 1} />
            ))}
            {offPlan.length > 0 && <OffPlan writes={offPlan} />}
          </div>
        </m.div>

        <div className="rv-bar">
          <div className={`rv-count ${allDone ? "done" : ""}`} aria-live="polite">
            {allDone ? <CheckIcon weight="bold" aria-hidden="true" /> : <NumberFlow value={pending.length} className="rv-num" />}
          </div>
          <div className="rv-words">
            <span className="rv-line">
              {allDone ? (planned.length === 1 ? "Published" : `All ${planned.length} published`) : pending.length === 0 ? "Nothing to publish" : `${pending.length === 1 ? "Change" : "Changes"} ready to publish`}
            </span>
            <span className="rv-sub">
              {waiting
                ? `Waiting for your answer on ${hostOf(waiting.site.site.origin)}`
                : allDone
                  ? "Receipts are in the document."
                  : denied
                    ? `Denied on ${hostOf(denied.origin)}. Nothing changed there.`
                    : pending.length > 0
                      ? "You approve each one on its own site."
                      : "These writes aren't part of this plan."}
            </span>
          </div>
          <ol className="rv-tiles" aria-label="Writes, in step order">
            {planned.map((w) => {
              const s = writeStatus(state, w);
              const isNext = w.key === next?.key;
              const label = `${w.cap.title} on ${hostOf(w.origin)}: ${STATE_WORD[s]}`;
              return (
                <li key={w.key}>
                  <Tooltip content={label}>
                    <button type="button" className={`rv-tile ${s} ${isNext ? "next" : ""}`} style={hue(w.origin)} onClick={() => openReview(w.key)} aria-label={label}>
                      <Monogram name={w.siteName} origin={w.origin} size="sm" />
                      {isNext && <span className="rv-tile-name">{w.cap.title}</span>}
                      <span className="rv-tile-state" aria-hidden="true">
                        {s === "done" ? <CheckIcon weight="bold" /> : s === "denied" || s === "failed" ? <ProhibitIcon weight="bold" /> : null}
                      </span>
                    </button>
                  </Tooltip>
                </li>
              );
            })}
          </ol>
          <div className="rv-act">
            <Button
              ref={toggle}
              data-review-toggle=""
              aria-expanded={open}
              aria-controls="rv-panel"
              variant={open ? "tertiary" : pending.length > 0 ? "primary" : "secondary"}
              icon={open ? <CaretDownIcon /> : undefined}
              side={!open && !narrow ? <Kbd keys={["mod", "enter"]} /> : undefined}
              onClick={toggleReview}
            >
              {open ? "Hide" : pending.length > 0 ? `Review ${pending.length}` : "Show"}
            </Button>
          </div>
        </div>
      </m.div>
    </>
  );
}

/** Writes the outcome plan leaves out. Still rendered (every capability has one card), folded away. */
function OffPlan({ writes }: { writes: CapRef[] }) {
  const [show, setShow] = useState(false);
  return (
    <div className="rv-offplan">
      <button type="button" className="link-btn" aria-expanded={show} onClick={() => setShow((v) => !v)}>
        {show ? "Hide" : "Show"} {writes.length} not needed for this outcome
      </button>
      <div hidden={!show} className="rv-offplan-list">
        {writes.map((w) => (
          <WriteCard key={w.key} r={w} offPlan />
        ))}
      </div>
    </div>
  );
}
