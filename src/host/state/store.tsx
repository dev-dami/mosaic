// The one workspace store: state, typed actions, and the async operations (connect, run, publish)
// that talk to sites through Mosaic's agent runtime. Owner: foundation (shared).
//
// Components read with `useMosaic()` and change things only through `actions`. The security
// model lives below this layer and is not changed here: a site is connected only by its exact
// published network name after the person consents (MosaicAgent.connectNetwork), its actions run
// through the site's own action bridge (vendor/nsdeploy-runtime), and every write opens in a
// window on the site's origin, where the site's own sheet asks the person. Mosaic never approves.
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { FormError } from "../../form";
import { outcomeOf, pickNetwork, siteFromEntries, connectTarget, type PublishedManifest, type Site } from "../agentic/catalog";
import type { MosaicAgent } from "../agentic/engine";
import { hostOf, type Binding, type CapKey, type CapRef, capKey } from "../doc";
import { useAgentEngine } from "../settings";
import { deriveModel, type Model } from "./model";
import { initialState, reducer } from "./reducer";
import type { Action, HostInfo, Receipt, State } from "./types";

/** How long a site's own sheet stays up after its result, so "Done" or "Denied" is seen. */
export const SHEET_LINGER_MS = 750;
/** How long a newly connected site counts as fresh. */
export const FRESH_MS = 2600;
/** The runtime module whose setActionWindowPrompt Mosaic owns. A variable, so the bundler leaves it to the browser. */
const ACTION_TRANSPORT_URL = "/runtime/action-transport.js";
const NOT_STARTED = "Action window cancelled; action not started.";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pace = (ms = 260) => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));

export type Actions = {
  /**
   * Connect a site by URL: a bare origin (its one published network, or a choice), or
   * `<origin>/<network>` (that exact network, fail closed). Reports progress through `state.trace`
   * and problems through `state.connectError`. Resolves true once the site is added.
   */
  connect: (raw: string) => Promise<boolean>;
  disconnect: (origin: string) => void;
  /** Run one capability with its current inputs. Writes open the site's own approval window. Resolves true on success. */
  run: (r: CapRef) => Promise<boolean>;
  /** Walk the pending writes in step order, one approval window at a time; stops at the first that is not approved. */
  sendAll: () => Promise<void>;
  /** Open the waiting site's approval window. Call it inside the person's click (browsers block it otherwise). */
  openApproval: () => void;
  /** Close the "Open <site>" ask without opening it: nothing is sent. */
  cancelApproval: () => void;
  setTitle: (title: string) => void;
  setProp: (key: "project" | "version", value: string) => void;
  setValue: (cap: CapKey, field: string, value: string | boolean) => void;
  /** Link a field to a source, or pass null to type it by hand. */
  setBinding: (cap: CapKey, field: string, binding: Binding | null) => void;
  setHot: (cap: CapKey | null) => void;
  /** Pick a site's hue. Snapped into the safe bands, so it never reads as a status colour. */
  setHue: (origin: string, hue: number) => void;
};

type Store = {
  getState: () => State;
  dispatch: (a: Action) => void;
  subscribe: (l: () => void) => () => void;
  actions: Actions;
  setAgent: (agent: MosaicAgent | null, error: string | null) => void;
};

