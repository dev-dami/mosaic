// The workspace state and every action that changes it. Owner: foundation (shared).
// Builders add an action only when an area needs new shared state; UI-only state (a palette that
// is open, a drawer that is expanded) stays inside the area's own components.
import type { FormValues } from "../../form";
import type { Site } from "../agentic/catalog";
import type { TraceEvent, TurnEvent } from "../agentic/engine";
import type { AgentTurn, TurnInteraction } from "../agentic/turn";
import type { Binding, CapKey } from "../doc";

export type ConnStatus = "connecting" | "ready";
/** One connected site network. A connection is added only once its action bridge answered. */
export type Conn = { key: number; site: Site; status: ConnStatus };

export type Run =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; output: unknown; at: Date }
  /**
   * `unknown`: the site may have done it (the bridge closed or timed out mid-action); never retried.
   * `notStarted`: nothing was sent (the approval window was never opened, or an earlier action stopped).
   */
  | { status: "error"; message: string; denied: boolean; unknown?: boolean; notStarted?: boolean; at: Date };

export type Receipt = {
  id: number;
  at: Date;
  origin: string;
  siteName: string;
  title: string;
  write: boolean;
  outcome: "done" | "denied" | "failed" | "unknown" | "not_started";
  detail: string;
  /** The runtime's request id ("<invocation>:<index>"), to look the action up on the site. */
  requestId?: string;
};

/**
 * The staged checks of one connection, as data. The entry area turns these into words.
 * - consent: the person allowed contacting the site, before any request to it
 * - manifest: GET <origin>/agent-manifest.json
 * - network: the exact network name asked for is published there (fails closed otherwise)
 * - validate: the runtime fetched and compiled the network (MosaicAgent.connectNetwork)
 * - bridge: the site's own action bridge listed its actions for this host
 * - build: Mosaic's source fingerprint, checked again after the connection
 */
export type ConnectStage = "consent" | "manifest" | "network" | "validate" | "bridge" | "build";
export type StageState = "doing" | "done" | "failed";
export type TraceStage = { stage: ConnectStage; state: StageState; detail?: string };
export type Trace = {
  origin: string;
  /** The network name asked for, or picked from the manifest. */
  network?: string;
  /** Network names to choose from, when the site publishes several and none was named. */
  choices?: string[];
  stages: TraceStage[];
  /** Filled once the manifest is read. */
  siteName?: string;
  capabilities?: number;
  writes?: number;
  /** Filled at the build stage. */
  build?: string;
  buildSame?: boolean;
};

/** `agent` is Scout's origin, when this Mosaic has an agent for sites without a manifest. */
export type HostInfo = { build: string; suggestions: string[]; agent?: string };

export type State = {
  host: HostInfo | null;
  /** Result of the latest fingerprint check after a connection. */
  buildCheck: "same" | "changed" | null;
  conns: Conn[];
  /** The latest connection attempt, kept until the next one starts. */
  trace: Trace | null;
  /** A connection problem to show to the person (bad URL, duplicate, fetch or manifest error). */
  connectError: string | null;
  /** The outcome sentence the person typed ("Launch Lumen v1.0"). */
  title: string;
  /** Document properties the person typed over the values parsed from the outcome. */
  overrides: { project?: string; version?: string };
  runs: Record<CapKey, Run>;
  /** Values the person typed into inputs, per capability and field. */
  manual: Record<CapKey, FormValues>;
  /** Bindings the person chose. A field missing here uses the automatic binding; `null` means "typed by hand". */
  bindings: Record<CapKey, Record<string, Binding | null>>;
  /** Newest first, at most 40. */
  receipts: Receipt[];
  /** Origin whose own approval window is open, if any. */
  confirming: string | null;
  /** Origin waiting for the person to open its approval window (a click must open it). */
  asking: string | null;
  /** The browser blocked the approval window the person asked to open. */
  popupBlocked: boolean;
  /** The one write in flight: writes run one at a time, from the click to the site's answer. */
  writing: CapKey | null;
  /** True while "review all" walks through the pending writes. */
  sending: boolean;
  /** Origins whose hue the host assigned or the person picked. */
  hues: Record<string, number>;
  /** Origins connected in the last few seconds (for entrance effects). */
  fresh: string[];
  /** The capability whose value the pointer is over, to highlight its source. */
  hot: CapKey | null;
  /** The capability whose output just changed, to animate its wires. */
  pulse: { cap: CapKey; at: number } | null;
  /** The latest agent turn (model mode): Mosaic's own network running the outcome. */
  turn: AgentTurn | null;
  /** The earlier turns of this conversation, oldest first. A new outcome clears them. */
  thread: AgentTurn[];
};

export type Action =
  | { type: "host/loaded"; info: HostInfo }
  | { type: "connect/started"; origin: string; network?: string }
  | { type: "connect/rejected"; message: string }
  /** Every earlier stage passed; `stage` is now in progress. */
  | { type: "connect/stage"; origin: string; stage: ConnectStage; patch?: Partial<Pick<Trace, "network" | "siteName" | "capabilities" | "writes">> }
  | { type: "connect/choose"; origin: string; choices: string[] }
  | { type: "connect/failed"; origin: string; message: string }
  | { type: "site/added"; site: Site; key: number }
  | { type: "site/settled"; origin: string }
  | { type: "site/ready"; origin: string }
  | { type: "site/build-checked"; origin: string; build: string; same: boolean }
  | { type: "site/removed"; origin: string }
  | { type: "site/hue"; origin: string; hue: number }
  | { type: "doc/title"; title: string }
  | { type: "doc/prop"; key: "project" | "version"; value: string }
  | { type: "input/value"; cap: CapKey; field: string; value: string | boolean }
  | { type: "input/binding"; cap: CapKey; field: string; binding: Binding | null; at: number }
  | { type: "run/started"; cap: CapKey }
  | { type: "run/done"; cap: CapKey; output: unknown; at: Date; pulse: boolean }
  | { type: "run/failed"; cap: CapKey; message: string; denied: boolean; unknown?: boolean; notStarted?: boolean; at: Date }
  | { type: "receipt/added"; receipt: Receipt }
  | { type: "approval/sheet"; origin: string | null }
  | { type: "approval/ask"; origin: string | null }
  | { type: "approval/blocked" }
  | { type: "write/active"; cap: CapKey | null }
  | { type: "publish/sending"; sending: boolean }
  | { type: "ui/hot"; cap: CapKey | null }
  /** followUp: the turn continues the conversation, so the current turn joins the thread. */
  | { type: "turn/started"; outcome: string; followUp?: boolean; interaction?: TurnInteraction }
  /** The person added a line to the running turn. */
  | { type: "turn/steered"; text: string }
  | { type: "turn/trace"; event: TraceEvent }
  | { type: "turn/event"; event: TurnEvent }
  | { type: "turn/stopped" }
  /** The runtime finished the turn (after a Stop: it has drained). */
  | { type: "turn/settled" }
  | { type: "turn/failed"; message: string };
