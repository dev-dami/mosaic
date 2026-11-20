// The sources dock: one monogram per connected site, quiet until you need it. Each opens a
// popover with the site's capabilities, its connection checks, its colour and Disconnect. The
// dashed socket at the end opens the palette to connect another site. On phones the dock is a
// strip under the top bar.
import { PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import * as Popover from "@radix-ui/react-popover";
import * as Slider from "@radix-ui/react-slider";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useState } from "react";
import { capKey, hostOf } from "../doc";
import { siteHue } from "../hue";
import { Button, Disclosure, Kbd, Monogram, Origin, Tag, Tooltip, useHueStyle } from "../primitives";
import { useMosaic, type Conn } from "../state";
import { AgentTag } from "../agent";
import { jumpTo } from "./palette";
import { Checklist } from "./trace";
import { entryUi, rememberName, rememberTrace, traceOf } from "./ui";

function useNarrow() {
  const q = "(max-width: 860px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return narrow;
}

export function SourcesRail() {
  const { state, model } = useMosaic();
  const narrow = useNarrow();
  // Keep each origin's last checks so its popover can show them once the palette is closed.
  useEffect(() => {
    if (state.trace) rememberTrace(state.trace);
  }, [state.trace]);
  const conns = model.siteOrder.map((o) => model.connFor(o)!).filter(Boolean);
  useEffect(() => {
    for (const c of state.conns) if (c.status === "ready") rememberName(c.site.site.origin, c.site.site.name);
  }, [state.conns]);
  return (
    <MotionConfig reducedMotion="user">
    <aside className="dock" aria-label="Sites">
      <span className="dock-label" aria-hidden="true">
        Sites
      </span>
      <ul className="dock-list">
        <AnimatePresence initial={false}>
          {conns.map((c) => (
            <SourceItem key={c.key} conn={c} side={narrow ? "bottom" : "right"} fresh={state.fresh.includes(c.site.site.origin)} />
          ))}
        </AnimatePresence>
        <li className="dock-add-item">
          <Tooltip
            side={narrow ? "bottom" : "right"}
            content={
              <>
                Connect a site <Kbd keys={["mod", "K"]} />
              </>
            }
          >
            <button type="button" className={`dock-add ${conns.length === 0 ? "first" : ""}`} onClick={() => entryUi.openPalette()} aria-label="Connect a site">
              <PlusIcon weight="bold" />
            </button>
          </Tooltip>
        </li>
      </ul>
    </aside>
    </MotionConfig>
  );
}

function SourceItem({ conn, side, fresh }: { conn: Conn; side: "right" | "bottom"; fresh: boolean }) {
  const hue = useHueStyle();
  const o = conn.site.site.origin;
  const name = conn.site.site.name;
  const statusWord = conn.status === "ready" ? "ready" : "connecting";
  return (
    <motion.li
      layout
      className={`source ${conn.status} ${fresh ? "fresh" : ""}`}
      data-origin={o}
      style={hue(o)}
      initial={{ scale: 0.3, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.3, opacity: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 26 }}
    >
      <Popover.Root>
        <Tooltip
          side={side}
          content={
            <>
              <b>{name}</b> · {hostOf(o)} · {statusWord}
            </>
          }
        >
          <Popover.Trigger className="source-btn" aria-label={`${name}, ${statusWord}`}>
            <Monogram name={name} origin={o} size="lg" ring={conn.status === "connecting" ? "running" : undefined} />
            <span className={`source-dot ${conn.status}`} aria-hidden="true" />
          </Popover.Trigger>
        </Tooltip>
        <Popover.Portal>
          <Popover.Content className="source-pop" side={side} align="start" sideOffset={10} collisionPadding={12} style={hue(o)}>
            <SourceDetail conn={conn} />
            <Popover.Arrow className="source-pop-arrow" width={12} height={6} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </motion.li>
  );
}

function SourceDetail({ conn }: { conn: Conn }) {
  const { model, actions } = useMosaic();
  const o = conn.site.site.origin;
  const trace = traceOf(o);
  return (
    <div className="sd">
      <header className="sd-head">
        <Monogram name={conn.site.site.name} origin={o} size="lg" />
        <div className="sd-id">
          <span className="sd-name">{conn.site.site.name}</span>
          <Origin origin={o} />
        </div>
        <Tag tone={conn.status === "ready" ? "success" : "neutral"} size="sm">
          {conn.status === "ready" ? "Ready" : "Connecting"}
        </Tag>
      </header>
      <AgentTag site={conn.site} />
      {conn.site.site.description && <p className="sd-desc">{conn.site.site.description}</p>}
      <div className="label">What it can do</div>
      <ul className="sd-caps">
        {conn.site.capabilities.map((cap) => {
          const key = capKey(o, cap.id);
          const hidden = model.hidden.has(key);
          return (
            <li key={cap.id}>
              <Popover.Close asChild>
                <button type="button" className={`sd-cap ${hidden ? "is-hidden" : ""}`} onClick={() => jumpTo(key, actions.setHot)}>
                  <span className="sd-cap-title">{cap.title}</span>
                  {hidden && <span className="sd-cap-note">not in plan</span>}
                  {cap.side_effects === "write" && (
                    <Tag tone="warning" size="sm">
                      <PencilSimpleIcon /> Changes site
                    </Tag>
                  )}
                </button>
              </Popover.Close>
            </li>
          );
        })}
      </ul>
      <div className="label">Colour</div>
      <HuePicker origin={o} name={conn.site.site.name} />
      <div className="sd-foot">
        {trace ? (
          <Disclosure label="Show connection checks" openLabel="Hide connection checks" className="sd-checks">
            <Checklist trace={trace} compact />
          </Disclosure>
        ) : (
          <span />
        )}
        <Button variant="danger" size="xs" icon={<TrashIcon />} onClick={() => actions.disconnect(o)}>
          Disconnect
        </Button>
      </div>
    </div>
  );
}

/** Hue slider over a strip of every hue. It starts at the site's own colour; a change holds in this browser. */
function HuePicker({ origin, name }: { origin: string; name: string }) {
  const { state, actions } = useMosaic();
  const h = state.hues[origin] ?? siteHue(origin);
  return (
    <div className="hue">
      <Slider.Root className="hue-slider" min={0} max={359} step={1} value={[h]} onValueChange={([v]) => v !== undefined && actions.setHue(origin, v)} aria-label={`Colour for ${name}`}>
        <Slider.Track className="hue-track" />
        <Slider.Thumb className="hue-thumb" />
      </Slider.Root>
      <p className="hue-note">Starts from the colour the site declares. Mosaic moves it if another connected site is too close.</p>
    </div>
  );
}