function createStore(): Store {
  let state = initialState;
  const listeners = new Set<() => void>();
  const dispatch = (a: Action) => {
    state = reducer(state, a);
    listeners.forEach((l) => l());
  };
  const getState = () => state;
  let nextKey = 1;
  let receiptId = 1;
  let firstBuild: string | null = null;

  // The agent comes from <AgentEngineProvider> (settings/), rebuilt when the model setup changes.
  let agent: MosaicAgent | null = null;
  let agentError: string | null = null;
  let agentWaiters: { resolve: (a: MosaicAgent) => void; reject: (e: Error) => void }[] = [];
  const setAgent = (next: MosaicAgent | null, error: string | null) => {
    agent = next;
    agentError = error;
    if (next) agentWaiters.forEach((w) => w.resolve(next));
    else if (error) agentWaiters.forEach((w) => w.reject(new Error(error)));
    if (next || error) agentWaiters = [];
  };
  const agentReady = (): Promise<MosaicAgent> => {
    if (agent) return Promise.resolve(agent);
    if (agentError) return Promise.reject(new Error(agentError));
    return new Promise((resolve, reject) => {
      agentWaiters.push({ resolve, reject });
      setTimeout(() => reject(new Error("Mosaic's agent runtime did not start.")), 15_000);
    });
  };

  void fetch("/mosaic-host.json")
    .then((r) => r.json())
    .then(
      (info: HostInfo) => {
        firstBuild = info.build;
        dispatch({ type: "host/loaded", info });
      },
      () => dispatch({ type: "host/loaded", info: { build: "unknown", suggestions: [] } }),
    );

  // A write's window must open in the person's click. The runtime asks through this prompt; the
  // review layer shows "Open <site> to approve" and calls openApproval inside the click.
  let pendingWindow: { url: string; origin: string; resolve: (w: Window) => void; reject: (e: Error) => void } | null = null;
  if (typeof window !== "undefined") {
    void import(/* @vite-ignore */ ACTION_TRANSPORT_URL)
      .then((mod: { setActionWindowPrompt: (fn: unknown) => void }) =>
        mod.setActionWindowPrompt(
          ({ url, origin, signal }: { url: string; origin: string; signal?: AbortSignal }) =>
            new Promise<Window>((resolve, reject) => {
              if (signal?.aborted) return reject(new Error(NOT_STARTED));
              pendingWindow?.reject(new Error(NOT_STARTED));
              pendingWindow = { url, origin, resolve, reject };
              dispatch({ type: "approval/ask", origin });
              signal?.addEventListener(
                "abort",
                () => {
                  if (pendingWindow?.url !== url) return;
                  pendingWindow = null;
                  dispatch({ type: "approval/ask", origin: null });
                  reject(new Error(NOT_STARTED));
                },
                { once: true },
              );
            }),
        ),
      )
      .catch(() => {});
  }

  function record(r: CapRef, write: boolean, outcome: Receipt["outcome"], detail: string, requestId?: string) {
    dispatch({ type: "receipt/added", receipt: { id: receiptId++, at: new Date(), origin: r.origin, siteName: r.siteName, title: r.cap.title, write, outcome, detail, requestId } });
  }

  const connFor = (origin: string) => getState().conns.find((c) => c.site.site.origin === origin);

  /** The registry entry for a capability. After a model change the agent is new: resolve its network again. */
  async function entryFor(a: MosaicAgent, site: Site, id: string) {
    const ref = site.refs[id];
    if (!ref) return undefined;
    if (!a.engine.actions.entries.has(ref)) await a.engine.resolveRemote(site.url, [], null);
    return a.engine.actions.entries.get(ref);
  }

  function checkBuild(origin: string) {
    // Check Mosaic's own source fingerprint again: connecting a site must not need a Mosaic change.
    fetch("/mosaic-host.json")
      .then((r) => r.json())
      .then((now: HostInfo) => dispatch({ type: "site/build-checked", origin, build: now.build, same: firstBuild === now.build }))
      .catch(() => {});
  }

  function runContextReads(site: Site) {
    // Reads that need no input run at once, as context for the step.
    for (const cap of site.capabilities) {
      if (cap.side_effects !== "read" || Object.keys(cap.input_schema.properties ?? {}).length > 0) continue;
      void execute(site, capKey(site.site.origin, cap.id), cap.id, "read", {}, false);
    }
  }

  type Done = { ok: true; output: unknown; requestId?: string } | { ok: false; outcome: Exclude<Receipt["outcome"], "done">; message: string; requestId?: string };

  /** One action through the registry. A write opens the site's window (see the prompt above). */
  async function execute(site: Site, key: CapKey, id: string, effect: "read" | "write", input: unknown, pulse: boolean): Promise<Done> {
    dispatch({ type: "run/started", cap: key });
    let done: Done;
    try {
      const a = await agentReady();
      const entry = await entryFor(a, site, id);
      if (!entry) throw new Error(`${site.site.name} no longer offers ${id}.`);
      const receipts = await a.engine.actions.execute([{ entry, args: input }], async () => true, crypto.randomUUID());
      const o = outcomeOf(receipts?.[0] ?? { action: entry.ref, status: "not_started" }, effect);
      done =
        o.kind === "done"
          ? { ok: true, output: o.output, requestId: o.requestId }
          : o.kind === "denied"
            ? { ok: false, outcome: "denied", message: `Denied on ${site.site.name}. Nothing changed.`, requestId: o.requestId }
            : { ok: false, outcome: o.kind, message: o.message, requestId: o.requestId };
    } catch (e) {
      // Nothing reached the registry (no agent, or the network could not be resolved again).
      done = { ok: false, outcome: "not_started", message: e instanceof Error ? e.message : String(e) };
    } finally {
      pendingWindow = null;
      if (getState().asking) dispatch({ type: "approval/ask", origin: null });
      if (getState().confirming) dispatch({ type: "approval/sheet", origin: null });
    }
    if (done.ok) dispatch({ type: "run/done", cap: key, output: done.output, at: new Date(), pulse });
    else
      dispatch({
        type: "run/failed",
        cap: key,
        message: done.message,
        denied: done.outcome === "denied",
        unknown: done.outcome === "unknown",
        notStarted: done.outcome === "not_started",
        at: new Date(),
      });
    return done;
  }

  async function run(r: CapRef): Promise<boolean> {
    const last = getState().runs[r.key];
    // The site may already have done it: never send it again from here.
    if (r.cap.side_effects === "write" && last?.status === "error" && last.unknown) return false;
    let input: unknown;
    try {
      input = deriveModel(getState()).inputFor(r);
    } catch (e) {
      if (e instanceof FormError) {
        dispatch({ type: "run/failed", cap: r.key, message: e.message, denied: false, at: new Date() });
        return false;
      }
      throw e;
    }
    const conn = connFor(r.origin);
    if (!conn) return false;
    const write = r.cap.side_effects === "write";
    const done = await execute(conn.site, r.key, r.cap.id, write ? "write" : "read", input, true);
    const host = hostOf(r.origin);
    if (done.ok) record(r, write, "done", write ? `approved on ${host}` : "read", done.requestId);
    else {
      const detail =
        done.outcome === "denied"
          ? `denied on ${host}, nothing changed`
          : done.outcome === "unknown"
            ? `Outcome unknown, check ${r.siteName}`
            : done.outcome === "not_started"
              ? `not started, nothing was sent to ${host}`
              : done.message;
      record(r, write, done.outcome, detail, done.requestId);
    }
    return done.ok;
  }

  const fail = (origin: string, message: string) => {
    dispatch({ type: "connect/failed", origin, message });
    return false;
  };

  const actions: Actions = {
    async connect(raw) {
      const target = connectTarget(raw);
      if (!target) {
        dispatch({ type: "connect/rejected", message: "Enter a site URL, for example http://localhost:4101" });
        return false;
      }
      const { origin } = target;
      const host = hostOf(origin);
      const existing = connFor(origin);
      if (existing && existing.status !== "failed") {
        dispatch({ type: "connect/rejected", message: `${host} is already connected` });
        return false;
      }
      dispatch({ type: "connect/started", origin, network: target.network });
      let a: MosaicAgent;
      try {
        a = await agentReady();
      } catch (e) {
        return fail(origin, e instanceof Error ? e.message : String(e));
      }
      // 1. Consent, before any request to the site.
      const decision = await a.engine.requestConsent({
        kind: "connect",
        peerOrigin: host,
        peerLabel: target.network ?? host,
        requestText: `Connect ${target.network ?? "the agent network"} at ${host}`,
      });
      if (decision === "decline") return fail(origin, `You declined to connect ${host}. Nothing was sent to it.`);
      // 2. The site's public manifest.
      dispatch({ type: "connect/stage", origin, stage: "manifest" });
      let manifest: PublishedManifest;
      try {
        const res = await fetch(`${origin}/agent-manifest.json`, { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${host}/agent-manifest.json`);
        manifest = (await res.json()) as PublishedManifest;
        if (!manifest || !Array.isArray(manifest.networks)) throw new Error(`${host}/agent-manifest.json lists no networks`);
      } catch (e) {
        return fail(origin, e instanceof Error ? e.message : String(e));
      }
      await pace();
      // 3. The exact network: the one named, else the only one, else ask.
      dispatch({ type: "connect/stage", origin, stage: "network", patch: { siteName: manifest.brand || undefined } });
      let network: string;
      try {
        const pick = pickNetwork(manifest, target.network, host);
        if ("choices" in pick) {
          dispatch({ type: "connect/choose", origin, choices: pick.choices });
          return false;
        }
        network = pick.name;
      } catch (e) {
        return fail(origin, e instanceof Error ? e.message : String(e));
      }
      await pace(180);
      // 4. The runtime fetches and compiles that network, by its exact name, and 5. lists its bridge actions.
      dispatch({ type: "connect/stage", origin, stage: "validate", patch: { network } });
      try {
        await a.connectNetwork(`${origin}/${network}`, { consented: true });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/action (bridge|catalog|protocol)|actions? (is|are) not exposed|callerOrigins/i.test(message)) dispatch({ type: "connect/stage", origin, stage: "bridge" });
        return fail(origin, message);
      }
      dispatch({ type: "connect/stage", origin, stage: "bridge" });
      const site = siteFromEntries(a.engine.actions.entries.values(), { origin, network, manifest });
      if (!site.capabilities.length) return fail(origin, `${site.site.name}'s action bridge lists no actions for ${location.host}. Nothing was run.`);
      dispatch({
        type: "connect/stage",
        origin,
        stage: "bridge",
        patch: { siteName: site.site.name, capabilities: site.capabilities.length, writes: site.capabilities.filter((c) => c.side_effects === "write").length },
      });
      await pace(180);
      dispatch({ type: "site/added", site, key: nextKey++ });
      dispatch({ type: "site/bridge", origin, status: "ready" });
      setTimeout(() => dispatch({ type: "site/settled", origin }), FRESH_MS);
      checkBuild(origin);
      runContextReads(site);
      return true;
    },
    disconnect(origin) {
      dispatch({ type: "site/removed", origin });
    },
    run,
    async sendAll() {
      dispatch({ type: "publish/sending", sending: true });
      try {
        for (const w of deriveModel(getState()).writes) {
          const last = getState().runs[w.key];
          if (last?.status === "done") continue;
          if (last?.status === "error" && last.unknown) break;
          if (!(await run(w))) break;
        }
      } finally {
        dispatch({ type: "publish/sending", sending: false });
      }
    },
    openApproval() {
      const p = pendingWindow;
      if (!p) return;
      const popup = window.open(p.url, "_blank", "popup,width=700,height=650");
      if (!popup) return;
      pendingWindow = null;
      dispatch({ type: "approval/sheet", origin: p.origin });
      p.resolve(popup);
    },
    cancelApproval() {
      const p = pendingWindow;
      pendingWindow = null;
      dispatch({ type: "approval/ask", origin: null });
      p?.reject(new Error(NOT_STARTED));
    },
    setTitle: (title) => dispatch({ type: "doc/title", title }),
    setProp: (key, value) => dispatch({ type: "doc/prop", key, value }),
    setValue: (cap, field, value) => dispatch({ type: "input/value", cap, field, value }),
    setBinding: (cap, field, binding) => dispatch({ type: "input/binding", cap, field, binding, at: Date.now() }),
    setHot: (cap) => {
      if (getState().hot !== cap) dispatch({ type: "ui/hot", cap });
    },
    setHue: (origin, hue) => dispatch({ type: "site/hue", origin, hue: Math.round(hue) % 360 }),
  };

  return {
    getState,
    dispatch,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    actions,
    setAgent,
  };
}

const StoreContext = createContext<Store | null>(null);

export function MosaicProvider({ children }: { children: ReactNode }) {
  const store = useRef<Store | null>(null);
  store.current ??= createStore();
  return <StoreContext.Provider value={store.current}>{children}</StoreContext.Provider>;
}

/** Hands the agent from <AgentEngineProvider> to the store. Mount it inside both providers. */
export function AgentLink() {
  const store = useContext(StoreContext);
  const { agent, error, status } = useAgentEngine();
  useEffect(() => {
    store?.setAgent(agent, status === "error" ? error : null);
  }, [store, agent, error, status]);
  return null;
}

const modelCache = new WeakMap<State, Model>();
function modelOf(state: State): Model {
  let m = modelCache.get(state);
  if (!m) modelCache.set(state, (m = deriveModel(state)));
  return m;
}

/** Read the workspace: raw state, the derived document model, and the actions that change it. */
export function useMosaic(): { state: State; model: Model; actions: Actions } {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useMosaic must be used inside <MosaicProvider>");
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return useMemo(() => ({ state, model: modelOf(state), actions: store.actions }), [state, store]);
}

