// Mosaic's wrapper over the pinned nsdeploy browser runtime (vendor/nsdeploy-runtime, never edited).
// It loads /runtime/engine.js by a variable URL (so ui.js is never fetched), raises the per-turn
// remote-call budget, hides unbound link slots from the front agent, binds sites only by exact name,
// and turns the runtime's trace into a typed stream. The model setup comes from the person's BYOK
// profile; with no key Mosaic runs in manual mode and makes no model call at all.
import type { ActionRegistry } from "./catalog";
import { COMPOSER_AGENT, OTARI_ROUTER, SPARE_SLOTS } from "./network";

export const RUNTIME_ENGINE_URL = "/runtime/engine.js";
/** What Mosaic allows per turn. The demo chain needs five or more peer calls. */
export const MAX_REMOTE_CALLS = 8;
/** The value the pinned runtime hard-codes in runTurn (engine.js). test/engine.test.ts pins it. */
export const RUNTIME_DEFAULT_MAX_REMOTE_CALLS = 4;
export const NO_KEY_MESSAGE = "No key: Mosaic plans steps without a model";

// ---- The slice of the runtime's shapes Mosaic relies on ----------------------------------------

export interface RuntimeNetwork {
  name: string;
  linkSlots: Set<string>;
  links: Record<string, string>;
  getLink(ref: string): string | null;
  setLink(ref: string, target: string): void;
  getAgentSpec(name: string): { tools?: unknown[] } | null;
  findFrontMan(): string;
}

export interface RuntimeTrace extends EventTarget {
  note(kind: string, fields?: Record<string, unknown>): void;
}

/** One event of the runtime's TraceBus (trace.js). Spans start, update and end; notes stand alone. */
export interface TraceEvent {
  phase: "start" | "update" | "end" | "note";
  kind: string;
  seq: number;
  wall: number;
  id?: string;
  parent?: string | null;
  status?: "running" | "ok" | "error";
  error?: string;
  origin?: string;
  peerOrigin?: string;
  network?: string;
  [field: string]: unknown;
}

/** One public event of Engine.streamTurn (execution-stream.js). */
export interface TurnEvent {
  type: string;
  turnId: string | null;
  id: string;
  parentId: string | null;
  delta?: string;
  error?: string;
  result?: { text: string; turnId?: string };
  visibility?: "user" | "developer";
  [field: string]: unknown;
}

export interface ConsentRequest {
  kind: "network" | "mcp" | "connect";
  peerOrigin: string;
  peerLabel?: string;
  requestText?: string;
  phase?: string;
}
export type ConsentDecision = "allow" | "always" | "decline";

export interface RuntimeEngine {
  top: { network: RuntimeNetwork; base: string; manifest: { allowed_peers?: string[] } } | null;
  trace: RuntimeTrace;
  history: unknown[];
  runtimeAllowedPeers: Set<string>;
  /** The runtime's action registry: every connected site's bridge actions (agentic/catalog.ts). */
  actions: ActionRegistry;
  onConsent: ((info: ConsentRequest) => Promise<ConsentDecision>) | null;
  onLinkRequired: ((info: { reference: string }) => Promise<string | null>) | null;
  loadTop(): Promise<{ network: RuntimeNetwork; validation: { errors: string[] } }>;
  requestConsent(info: ConsentRequest): Promise<"allow" | "decline">;
  resolveRemote(ref: string, chain: string[], parentSpan: string | null): Promise<{ network: { name: string }; base: string }>;
  runTurn(text: string, opts: { slyData?: Record<string, unknown> }): Promise<{ text: string }>;
  streamTurn(text: string, opts?: { slyData?: Record<string, unknown> }): AsyncIterable<TurnEvent>;
  _makeCtx(args: unknown): unknown;
}

export interface EngineOptions {
  originUrl: string;
  byokKey?: string;
  routerOverride?: string;
  modelOverride?: string;
}

export interface RuntimeModule {
  Engine: new (opts: EngineOptions) => RuntimeEngine;
}

// ---- Model setup ---------------------------------------------------------------------------------

/** The applied BYOK setup (byok.js loadTabByokSetup). An empty router means the published default. */
export interface ModelSetup {
  key: string;
  router: string;
  model: string;
}

/**
 * The Engine options for a setup. With no key, none of it applies: the engine takes the published
 * default router (Otari) and Mosaic stays in manual mode, so the host never pays for a call.
 */
