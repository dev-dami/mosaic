// Mosaic's own runbook for an agent turn (model mode). Mosaic's agent network runs the outcome in
// this browser; the runtime reports each hop and agentic/turn.ts folds it into steps. Each peer
// network call is a step with the host-drawn provenance chip in that site's colour, each website_*
// call inside it is a capability card with its input and its output, and the composer's drafts are
// Mosaic's own steps. Problems the runtime reports (budget, cycle, declined, unreachable) show here
// in plain words. Writes still wait for the site's own approval window (review/approval.tsx).
import { CheckIcon, PenNibIcon, StopIcon, WarningIcon } from "@phosphor-icons/react";
import { capKey, hostOf } from "../doc";
import { composerLabel, previewValue, type AgentTurn, type TurnCard, type TurnStep } from "../agentic/turn";
import { Banner, Button, Provenance, Tag, useHueStyle } from "../primitives";
import { useMosaic } from "../state";
import { Composer } from "./composer";
import { humanKey, Markdown, OutputView } from "./output";
import { TurnWidgets } from "./widgets";

const two = (n: number) => String(n).padStart(2, "0");

export function AgentRunbook() {
  const { state } = useMosaic();
  const turn = state.turn;
  if (!turn) return null;
  const all = [...state.thread, turn];
  return (
    <div className="agent-thread" aria-label="Conversation with Mosaic's agent">
      {all.map((t, i) => (
        <TurnView key={`${i}:${t.startedAt}`} turn={t} first={i === 0} latest={i === all.length - 1} next={all[i + 1]} />
      ))}
      <Composer />
    </div>
  );
}

/** What the person said to start a follow-up turn: their text, or the widget answer they clicked. */
function YouSaid({ turn }: { turn: AgentTurn }) {
  return (
    <div className={`you-said ${turn.interaction ? "picked" : ""}`}>
      <span className="you-label">You</span>
      <p>{turn.outcome}</p>
    </div>
  );
}

function TurnView({ turn, first, latest, next }: { turn: AgentTurn; first: boolean; latest: boolean; next?: AgentTurn }) {
  const { actions } = useMosaic();
  const running = turn.status === "running";
  // A widget is live on the latest finished turn only; a later turn locks it, showing its answer.
  const answered = next?.interaction && next.interaction.turnId === turn.turnId ? next.interaction : undefined;
  let n = 0;
  return (
    <>
      {!first && <YouSaid turn={turn} />}
      <section className={`agent-turn ${turn.status} ${latest ? "latest" : "earlier"}`} aria-label="Agent runbook" aria-busy={running}>
      <header className="agent-turn-head">
        <span className="label">Mosaic's agent</span>
        <span className="agent-turn-status" role="status">
          {running ? "Running in this browser" : turn.status === "done" ? "Done" : turn.status === "stopped" ? (turn.draining ? "Stopping…" : "Stopped") : "Stopped with an error"}
        </span>
        {turn.model && (
          <span className="agent-turn-model" data-testid="turn-model">
            Model: {turn.model.name} at {turn.model.routerHost}
          </span>
        )}
        {running && (
          <Button variant="secondary" size="sm" icon={<StopIcon />} onClick={actions.stopTurn}>
            Stop
          </Button>
        )}
      </header>
      {turn.narration && running && <p className="agent-narration">{turn.narration}</p>}
      <ol className="agent-steps">
        {turn.steps.map((s) => {
          if (s.kind === "problem") return <ProblemRow key={s.id} step={s} />;
          n += 1;
          return s.kind === "peer" ? <PeerStep key={s.id} step={s} n={n} /> : <ComposerStep key={s.id} step={s} n={n} />;
        })}
        {running && turn.steps.length === 0 && <li className="agent-step pending">Planning the steps…</li>}
      </ol>
      {turn.steers.length > 0 && (
        <ul className="agent-steers" aria-label="What you added during this turn">
          {turn.steers.map((t, i) => (
            <li key={i}>
              <span className="you-label">You added</span> {t}
            </li>
          ))}
        </ul>
      )}
      {turn.status === "failed" && (
        <Banner tone="danger" icon={<WarningIcon />} role="alert" className="agent-error">
          {turn.error}
        </Banner>
      )}
      {turn.status === "stopped" && (
        <Banner tone="warning" icon={<StopIcon />} className="agent-error">
          {turn.draining
            ? "Stopping… A step already in flight is finishing. No further step starts and no approval window opens for this turn."
            : "You stopped this turn. No further step starts and no approval window opens for it."}
        </Banner>
      )}
      {turn.status === "done" && turn.answer && (
        <div className="agent-summary" aria-label="Summary">
          <span className="label">Summary</span>
          <Markdown source={turn.answer} />
        </div>
      )}
      {turn.status === "done" && turn.turnId && <TurnWidgets components={turn.components} turnId={turn.turnId} live={latest} answered={answered} />}
      </section>
    </>
  );
}

