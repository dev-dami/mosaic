// Mosaic's own runbook for an agent turn (model mode). Mosaic's agent network runs the outcome in
// this browser; the runtime reports each hop and agentic/turn.ts folds it into steps. Each peer
// network call is a step with the host-drawn provenance chip in that site's colour, each website_*
// call inside it is a capability card with its input and its output, and the composer's drafts are
// Mosaic's own steps. Problems the runtime reports (budget, cycle, declined, unreachable) show here
// in plain words. Writes still wait for the site's own approval window (review/approval.tsx).
import { CheckIcon, PenNibIcon, StopIcon, WarningIcon } from "@phosphor-icons/react";
import { capKey, hostOf } from "../doc";
import { composerLabel, previewValue, type TurnCard, type TurnStep } from "../agentic/turn";
import { Banner, Button, Provenance, Tag, useHueStyle } from "../primitives";
import { useMosaic } from "../state";
import { humanKey, Markdown, OutputView } from "./output";

const two = (n: number) => String(n).padStart(2, "0");

export function AgentRunbook() {
  const { state, actions } = useMosaic();
  const turn = state.turn;
  if (!turn) return null;
  const running = turn.status === "running";
  let n = 0;
  return (
    <section className={`agent-turn ${turn.status}`} aria-label="Agent runbook" aria-busy={running}>
      <header className="agent-turn-head">
        <span className="label">Mosaic's agent</span>
        <span className="agent-turn-status" role="status">
          {running ? "Running in this browser" : turn.status === "done" ? "Done" : turn.status === "stopped" ? "Stopped" : "Stopped with an error"}
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
      {turn.status === "failed" && (
        <Banner tone="danger" icon={<WarningIcon />} role="alert" className="agent-error">
          {turn.error}
        </Banner>
      )}
      {turn.status === "stopped" && (
        <Banner tone="warning" icon={<StopIcon />} className="agent-error">
          You stopped this turn. No further step starts and no approval window opens for it.
        </Banner>
      )}
      {turn.status === "done" && turn.answer && (
        <div className="agent-summary" aria-label="Summary">
          <span className="label">Summary</span>
          <Markdown source={turn.answer} />
        </div>
      )}
    </section>
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
  const origin = conn?.site.site.origin ?? `http://${step.host}`;
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
  const output = run?.status === "done" ? run.output : previewValue(card.preview);
  const tag =
    card.status === "running" ? (write ? "Waiting for approval" : "Running") : card.status === "error" ? "Failed" : run?.status === "error" ? (run.denied ? "Denied" : run.unknown ? "Outcome unknown" : "Not done") : write ? "Published" : "Read";
  const tone = card.status === "running" ? "info" : card.status === "error" || run?.status === "error" ? "danger" : "success";
  return (
    <div className={`agent-card ${write ? "write" : "read"} ${card.status}`} data-action={card.action}>
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
      {card.status === "error" && card.error && (
        <p className="agent-step-error" role="alert">
          <WarningIcon aria-hidden="true" /> {card.error}
        </p>
      )}
      {card.status === "ok" && output !== undefined && (
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
