// The review dock: the one home of pending writes. A bar on the document column (same left edge,
// same width) says how many changes wait for approval; it opens into their cards. On wide screens
// the cards open as a side panel that pushes the document aside instead of covering it; on phones
// they open as a bottom sheet you can drag down to close. Each card's one button asks its site, and
// the site's own approval sheet is where the person approves.
import NumberFlow from "@number-flow/react";
import { CaretDownIcon, CheckIcon, PaperPlaneTiltIcon, ProhibitIcon } from "@phosphor-icons/react";
import { domMax, LazyMotion, m, MotionConfig, useDragControls, type PanInfo } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { tinykeys } from "tinykeys";
import { capAnchor, type CapRef } from "../doc";
import { Button, Kbd, Monogram, Tooltip, useHueStyle } from "../primitives";
import { useMosaic } from "../state";
import { WriteCard } from "./publish";
import { writeStatus, type WriteStatus } from "./status";
import { Toasts } from "./toasts";
import { closeReview, openReview, toggleReview, useReviewUi } from "./ui";

const EASE: [number, number, number, number] = [0, 0.5, 0.5, 1];
const STATE_WORD: Record<WriteStatus, string> = {
  idle: "not sent yet",
  running: "sending",
  waiting: "waiting for your answer",
  done: "published",
  denied: "denied",
  failed: "failed",
  unknown: "outcome unknown",
  not_started: "not started",
};

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

function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Is focus in something the person types into? Then ⌘↵ belongs to it, not to the dock. */
function typing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName === "INPUT") return !["checkbox", "radio", "button", "submit", "range"].includes((el as HTMLInputElement).type);
  return false;
}