function StatusKey({ n, status }: { n: number; status: "running" | "ok" | "error" }) {
  const cls = status === "ok" ? "done" : status;
  return (
    <span className={`step-key ${cls}`} aria-label={`Step ${n}${status === "ok" ? ", done" : status === "running" ? ", running" : ", failed"}`}>
      {two(n)}
      {status === "ok" && (
        <span className="step-key-badge" aria-hidden="true">
          <CheckIcon size={9} weight="bold" />
        </span>
      )}
    </span>
  );
}

function PeerStep({ step, n }: { step: Extract<TurnStep, { kind: "peer" }>; n: number }) {
  const { model } = useMosaic();
  const hue = useHueStyle();
  const conn = model.siteOrder.map((o) => model.connFor(o)).find((c) => c && hostOf(c.site.site.origin) === step.host);
  const origin = conn?.site.site.origin ?? step.origin ?? `${location.protocol}//${step.host}`;
  const name = conn?.site.site.name ?? step.brand ?? step.network;
  return (
    <li className={`agent-step peer ${step.status}`} data-origin={origin} data-network={step.network} style={hue(origin)}>
      <div className="agent-step-head">
        <StatusKey n={n} status={step.status} />
        <h3>Asked {name}</h3>
        <Provenance name={name} origin={origin} />
      </div>
      {step.request && <p className="agent-request">“{step.request}”</p>}
      {step.cards.map((c) => (
        <CapCard key={c.id} card={c} origin={origin} conn={conn} />
      ))}
      {step.status === "error" && step.error && (
        <p className="agent-step-error" role="alert">
          <WarningIcon aria-hidden="true" /> {step.error}
        </p>
      )}
      {step.status === "ok" && step.response && <p className="agent-response">{step.response}</p>}
    </li>
  );
}

function CapCard({ card, origin, conn }: { card: TurnCard; origin: string; conn: ReturnType<ReturnType<typeof useMosaic>["model"]["connFor"]> }) {
  const { state } = useMosaic();
  const cap = conn?.site.capabilities.find((c) => c.id === card.action);
  const write = cap?.side_effects === "write";
  const run = cap ? state.runs[capKey(origin, cap.id)] : undefined;
  // The full value comes from the action registry (store); the trace's preview is the fallback.
  // This call's own registry answer (not an earlier run of the same capability) wins over the
  // trace: a write approved before Stop stays Published.
  const answered = run && run.status !== "idle" && run.status !== "running" && run.at.getTime() >= card.startedAt ? run : undefined;
  const output = answered?.status === "done" ? answered.output : previewValue(card.preview);
  const status = answered?.status === "done" ? "ok" : card.status;
  const tag =
    status === "running" ? (write ? "Waiting for approval" : "Running") : status === "error" ? "Failed" : answered?.status === "error" ? (answered.denied ? "Denied" : answered.unknown ? "Outcome unknown" : "Not done") : write ? "Published" : "Read";
  const tone = status === "running" ? "info" : status === "error" || answered?.status === "error" ? "danger" : "success";
  return (
    <div className={`agent-card ${write ? "write" : "read"} ${status}`} data-action={card.action}>
      <div className="agent-card-head">
        <span className="act-kind">{write ? "write" : "read"}</span>
        <b>{cap?.title ?? humanKey(card.action)}</b>
        <Tag tone={tone} size="sm">
          {tag}
        </Tag>
      </div>
      {!!card.input && typeof card.input === "object" && Object.keys(card.input).length > 0 && (
        <div className="agent-card-input">
          <span className="label">Input</span>
          <OutputView value={card.input} origin={origin} />
        </div>
      )}
      {status === "error" && card.error && (
        <p className="agent-step-error" role="alert">
          <WarningIcon aria-hidden="true" /> {card.error}
        </p>
      )}
      {status === "ok" && output !== undefined && (
        <div className="agent-card-output output">
          <span className="label">Output</span>
          <OutputView value={output} origin={origin} />
        </div>
      )}
    </div>
  );
}

function ComposerStep({ step, n }: { step: Extract<TurnStep, { kind: "composer" }>; n: number }) {
  return (
    <li className={`agent-step composer ${step.status}`}>
      <div className="agent-step-head">
        <StatusKey n={n} status={step.status} />
        <h3>{composerLabel(step)}</h3>
        <span className="provenance mosaic-own" title="Mosaic's own composer agent, in this browser">
          <PenNibIcon aria-hidden="true" />
          <span className="pv-name">Mosaic · composer</span>
        </span>
      </div>
      {step.request && <p className="agent-request">“{step.request}”</p>}
      {step.status === "error" && step.error && (
        <p className="agent-step-error" role="alert">
          <WarningIcon aria-hidden="true" /> {step.error}
        </p>
      )}
    </li>
  );
}

function ProblemRow({ step }: { step: Extract<TurnStep, { kind: "problem" }> }) {
  return (
    <li className="agent-step problem" role="alert">
      <WarningIcon aria-hidden="true" />
      <span>
        <b>{step.target}</b>: {step.message}
      </span>
    </li>
  );
}
