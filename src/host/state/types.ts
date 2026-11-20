// The workspace state and every action that changes it. Owner: foundation (shared).
// Builders add an action only when an area needs new shared state; UI-only state (a palette that
// is open, a drawer that is expanded) stays inside the area's own components.
import type { FormValues } from "../../form";
import type { Site } from "../../protocol";
import type { Binding, CapKey } from "../doc";

export type ConnStatus = "connecting" | "ready" | "failed";
/** One connected site. `failed` covers a bridge that refused this host (host_not_allowed) or never answered. */
export type Conn = { key: number; site: Site; status: ConnStatus; failure?: string };

export type Run =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; output: unknown; at: Date }
  | { status: "error"; message: string; denied: boolean; at: Date };

export type Receipt = {
  id: number;
  at: Date;
  origin: string;
  siteName: string;
  title: string;
  write: boolean;
  outcome: "done" | "denied" | "failed";
  detail: string;
};

/**
 * The staged checks of one connection, as data. The entry area turns these into words.
 * - fetch: GET <origin>/.well-known/mosaic-capabilities.json
 * - verify: the manifest matches the schema and names the origin that served it
 * - bridge: the site's bridge iframe answered from the site's own origin
 * - build: Mosaic's source fingerprint, checked again after the connection
 */
export type ConnectStage = "fetch" | "verify" | "bridge" | "build";
export type StageState = "doing" | "done" | "failed";
export type TraceStage = { stage: ConnectStage; state: StageState; detail?: string };
export type Trace = {
  origin: string;
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
  /** Origin whose own approval sheet is showing, if any. */
  confirming: string | null;
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
};

export type Action =
  | { type: "host/loaded"; info: HostInfo }
  | { type: "connect/started"; origin: string }
  | { type: "connect/rejected"; message: string }
  | { type: "connect/manifest-read"; origin: string; site: Site }
  | { type: "connect/failed"; origin: string; message: string }
  | { type: "site/added"; site: Site; key: number }
  | { type: "site/settled"; origin: string }
  | { type: "site/bridge"; origin: string; status: "ready" | "failed"; failure?: string }
  | { type: "site/build-checked"; origin: string; build: string; same: boolean }
  | { type: "site/removed"; origin: string }
  | { type: "site/hue"; origin: string; hue: number }
  | { type: "doc/title"; title: string }
  | { type: "doc/prop"; key: "project" | "version"; value: string }
  | { type: "input/value"; cap: CapKey; field: string; value: string | boolean }
  | { type: "input/binding"; cap: CapKey; field: string; binding: Binding | null; at: number }
  | { type: "run/started"; cap: CapKey }
  | { type: "run/done"; cap: CapKey; output: unknown; at: Date; pulse: boolean }
  | { type: "run/failed"; cap: CapKey; message: string; denied: boolean; at: Date }
  | { type: "receipt/added"; receipt: Receipt }
  | { type: "approval/sheet"; origin: string | null }
  | { type: "publish/sending"; sending: boolean }
  | { type: "ui/hot"; cap: CapKey | null };