export function engineOptions(setup: ModelSetup, originUrl: string): EngineOptions {
  if (!setup.key) return { originUrl };
  return { originUrl, byokKey: setup.key, routerOverride: setup.router, modelOverride: setup.model };
}

/** The only host the key is ever sent to. */
export function routerHostOf(setup: Partial<ModelSetup>): string {
  try {
    return new URL(setup.router || OTARI_ROUTER).host;
  } catch {
    return setup.router ?? "";
  }
}

// ---- The engine class ----------------------------------------------------------------------------

const classes = new WeakMap<RuntimeModule["Engine"], RuntimeModule["Engine"]>();

/**
 * Engine with a per-turn budget of MAX_REMOTE_CALLS. It overrides `_makeCtx`, a private method of
 * the pinned runtime: runTurn passes it the composition object every hop of the turn shares, so
 * raising the limit there raises it for the whole turn. Refuses a runtime without that method.
 */
export function makeMosaicEngineClass(Engine: RuntimeModule["Engine"]): RuntimeModule["Engine"] {
  const cached = classes.get(Engine);
  if (cached) return cached;
  if (typeof (Engine.prototype as Partial<RuntimeEngine>)._makeCtx !== "function") {
    throw new Error("The nsdeploy runtime has no Engine._makeCtx; Mosaic's remote-call budget needs it. Check vendor/nsdeploy-runtime.");
  }
  class MosaicEngine extends (Engine as new (opts: EngineOptions) => RuntimeEngine) {
    _makeCtx(args: { composition?: { maxRemoteCalls: number } }) {
      if (args?.composition && args.composition.maxRemoteCalls < MAX_REMOTE_CALLS) {
        args.composition.maxRemoteCalls = MAX_REMOTE_CALLS;
      }
      return super._makeCtx(args);
    }
  }
  classes.set(Engine, MosaicEngine);
  return MosaicEngine;
}

const runtimes = new Map<string, Promise<RuntimeModule>>();

/** Imports the runtime once per URL. The URL is a variable, so the bundler leaves it to the browser. */
export function loadRuntime(url: string = RUNTIME_ENGINE_URL): Promise<RuntimeModule> {
  let loading = runtimes.get(url);
  if (!loading) {
    loading = import(/* @vite-ignore */ url) as Promise<RuntimeModule>;
    runtimes.set(url, loading);
    loading.catch(() => runtimes.delete(url));
  }
  return loading;
}

// ---- The agent -----------------------------------------------------------------------------------

export interface MosaicAgentOptions {
  setup: ModelSetup;
  /** Required: the runtime allows every contact when no consent hook is set. */
  onConsent: (req: ConsentRequest) => Promise<ConsentDecision>;
  originUrl?: string;
  runtimeUrl?: string;
}

export interface BoundNetwork {
  slot: string;
  network: string;
  origin: string;
  url: string;
}

/** Mosaic's agent network running in this browser on the person's model setup. */
export class MosaicAgent {
  readonly mode: "model" | "manual";
  readonly routerHost: string;
  /** Networks bound by connectNetwork, kept across rebuilds. */
  readonly connected: BoundNetwork[] = [];
  private readonly frontToolsAll: string[];

  private constructor(
    readonly engine: RuntimeEngine,
    private readonly options: MosaicAgentOptions,
  ) {
    this.mode = options.setup.key ? "model" : "manual";
    this.routerHost = routerHostOf(this.mode === "model" ? options.setup : { router: "" });
    const spec = this.frontSpec();
    this.frontToolsAll = (spec?.tools ?? []).filter((t): t is string => typeof t === "string");
  }

  static async create(options: MosaicAgentOptions): Promise<MosaicAgent> {
    if (typeof options.onConsent !== "function") throw new Error("MosaicAgent needs an onConsent hook.");
    const rt = await loadRuntime(options.runtimeUrl);
    const Engine = makeMosaicEngineClass(rt.Engine);
    const originUrl = options.originUrl ?? location.origin;
    const engine = new Engine(engineOptions(options.setup, originUrl));
    engine.onConsent = options.onConsent;
    // Binding happens only through connectNetwork: the runtime's own link path accepts a wrong
    // network name when a site publishes one network (engine.js _normalizeLinkTarget).
    engine.onLinkRequired = async () => null;
    const { validation } = await engine.loadTop();
    if (validation.errors.length) throw new Error(`Mosaic's network failed validation: ${validation.errors.join("; ")}`);
    const agent = new MosaicAgent(engine, options);
    agent.prune();
    return agent;
  }

