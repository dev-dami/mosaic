// One agent turn as Mosaic's runbook shows it. The runtime reports a turn twice: its TraceBus (every
// span: remote_call, tool, model_call, notes) and Engine.streamTurn's public events (text deltas,
// completion, failure). This file folds both into one plain value the UI renders:
//   - each peer network call (remote_call span) is a step, labelled by the host the runtime called;
//   - each website_* tool call inside it is a capability card with its input and output;
//   - each call to Mosaic's own composer agent is Mosaic's own step ("Composer drafted ...");
//   - budget, cycle, declined and unreachable-site notes are visible problems, never console logs;
//   - the front agent's streamed text is the narration; the final answer is the summary.
// Pure: no DOM, no runtime import. test/turn.test.ts feeds it recorded and synthetic events.
import type { TraceEvent, TurnEvent } from "./engine";
import { COMPOSER_AGENT } from "./network";

const WEBSITE_TOOL = "website_";

export type StepStatus = "running" | "ok" | "error";

/** A website_* action a peer network ran during the turn. */
export type TurnCard = {
  id: string;
  /** The action name (the capability id), without the website_ prefix. */
  action: string;
  input: unknown;
  status: StepStatus;
  /** Wall-clock start (ms), to tell this call's registry answer from an earlier run's. */
  startedAt: number;
  /** The tool result as the runtime previewed it (the full value arrives through the action registry). */
  preview?: string;
  error?: string;
};

export type TurnStep =
  | {
      kind: "peer";
      id: string;
      /** The host the runtime called, as it drew it ("localhost:4101"). */
      host: string;
      /** The peer's origin, from the first file the runtime fetched from it, when known. */
      origin?: string;
      network: string;
      brand?: string;
      request: string;
      status: StepStatus;
      response?: string;
      error?: string;
      cards: TurnCard[];
    }
  | { kind: "composer"; id: string; request: string; status: StepStatus; draft?: string; error?: string }
  /** Something the runtime refused or skipped: over budget, a cycle, a declined or unreachable site. */
  | { kind: "problem"; id: string; target: string; message: string };

export type AgentTurn = {
  outcome: string;
  status: "running" | "done" | "failed" | "stopped";
  /** The model and router host of the first model call: observable execution (spec §5). */
  model?: { name: string; routerHost: string };
  steps: TurnStep[];
  /** The front agent's streamed text. */
  narration: string;
  answer?: string;
  error?: string;
  /** Stopped, and the runtime is still finishing what was in flight. */
  draining?: boolean;
  /** The run span's id, once the runtime opened it. Events outside its subtree are ignored. */
  runId: string | null;
  /** Span id → parent id and kind, for every span inside the run. */
  spans: Record<string, { kind: string; parent: string | null; tool?: string; network?: string }>;
};

