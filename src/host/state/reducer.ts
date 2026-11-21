// The pure reducer for workspace state. Owner: foundation (shared).
import { hueOfColor, siteHue } from "../hue";
import { applyTrace, applyTurnEvent, settleTurn, startTurn, stopTurn } from "../agentic/turn";
import type { Action, ConnectStage, State, Trace, TraceStage } from "./types";

/** Earlier turns kept on the page. The runtime keeps its own, shorter history (engine.js: 24 entries). */
const MAX_THREAD = 20;
const STAGES: ConnectStage[] = ["consent", "manifest", "network", "validate", "bridge", "build"];

export const initialState: State = {
  host: null,
  buildCheck: null,
  conns: [],
  trace: null,
  connectError: null,
  title: "Launch Lumen v1.0",
  overrides: {},
  runs: {},
  manual: {},
  bindings: {},
  receipts: [],
  confirming: null,
  asking: null,
  popupBlocked: false,
  writing: null,
  sending: false,
  hues: {},
  fresh: [],
  hot: null,
  pulse: null,
  turn: null,
  thread: [],
};

/** Replace the last stage of the trace for `origin` (the one in progress) and append more. */
function traceFor(state: State, origin: string, update: (t: Trace) => Trace): Trace | null {
  return state.trace && state.trace.origin === origin ? update(state.trace) : state.trace;
}
const settleLast = (stages: TraceStage[], last: TraceStage, ...more: TraceStage[]) => [...stages.slice(0, -1), last, ...more];

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "host/loaded":
      return { ...state, host: action.info };

    case "connect/started":
      return { ...state, connectError: null, trace: { origin: action.origin, network: action.network, stages: [{ stage: "consent", state: "doing" }] } };

    case "connect/rejected":
      return { ...state, connectError: action.message };

    case "connect/stage":
      return {
        ...state,
        trace: traceFor(state, action.origin, (t) => {
          const i = STAGES.indexOf(action.stage);
          return { ...t, ...action.patch, stages: [...STAGES.slice(0, i).map((stage) => ({ stage, state: "done" as const })), { stage: action.stage, state: "doing" }] };
        }),
      };

    case "connect/choose":
      return {
        ...state,
        trace: traceFor(state, action.origin, (t) => ({
          ...t,
          choices: action.choices,
          stages: settleLast(t.stages, { stage: "network", state: "failed", detail: `Publishes ${action.choices.length} networks: pick one` }),
        })),
      };

    case "connect/failed":
      return {
        ...state,
        connectError: action.message,
        trace: traceFor(state, action.origin, (t) => {
          const last = t.stages[t.stages.length - 1]!;
          return { ...t, stages: settleLast(t.stages, { stage: last.stage, state: "failed", detail: action.message }) };
        }),
      };

    case "site/added": {
      const origin = action.site.site.origin;
      const others = Object.entries(state.hues).filter(([o]) => o !== origin).map(([, h]) => h);
      const hue = state.hues[origin] ?? siteHue(origin, others, hueOfColor(action.site.site.theme_color));
      return {
        ...state,
        conns: [...state.conns.filter((c) => c.site.site.origin !== origin), { key: action.key, site: action.site, status: "connecting" }],
        hues: { ...state.hues, [origin]: hue },
        fresh: [...state.fresh.filter((o) => o !== origin), origin],
      };
    }

    case "site/settled":
      return { ...state, fresh: state.fresh.filter((o) => o !== action.origin) };

    case "site/ready": {
      const { origin } = action;
      return {
        ...state,
        conns: state.conns.map((c) => (c.site.site.origin === origin ? { ...c, status: "ready" } : c)),
        trace: traceFor(state, origin, (t) => ({ ...t, stages: settleLast(t.stages, { stage: "bridge", state: "done" }) })),
      };
    }

    case "site/build-checked":
      return {
        ...state,
        buildCheck: action.same ? "same" : "changed",
        trace: traceFor(state, action.origin, (t) => ({
          ...t,
          build: action.build,
          buildSame: action.same,
          stages: [...t.stages, { stage: "build", state: action.same ? "done" : "failed" }],
        })),
      };

    case "site/removed":
      return { ...state, conns: state.conns.filter((c) => c.site.site.origin !== action.origin) };

    case "site/hue":
      return { ...state, hues: { ...state.hues, [action.origin]: action.hue } };

    case "doc/title":
      return { ...state, title: action.title };

    case "doc/prop":
      return { ...state, overrides: { ...state.overrides, [action.key]: action.value } };

    case "input/value":
      return { ...state, manual: { ...state.manual, [action.cap]: { ...state.manual[action.cap], [action.field]: action.value } } };

    case "input/binding": {
      const { binding } = action;
      return {
        ...state,
        bindings: { ...state.bindings, [action.cap]: { ...state.bindings[action.cap], [action.field]: binding } },
        pulse: binding?.kind === "output" ? { cap: binding.cap, at: action.at } : state.pulse,
      };
    }

    case "run/started":
      return { ...state, runs: { ...state.runs, [action.cap]: { status: "running" } } };

    case "run/done":
      return {
        ...state,
        runs: { ...state.runs, [action.cap]: { status: "done", output: action.output, at: action.at } },
        pulse: action.pulse ? { cap: action.cap, at: action.at.getTime() } : state.pulse,
      };

    case "run/failed":
      return {
        ...state,
        runs: { ...state.runs, [action.cap]: { status: "error", message: action.message, denied: action.denied, unknown: action.unknown, notStarted: action.notStarted, at: action.at } },
      };

    case "receipt/added":
      return { ...state, receipts: [action.receipt, ...state.receipts].slice(0, 40) };

    case "approval/sheet":
      return { ...state, confirming: action.origin, asking: action.origin ? null : state.asking };

    case "approval/ask":
      return { ...state, asking: action.origin, popupBlocked: false };

    case "approval/blocked":
      return { ...state, popupBlocked: true };

    case "write/active":
      return { ...state, writing: action.cap };

    case "publish/sending":
      return { ...state, sending: action.sending };

    case "ui/hot":
      return { ...state, hot: action.cap };

    case "turn/started": {
      const thread = action.followUp && state.turn ? [...state.thread, state.turn].slice(-MAX_THREAD) : [];
      return { ...state, thread, turn: startTurn(action.outcome, action.interaction) };
    }

    case "turn/steered":
      return state.turn?.status === "running" ? { ...state, turn: { ...state.turn, steers: [...state.turn.steers, action.text] } } : state;

    case "turn/trace": {
      if (!state.turn) return state;
      const turn = applyTrace(state.turn, action.event);
      return turn === state.turn ? state : { ...state, turn };
    }

    case "turn/event": {
      if (!state.turn) return state;
      const turn = applyTurnEvent(state.turn, action.event);
      return turn === state.turn ? state : { ...state, turn };
    }

    case "turn/stopped":
      return state.turn ? { ...state, turn: stopTurn(state.turn) } : state;

    case "turn/settled":
      return state.turn ? { ...state, turn: settleTurn(state.turn) } : state;

    case "turn/failed":
      return state.turn && state.turn.status === "running" ? { ...state, turn: { ...state.turn, status: "failed", error: action.message } } : state;
  }
}
