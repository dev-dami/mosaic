// The outcome: the first thing on the page. The person types what they want done; Project and
// Version are read from it (and can be typed over); the plan line under it shows which steps the
// outcome picked, in order, and why. Picking is deterministic keyword matching (plan.ts).
import NumberFlow from "@number-flow/react";
import { PencilSimpleIcon, PlugIcon } from "@phosphor-icons/react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useMemo, useRef } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { parseOutcome } from "../doc";
import { Kbd, Monogram, Tooltip, useHueStyle } from "../primitives";
import { useMosaic } from "../state";
import { jumpTo } from "./palette";
import { analyzeOutcome } from "./plan";
import { entryUi, useEntryUi } from "./ui";

/** Examples before any site is connected: generic, and each one plans differently. Once a site is
 * connected they go away: the plan line under the outcome is the feedback from then on. */
const STARTERS = ["Launch Lumen v1.0", "Update the docs for v2.1", "Announce Atlas v3.0"];

export function OutcomeHeader() {
  const { state, model, actions } = useMosaic();
  const { focusOutcome } = useEntryUi();
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focusOutcome) return;
    box.current?.focus();
    box.current?.select();
  }, [focusOutcome]);

  return (
    <header className={`outcome ${state.conns.length ? "has-sites" : ""}`}>
      <label htmlFor="outcome" className="outcome-label">
        What do you want to get done?
      </label>
      <div className="outcome-field">
        <TextareaAutosize
          id="outcome"
          ref={box}
          className="outcome-input"
          value={state.title}
          minRows={1}
          maxRows={4}
          placeholder="What do you want done?"
          spellCheck={false}
          onChange={(e) => actions.setTitle(e.target.value.replace(/\n/g, " "))}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (state.conns.length === 0) entryUi.openPalette();
            else e.currentTarget.blur();
          }}
        />
        <span className="outcome-pencil" aria-hidden="true">
          <PencilSimpleIcon />
        </span>
      </div>
      <div className="outcome-meta">
        <PropChip k="project" label="Project" />
        <PropChip k="version" label="Version" />
        {state.conns.length === 0 && (
        <span className="examples" aria-label="Examples">
          {STARTERS
            .filter((x) => x !== state.title)
            .map((x) => (
              <button key={x} type="button" className="example" onMouseDown={(e) => e.preventDefault()} onClick={() => actions.setTitle(x)}>
                {x}
              </button>
            ))}
        </span>
        )}
      </div>
      {state.conns.length > 0 && <PlanLine />}
    </header>
  );
}

function PropChip({ k, label }: { k: "project" | "version"; label: string }) {
  const { state, model, actions } = useMosaic();
  const typed = state.overrides[k] !== undefined;
  const fromOutcome = !typed && !!parseOutcome(state.title)[k];
  const value = model.docProps[k] ?? "";
  return (
    <span className={`prop-chip ${fromOutcome ? "from-outcome" : ""}`}>
      <label htmlFor={`prop-${k}`} className="prop-chip-key">
        {label}
      </label>
      <input
        id={`prop-${k}`}
        className="prop-chip-input"
        value={value}
        placeholder="none"
        size={Math.max(4, value.length + 1)}
        title={fromOutcome ? "Read from the outcome. Type to change it." : undefined}
        onChange={(e) => actions.setProp(k, e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
    </span>
  );
}

/** One line: the picked steps in order, the words that picked them, what was left out. */
function PlanLine() {
  const { state, model, actions } = useMosaic();
  const hue = useHueStyle();
  const analysis = useMemo(() => analyzeOutcome(state.title, model.refs), [state.title, model.refs]);
  const visible = model.refs.filter((r) => !model.hidden.has(r.key));
  const left = model.refs.filter((r) => model.hidden.has(r.key));
  const sites = model.siteOrder.filter((o) => visible.some((r) => r.origin === o));
  const words = [...new Set([...analysis.picked.values()].flatMap((p) => (p.kind === "matched" || p.kind === "described" ? p.words : [])))];
  return (
    <MotionConfig reducedMotion="user">
    <div className="plan" aria-label="Plan">
      <div className="plan-head">
        <span className="plan-count">
          {visible.length === model.refs.length ? (
            <>
              All <NumberFlow value={visible.length} /> {visible.length === 1 ? "step" : "steps"}
            </>
          ) : (
            <>
              <NumberFlow value={visible.length} /> of {model.refs.length} steps
            </>
          )}
        </span>
        <span className="plan-why">
          {analysis.mode === "all" ? (
            analysis.terms.length ? (
              <span className="plan-all">Nothing in the outcome matched one step, so every step is in.</span>
            ) : (
              <span className="plan-all">Say what you want done to narrow it.</span>
            )
          ) : visible.length === model.refs.length ? null : (
            <>
              picked by{" "}
              {words.map((w, i) => (
                <span key={w}>
                  {i > 0 && (i === words.length - 1 ? " and " : ", ")}
                  <mark>{w}</mark>
                </span>
              ))}
            </>
          )}
        </span>
        <span className="plan-tools">
        {left.length > 0 && (
          <Tooltip
            content={
              <>
                Not needed for this outcome: {left.map((r) => r.cap.title).join(", ")}. They stay connected. Mention one to add it.
              </>
            }
          >
            <button type="button" className="plan-left">
              {left.length} left out
            </button>
          </Tooltip>
        )}
          <button type="button" className="plan-add" onClick={() => entryUi.openPalette()}>
            <PlugIcon /> Add a site <Kbd keys={["mod", "K"]} />
          </button>
        </span>
      </div>
      <ol className="plan-route">
        <AnimatePresence initial={false} mode="popLayout">
          {sites.map((o) => {
            const conn = model.connFor(o)!;
            const mine = visible.filter((r) => r.origin === o && (r.cap.side_effects === "write" || Object.keys(r.cap.input_schema.properties ?? {}).length > 0));
            const first = mine[0] ?? visible.find((r) => r.origin === o)!;
            const all = mine.length ? mine : [first];
            // Connected, but the outcome names nothing on it: its steps stay, after the named ones.
            const unnamed = analysis.mode === "matched" && !model.refs.some((r) => r.origin === o && analysis.picked.has(r.key));
            return (
              <motion.li key={o} layout className={`plan-stop ${unnamed ? "unnamed" : ""}`} style={hue(o)} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ type: "spring", stiffness: 500, damping: 34 }}>
                <Tooltip
                  content={
                    <>
                      Step {model.stepOf.get(o)} on {conn.site.site.name}: {all.map((r) => r.cap.title).join(", then ")}
                      {unnamed && <>. The outcome names nothing here; its steps stay because you connected it.</>}
                    </>
                  }
                >
                  <button type="button" className="plan-stop-btn" onClick={() => jumpTo(first.key, actions.setHot)}>
                    <span className="plan-n">{model.stepOf.get(o)}</span>
                    <Monogram name={conn.site.site.name} origin={o} size="sm" />
                    <span className="plan-titles">{first.cap.title}</span>
                    {unnamed && <span className="plan-unnamed">· not named</span>}
                  </button>
                </Tooltip>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </div>
    </MotionConfig>
  );
}