export function startTurn(outcome: string): AgentTurn {
  return { outcome, status: "running", steps: [], narration: "", runId: null, spans: {} };
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

function requestText(args: unknown): string {
  if (args && typeof args === "object" && "request" in args) return str((args as { request: unknown }).request);
  return str(args);
}

/** The nearest enclosing span of a kind, walking parents. */
function nearest(turn: AgentTurn, id: string | null | undefined, kind: string): string | null {
  let at = id ?? null;
  for (let guard = 0; at && guard < 64; guard++) {
    const span = turn.spans[at];
    if (!span) return null;
    if (span.kind === kind) return at;
    at = span.parent;
  }
  return null;
}

const patchStep = (turn: AgentTurn, id: string, patch: (s: TurnStep) => TurnStep): AgentTurn => ({
  ...turn,
  steps: turn.steps.map((s) => (s.id === id ? patch(s) : s)),
});

function patchCard(turn: AgentTurn, id: string, patch: Partial<TurnCard>): AgentTurn {
  return {
    ...turn,
    steps: turn.steps.map((s) => (s.kind === "peer" && s.cards.some((c) => c.id === id) ? { ...s, cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : s)),
  };
}

const hostOf = (target: string) => {
  try {
    return new URL(target).host;
  } catch {
    return target;
  }
};

/** Folds one TraceBus event into the turn. Returns the same object when the event changes nothing. */
export function applyTrace(turn: AgentTurn, ev: TraceEvent): AgentTurn {
  if (turn.status !== "running") return turn;
  if (turn.runId === null) {
    if (ev.phase === "start" && ev.kind === "run" && ev.id) {
      return { ...turn, runId: ev.id, spans: { [ev.id]: { kind: "run", parent: null } } };
    }
    return turn;
  }
  const inside = (ev.id && turn.spans[ev.id]) || (ev.parent && turn.spans[ev.parent]);
  if (!inside) return turn;

  let next = turn;
  if (ev.phase === "start" && ev.id && !turn.spans[ev.id]) {
    next = { ...turn, spans: { ...turn.spans, [ev.id]: { kind: ev.kind, parent: ev.parent ?? null, tool: ev.tool as string | undefined, network: ev.network } } };
  }

  // ---- spans that start
  if (ev.phase === "start") {
    if (ev.kind === "model_call" && !next.model && typeof ev.model === "string") {
      return { ...next, model: { name: ev.model, routerHost: str(ev.routerHost) } };
    }
    if (ev.kind === "remote_call" && ev.id) {
      const payload = ev.requestPayload as { user_message?: { text?: string } } | undefined;
      const fetched = Array.isArray(ev.fetchedUrls) ? ev.fetchedUrls.find((u): u is string => typeof u === "string") : undefined;
      let origin: string | undefined;
      try {
        origin = fetched ? new URL(fetched).origin : undefined;
      } catch {}
      const step: TurnStep = {
        kind: "peer",
        id: ev.id,
        host: str(ev.peerOrigin),
        origin,
        network: str(ev.network),
        brand: typeof ev.brand === "string" && ev.brand ? ev.brand : undefined,
        request: str(payload?.user_message?.text),
        status: "running",
        cards: [],
      };
      return { ...next, steps: [...next.steps, step] };
    }
    if (ev.kind === "tool" && ev.id && typeof ev.tool === "string") {
      if (ev.tool === COMPOSER_AGENT && nearest(next, ev.parent, "remote_call") === null) {
        return { ...next, steps: [...next.steps, { kind: "composer", id: ev.id, request: requestText(ev.args), status: "running" }] };
      }
      if (ev.tool.startsWith(WEBSITE_TOOL)) {
        const peer = nearest(next, ev.parent, "remote_call");
        if (!peer) return next;
        const card: TurnCard = { id: ev.id, action: ev.tool.slice(WEBSITE_TOOL.length), input: ev.args ?? {}, status: "running", startedAt: ev.wall };
        return patchStep(next, peer, (s) => (s.kind === "peer" ? { ...s, cards: [...s.cards, card] } : s));
      }
    }
    return next;
  }

  // ---- spans that end
  if (ev.phase === "end" && ev.id) {
    const failed = ev.status === "error";
    const own = next.steps.find((s) => s.id === ev.id);
    if (ev.kind === "remote_call" && own?.kind === "peer") {
      return patchStep(next, ev.id, (s) => (s.kind === "peer" ? { ...s, status: failed ? "error" : "ok", response: s.response ?? (str(ev.responsePreview) || undefined), error: failed ? str(ev.error) : undefined } : s));
    }
    if (ev.kind === "tool") {
      if (own?.kind === "composer") {
        return patchStep(next, ev.id, (s) => (s.kind === "composer" ? { ...s, status: failed ? "error" : "ok", error: failed ? str(ev.error) : undefined } : s));
      }
      const tool = str(ev.tool);
      if (tool.startsWith(WEBSITE_TOOL)) {
        return patchCard(next, ev.id, { status: failed ? "error" : "ok", preview: str(ev.resultPreview) || undefined, error: failed ? str(ev.error) : undefined });
      }
      // A hand-off to a peer that failed before any remote_call opened: a denied origin, an
      // invalid network, a site that did not answer.
      if (failed && !next.steps.some((s) => s.kind === "peer" && next.spans[s.id]?.parent === ev.id)) {
        return { ...next, steps: [...next.steps, { kind: "problem", id: ev.id, target: tool, message: str(ev.error) }] };
      }
    }
    if (ev.kind === "run" && failed) {
      return { ...next, status: "failed", error: str(ev.error) };
    }
    return next;
  }

  // ---- notes
  if (ev.phase === "note") {
    if (ev.kind === "agent_result" && ev.parent) {
      const step = next.steps.find((s) => s.id === ev.parent);
      if (step?.kind === "peer") return patchStep(next, step.id, (s) => (s.kind === "peer" ? { ...s, response: str(ev.text) } : s));
      if (step?.kind === "composer" && ev.agent === COMPOSER_AGENT) return patchStep(next, step.id, (s) => (s.kind === "composer" ? { ...s, draft: str(ev.text) } : s));
      return next;
    }
    const id = `note:${ev.seq}`;
    if (ev.kind === "composition_limit" || ev.kind === "composition_skip") {
      const target = str(ev.target) || str(ev.agent);
      const message = ev.kind === "composition_skip" ? `Skipped: ${str(ev.reason) || "already in this request's call chain"} (a cycle)` : `Skipped: ${str(ev.reason)}`;
      return { ...next, steps: [...next.steps, { kind: "problem", id, target: hostOf(target), message }] };
    }
    if (ev.kind === "consent" && ev.decision === "declined") {
      return { ...next, steps: [...next.steps, { kind: "problem", id, target: str(ev.peerOrigin), message: `You declined to contact ${str(ev.peerOrigin)}. Nothing was sent to it.` }] };
    }
  }
  return next;
}

/** Folds one public streamTurn event into the turn. */
export function applyTurnEvent(turn: AgentTurn, ev: TurnEvent): AgentTurn {
  if (turn.status !== "running") return turn;
  switch (ev.type) {
    case "agent.output.delta":
      return ev.visibility === "user" && ev.delta ? { ...turn, narration: turn.narration + ev.delta } : turn;
    case "turn.completed":
      return { ...turn, status: "done", answer: ev.result?.text ?? turn.narration, steps: settle(turn.steps) };
    case "turn.failed":
      return { ...turn, status: "failed", error: turnError(turn, ev.error || "The turn failed."), steps: settle(turn.steps) };
    default:
      return turn;
  }
}

/**
 * A network failure at the turn level is the top agent's model call: the router could not be
 * reached (offline, or blocked by the page's Content-Security-Policy). Say so in plain words.
 */
function turnError(turn: AgentTurn, error: string): string {
  if (turn.model?.routerHost && /failed to fetch|networkerror|load failed|content security policy/i.test(error)) {
    return `Mosaic could not reach the model router ${turn.model.routerHost}. Check AI model settings.`;
  }
  return error;
}

/** Stop: nothing more from this turn is shown, and steps still running say so. */
export function stopTurn(turn: AgentTurn): AgentTurn {
  if (turn.status !== "running") return turn;
  return { ...turn, status: "stopped", draining: true, steps: settle(turn.steps, "Stopped") };
}

/** The runtime finished the turn; after a Stop, it has drained. */
export function settleTurn(turn: AgentTurn): AgentTurn {
  return turn.draining ? { ...turn, draining: false } : turn;
}

function settle(steps: TurnStep[], why = "Did not finish"): TurnStep[] {
  return steps.map((s) => {
    if (s.kind === "problem" || s.status !== "running") return s;
    if (s.kind === "peer") return { ...s, status: "error", error: s.error ?? why, cards: s.cards.map((c) => (c.status === "running" ? { ...c, status: "error", error: why } : c)) };
    return { ...s, status: "error", error: s.error ?? why };
  });
}

/** "Composer drafted ..." with the start of the draft. */
export function composerLabel(step: Extract<TurnStep, { kind: "composer" }>): string {
  if (step.status === "running") return "Composer is drafting";
  if (step.status === "error") return "Composer could not draft";
  const first = (step.draft ?? "").replace(/\s+/g, " ").trim();
  return first ? `Composer drafted "${first.length > 72 ? `${first.slice(0, 71)}…` : first}"` : "Composer drafted a value";
}

/** The parsed value of a preview when it is complete JSON, else the text itself. */
export function previewValue(preview: string | undefined): unknown {
  if (!preview) return undefined;
  try {
    return JSON.parse(preview);
  } catch {
    return preview;
  }
}