  /** A new agent on another model setup, with the same runtime-connected networks. */
  async rebuild(setup: ModelSetup): Promise<MosaicAgent> {
    const next = await MosaicAgent.create({ ...this.options, setup });
    for (const bound of this.connected) {
      next.network.setLink(bound.slot, bound.url);
      next.engine.runtimeAllowedPeers.add(bound.origin);
      next.connected.push(bound);
    }
    next.prune();
    return next;
  }

  private get network(): RuntimeNetwork {
    return this.engine.top!.network;
  }

  private frontSpec() {
    const net = this.engine.top?.network;
    return net ? net.getAgentSpec(net.findFrontMan()) : null;
  }

  /** The front agent's tools as the model will see them. */
  frontTools(): string[] {
    return (this.frontSpec()?.tools ?? []).filter((t): t is string => typeof t === "string");
  }

  /** Drops unbound link slots from the front agent (the runtime would offer them). */
  private prune() {
    const spec = this.frontSpec();
    if (!spec) return;
    const net = this.network;
    spec.tools = this.frontToolsAll.filter((ref) => ref === COMPOSER_AGENT || !net.linkSlots.has(ref) || !!net.getLink(ref));
  }

  /** The runtime's trace as typed events. Returns the unsubscribe function. */
  subscribe(listener: (ev: TraceEvent) => void): () => void {
    const handler = (e: Event) => listener((e as CustomEvent<TraceEvent>).detail);
    this.engine.trace.addEventListener("event", handler);
    return () => this.engine.trace.removeEventListener("event", handler);
  }

  /**
   * Connects a site's network by its URL, `<origin>/<network name>`. Order: consent (before any
   * fetch) → bind a slot (the site's own suggested slot, else a spare) → allow the origin → resolve
   * the exact name, which fails closed with "No published network named …". Undone on failure.
   */
  async connectNetwork(rawUrl: string, opts: { consented?: boolean } = {}): Promise<BoundNetwork> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      throw new Error("Enter a full site URL, like https://pagewright.example/pagewright.");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("A site URL must start with http:// or https://.");
    const name = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    if (!name || parsed.pathname.endsWith("/")) throw new Error(`Add the network name to the URL, like ${parsed.origin}/pagewright.`);
    const origin = new URL("./", parsed).href.replace(/\/$/, "");
    const url = `${origin}/${name}`;
    const net = this.network;

    const existing = Object.entries(net.links).find(([, target]) => target === url);
    if (existing) return this.connected.find((b) => b.url === url) ?? { slot: existing[0], network: name, origin, url };

    // `consented`: the caller already asked, before its own first fetch (the connect palette does).
    const decision = opts.consented ? "allow" : await this.engine.requestConsent({ kind: "connect", peerOrigin: parsed.host, peerLabel: name, requestText: `Connect ${name} at ${parsed.host}` });
    if (decision === "decline") throw new Error(`You declined to connect ${parsed.host}. Nothing was sent to it.`);

    const free = (ref: string) => net.linkSlots.has(ref) && !net.getLink(ref);
    const slot = free(name) ? name : SPARE_SLOTS.find(free);
    if (!slot) throw new Error(`All ${SPARE_SLOTS.length} spare slots are in use. Reload Mosaic to connect another site.`);

    const addedPeer = !this.engine.runtimeAllowedPeers.has(origin);
    net.setLink(slot, url);
    this.engine.runtimeAllowedPeers.add(origin);
    try {
      const session = await this.engine.resolveRemote(url, [], null);
      const bound = { slot, network: session.network.name, origin, url };
      this.connected.push(bound);
      this.engine.trace.note("mosaic_link", { slot, network: bound.network, peerOrigin: parsed.host });
      return bound;
    } catch (err) {
      delete net.links[slot];
      if (addedPeer) this.engine.runtimeAllowedPeers.delete(origin);
      throw err;
    } finally {
      this.prune();
    }
  }

  /**
   * Runs one turn and streams its public events. In manual mode it throws before anything is sent:
   * Mosaic's keyless runbook (entry/plan.ts) plans the steps instead.
   */
  runTurn(text: string, slyData: Record<string, unknown> = {}): AsyncIterable<TurnEvent> {
    if (this.mode === "manual") throw new Error(NO_KEY_MESSAGE);
    return this.engine.streamTurn(text, { slyData });
  }
}