/** Keep the bar on the document column: the same left edge and width as the steps (the .doc content box). */
function useDockFrame(ref: React.RefObject<HTMLDivElement | null>, active: boolean) {
  useLayoutEffect(() => {
    if (!active) return;
    const doc = document.querySelector<HTMLElement>(".doc");
    const update = () => {
      const el = ref.current;
      if (!el) return;
      if (!doc) {
        el.style.setProperty("--dock-left", "24px");
        el.style.setProperty("--dock-width", `${window.innerWidth - 48}px`);
        return;
      }
      const r = doc.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(doc).paddingLeft) || 0;
      el.style.setProperty("--dock-left", `${r.left + pad}px`);
      el.style.setProperty("--dock-width", `${r.width - pad}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    if (doc) ro.observe(doc);
    window.addEventListener("resize", update);
    // The layout eases aside when the side panel opens; follow it to the end.
    const layout = document.querySelector(".layout");
    layout?.addEventListener("transitionend", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      layout?.removeEventListener("transitionend", update);
    };
  }, [active]);
}

function Dock() {
  const { state, model, actions } = useMosaic();
  const { open, focus, nonce } = useReviewUi();
  const hue = useHueStyle();
  const narrow = useMedia("(max-width: 640px)");
  const wide = useMedia("(min-width: 1200px)");
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
  const side = has && open && wide;
  useDockFrame(dock, has);

  // Wide screens: the open drawer is a side panel, and the layout makes room for it.
  useEffect(() => {
    const root = document.documentElement;
    if (side) root.dataset.review = "side";
    else delete root.dataset.review;
    return () => {
      delete root.dataset.review;
    };
  }, [side]);

  // ⌘↵ / Ctrl↵ opens or closes the dock, unless focus is in a field; Esc closes it (unless a site's sheet is up: that is the site's).
  const latest = useRef({ has, open, confirming: state.confirming ?? state.asking });
  latest.current = { has, open, confirming: state.confirming ?? state.asking };
  useEffect(
    () =>
      tinykeys(window, {
        "$mod+Enter": (e) => {
          if (!latest.current.has || typing()) return;
          e.preventDefault();
          toggleReview();
        },
        Escape: (e) => {
          // A Radix layer on top (the ⌘K palette, a popover) handles Esc first and marks the event
          // handled; that Esc closes only the layer, not the dock under it.
          if (e.defaultPrevented) return;
          if (latest.current.open && !latest.current.confirming) closeReview();
        },
      }),
    [],
  );

  // Links to a write elsewhere on the page (a step's "1 change to publish") open the dock at that card.
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

  // Bring the asked-for card into view; give focus back to the toggle on close.
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

  // Over the page (phones, narrow desktops) the drawer folds back to the bar once a write is
  // published, so it doesn't sit on the document. The side panel covers nothing, so it stays.
  // "Send all" keeps it open until it finishes; a denied write keeps it open to offer asking again.
  const doneCount = allWrites.filter((w) => state.runs[w.key]?.status === "done").length;
  const lastDone = useRef(doneCount);
  useEffect(() => {
    if (state.sending) return;
    if (doneCount > lastDone.current) {
      lastDone.current = doneCount;
      if (wide) return;
      const t = setTimeout(closeReview, 900);
      return () => clearTimeout(t);
    }
    lastDone.current = doneCount;
  }, [doneCount, state.sending, wide]);

  if (!has) return null;

  const nameOf = (origin: string) => model.connFor(origin)?.site.site.name ?? origin;
  const busyOrigin = state.confirming ?? state.asking;
  const waiting = busyOrigin ? model.connFor(busyOrigin) : undefined;
  const denied = pending.find((w) => writeStatus(state, w) === "denied");
  const unknown = pending.find((w) => writeStatus(state, w) === "unknown");
  const allDone = pending.length === 0 && planned.length > 0;
  const sendReason = state.sending
    ? "Sending now, one site at a time"
    : pending.length === 0
      ? "Everything here is published"
      : busyOrigin
        ? `Answer ${nameOf(busyOrigin)}'s prompt first`
        : state.writing
          ? "A change is still being sent"
        : pending.every((w) => writeStatus(state, w) === "unknown")
          ? `Nothing left to send. Check ${unknown?.siteName ?? "the site"} for the change with an unknown outcome`
          : pending.some((w) => !model.readyOf(w.origin))
            ? "A site is still starting its bridge"
            : null;
  // One line says how many; a second appears only when it has news.
  const news = waiting
    ? `Waiting for your answer on ${waiting.site.site.name}`
    : unknown
      ? `Outcome unknown on ${unknown.siteName}. Check it there; Mosaic won't send it again.`
      : denied
      ? `Denied on ${denied.siteName}. Nothing changed there.`
      : allDone
        ? "Each one is in Activity, below the steps."
        : pending.length === 0
          ? "These changes aren't part of this plan."
          : null;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 80 || info.velocity.y > 500) closeReview();
  };

  return (
    <>
      <m.div className="rv-scrim" initial={false} animate={{ opacity: open && narrow ? 1 : 0 }} style={{ pointerEvents: open && narrow ? "auto" : "none" }} onClick={closeReview} aria-hidden="true" />
      <m.div
        ref={dock}
        className={`rv-dock ${open ? "open" : ""} ${side ? "side" : ""} ${allDone ? "all-done" : ""}`}
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
          transition={{ duration: side ? 0 : 0.2, ease: EASE }}
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
          </div>
          <div className="rv-send">
            <Button variant="primary" icon={<PaperPlaneTiltIcon />} onClick={() => void actions.sendAll()} disabledReason={sendReason}>
              {pending.length > 1 ? `Send all ${pending.length} for approval` : "Send for approval"}
            </Button>
            <span className="hint">Opens each site's prompt in turn.</span>
          </div>
          <div className="rv-list" ref={list}>
            {planned.map((w, i) => (
              <WriteCard key={w.key} r={w} index={i + 1} />
            ))}
            {offPlan.length > 0 && <OffPlan writes={offPlan} />}
          </div>
        </m.div>

        <div className="rv-bar">
          <div className="rv-words" aria-live="polite">
            <span className="rv-line">
              {allDone ? (
                <>
                  <CheckIcon weight="bold" className="rv-done-mark" aria-hidden="true" />
                  {planned.length === 1 ? "Published" : `All ${planned.length} published`}
                </>
              ) : pending.length === 0 ? (
                "Nothing to approve"
              ) : (
                <>
                  <NumberFlow value={pending.length} className="rv-num" /> {pending.length === 1 ? "change" : "changes"} to approve
                </>
              )}
            </span>
            {news && <span className="rv-sub">{news}</span>}
          </div>
          <ol className="rv-tiles" aria-label="Changes, in step order">
            {planned.map((w) => {
              const s = writeStatus(state, w);
              const label = `${w.cap.title} on ${w.siteName}: ${STATE_WORD[s]}`;
              return (
                <li key={w.key}>
                  <Tooltip content={label}>
                    <button type="button" className={`rv-tile ${s}`} style={hue(w.origin)} onClick={() => openReview(w.key)} aria-label={label}>
                      <Monogram name={w.siteName} origin={w.origin} size="sm" />
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
              {open ? "Hide" : pending.length > 0 ? "Review" : "Show"}
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
