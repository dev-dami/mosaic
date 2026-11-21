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
import { connectTarget, outcomeOf, pickNetwork, siteFromEntries, type ActionReceipt, type PublishedManifest, type Site } from "../agentic/catalog";
import type { ActionRun, MosaicAgent, TurnStream } from "../agentic/engine";
import type { TurnInteraction } from "../agentic/turn";
import { hostOf, type Binding, type CapKey, type CapRef, capKey } from "../doc";
import { useAgentEngine } from "../settings";
import { deriveModel, inputKeys, type Model } from "./model";
import { initialState, reducer } from "./reducer";
import type { Action, HostInfo, Receipt, State } from "./types";

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
  /**
   * Model mode: run the outcome as one turn of Mosaic's own agent network, in this browser, across
   * the connected sites' networks (MosaicAgent.runTurn). Progress lands in `state.turn`. Writes the
   * turn proposes still open the site's own approval window. Manual mode does nothing: the
   * keyword plan (entry/plan.ts) is the runbook.
   */
  runOutcome: () => Promise<void>;
  /**
   * Send the person's message to Mosaic's agent. While a turn runs, it joins that turn (the runtime
   * reads it before the next model step). Otherwise it starts a follow-up turn of the same
   * conversation. `interaction` is a widget answer (CRUSE) and goes with the message.
   * Returns false when nothing was sent (no model, a write in flight, or the turn just closed).
   */
  sendMessage: (text: string, interaction?: TurnInteraction) => boolean;
  /** Stop the running turn: no further step starts, and no write window opens. */
  stopTurn: () => void;
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
  // A streamed answer dispatches a turn event per token. Rendering each one inside one task passed
  // React's nested-update limit ("Maximum update depth exceeded" mid-turn), so turn events reach
  // React once per task. Every other action renders at once: controlled inputs need that.
  let pending: ReturnType<typeof setTimeout> | null = null;
  const notify = () => {
    if (pending) clearTimeout(pending);
    pending = null;
    listeners.forEach((l) => l());
  };
  const dispatch = (a: Action) => {
    state = reducer(state, a);
    if (a.type === "turn/event" || a.type === "turn/trace") pending ??= setTimeout(notify, 0);
    else notify();
  };
  const getState = () => state;
  let nextKey = 1;
  let receiptId = 1;
  let firstBuild: string | null = null;

  // The agent comes from <AgentEngineProvider> (settings/), rebuilt when the model setup changes.
  let agent: MosaicAgent | null = null;
  let agentError: string | null = null;
  let agentWaiters: { resolve: (a: MosaicAgent) => void; reject: (e: Error) => void }[] = [];
  let unwatch: (() => void) | null = null;
  const setAgent = (next: MosaicAgent | null, error: string | null) => {
    if (next !== agent) {
      unwatch?.();
      unwatch = next ? next.watchActions({ start: agentActionStarted, end: agentActionEnded }) : null;
    }
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
  /** The one write in flight (writes run one at a time), and whether its site's window was opened. */
  type WriteRun = { key: CapKey; opened: boolean; agent?: boolean };
  let currentWrite: WriteRun | null = null as WriteRun | null;
  let pendingWindow: { url: string; origin: string; owner: WriteRun | null; resolve: (w: Window) => void; reject: (e: Error) => void } | null = null;
  if (typeof window !== "undefined") {
    void import(/* @vite-ignore */ ACTION_TRANSPORT_URL)
      .then((mod: { setActionWindowPrompt: (fn: unknown) => void }) =>
        mod.setActionWindowPrompt(
          ({ url, origin, signal }: { url: string; origin: string; signal?: AbortSignal }) =>
            new Promise<Window>((resolve, reject) => {
              if (signal?.aborted) return reject(new Error(NOT_STARTED));
              // A stopped turn opens no window: a step that was already in flight cannot write.
              if (liveTurn?.stopped) return reject(new Error(NOT_STARTED));
              pendingWindow?.reject(new Error(NOT_STARTED));
              pendingWindow = { url, origin, owner: currentWrite, resolve, reject };
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

  // ---- Agent turns (model mode) -----------------------------------------------------------------
  /** Invocations the store started itself (run, context reads); the rest are the model's. */
  const ownInvocations = new Set<string>();
  /**
   * The runtime turn, from the person's Enter until the runtime settles it. After Stop it stays
   * here, `stopped`, while the runtime drains: no new turn, no manual write and no write window
   * until it has settled. `agent` is the agent that runs it (a model change builds a new one).
   */
  let liveTurn: { agent: MosaicAgent | null; stopped: boolean; stream: TurnStream | null } | null = null;

  const connForBase = (base: string) => connFor(base.replace(/\/+$/, ""));

  /** The model called a website_* action: its card in the runbook or the dock shows it running. */
  function agentActionStarted(run: ActionRun) {
    if (ownInvocations.has(run.invocationId)) return;
    for (const entry of run.entries) {
      const conn = connForBase(entry.base);
      const key = conn ? capKey(conn.site.site.origin, entry.name) : `${entry.base}#${entry.name}`;
      // The agent's write is the one write in flight (the registry runs its writes one at a time).
      if (entry.effect !== "read" && !currentWrite) {
        currentWrite = { key, opened: false, agent: true };
        if (conn) dispatch({ type: "write/active", cap: key });
      }
      if (conn) dispatch({ type: "run/started", cap: key });
    }
  }

  /** Its answer: the card shows the full output (or Published / Denied), and the ledger keeps the receipt. */
  function agentActionEnded(run: ActionRun, receipts: ActionReceipt[] | null) {
    if (ownInvocations.has(run.invocationId)) return;
    const mine = currentWrite?.agent ? currentWrite : null;
    run.entries.forEach((entry, i) => {
      const write = entry.effect !== "read";
      const conn = connForBase(entry.base);
      const cap = conn?.site.capabilities.find((c) => c.id === entry.name);
      if (!conn || !cap) return;
      const site = conn.site;
      const key = capKey(site.site.origin, entry.name);
      let o = outcomeOf(receipts?.[i] ?? { action: entry.ref, status: "not_started" }, write ? "write" : "read");
      // A write whose window was never opened cannot have reached the site (as for manual writes).
      if (write && mine && !mine.opened && o.kind === "unknown") o = { kind: "not_started", message: `The approval window was never opened, so nothing was sent to ${site.site.name}.`, requestId: o.requestId };
      const ref: CapRef = { key, origin: site.site.origin, siteName: site.site.name, cap, order: 0 };
      const host = hostOf(site.site.origin);
      if (o.kind === "done") {
        dispatch({ type: "run/done", cap: key, output: o.output, at: new Date(), pulse: true });
        record(ref, write, "done", write ? `approved on ${host}` : "read", o.requestId);
      } else {
        const message = o.kind === "denied" ? `Denied on ${site.site.name}. Nothing changed.` : o.message;
        dispatch({ type: "run/failed", cap: key, message, denied: o.kind === "denied", unknown: o.kind === "unknown", notStarted: o.kind === "not_started", at: new Date() });
        const detail = o.kind === "denied" ? `denied on ${host}, nothing changed` : o.kind === "unknown" ? `Outcome unknown, check ${site.site.name}` : o.kind === "not_started" ? `not started, nothing was sent to ${host}` : o.message;
        record(ref, write, o.kind, detail, o.requestId);
      }
    });
    if (mine && run.entries.some((e) => e.effect !== "read")) {
      if (pendingWindow?.owner === mine) pendingWindow = null;
      currentWrite = null;
      if (getState().asking) dispatch({ type: "approval/ask", origin: null });
      if (getState().confirming) dispatch({ type: "approval/sheet", origin: null });
      dispatch({ type: "write/active", cap: null });
    }
  }

  function runOutcome() {
    return startTurn(getState().title.trim(), false);
  }

  function sendMessage(text: string, interaction?: TurnInteraction): boolean {
    const message = text.trim();
    if (!message) return false;
    const live = liveTurn;
    if (live) {
      // Widget answers belong to a finished turn; typed text steers the running one.
      if (interaction || live.stopped || !live.stream?.steer?.(message)) return false;
      dispatch({ type: "turn/steered", text: message });
      return true;
    }
    if (currentWrite || !getState().turn) return false;
    void startTurn(message, true, interaction);
    return true;
  }

  /** One agent turn. A new outcome (followUp false) starts a new conversation. */
  async function startTurn(outcome: string, followUp: boolean, interaction?: TurnInteraction) {
    const st = getState();
    // One turn at a time, and not while a write (manual or the agent's) is in flight.
    if (!outcome || liveTurn || currentWrite) return;
    const live: { agent: MosaicAgent | null; stopped: boolean; stream: TurnStream | null } = { agent: null, stopped: false, stream: null };
    liveTurn = live; // before the first await: a double Enter starts one turn
    let started = false;
    try {
      let a: MosaicAgent;
      try {
        a = await agentReady();
      } catch (e) {
        dispatch({ type: "turn/started", outcome, followUp, interaction });
        dispatch({ type: "turn/failed", message: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (a.mode !== "model" || live.stopped) return;
      live.agent = a;
      if (!followUp) a.resetConversation();
      const { project, version } = deriveModel(st).docProps;
      const slyData: Record<string, string> = {};
      if (project) slyData.project = project;
      if (version) slyData.version = version;
      dispatch({ type: "turn/started", outcome, followUp, interaction });
      started = true;
      // Stream chunks come through the stream's own events; the trace gives the spans.
      const off = a.subscribe((event) => {
        if (!live.stopped && event.phase !== "update") dispatch({ type: "turn/trace", event });
      });
      try {
        live.stream = a.runTurn(outcome, slyData, interaction);
        // After Stop, keep draining the stream (without showing it) until the runtime settles.
        for await (const event of live.stream) {
          if (!live.stopped) dispatch({ type: "turn/event", event });
        }
      } catch (e) {
        if (!live.stopped) dispatch({ type: "turn/failed", message: e instanceof Error ? e.message : String(e) });
      } finally {
        off();
      }
    } finally {
      if (liveTurn === live) liveTurn = null;
      if (started) dispatch({ type: "turn/settled" });
    }
  }

  function stopTurn() {
    const live = liveTurn;
    if (!live || live.stopped) return;
    live.stopped = true;
    live.agent?.stopTurn();
    // A write window the turn asked for, not yet opened, is refused: nothing is sent.
    if (pendingWindow && (!pendingWindow.owner || pendingWindow.owner.agent)) {
      const p = pendingWindow;
      pendingWindow = null;
      dispatch({ type: "approval/ask", origin: null });
      p.reject(new Error(NOT_STARTED));
    }
    dispatch({ type: "turn/stopped" });
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
    // Set before the first await, so a second write in the same tick is refused (see run).
    const mine = effect === "write" ? (currentWrite = { key, opened: false }) : null;
    if (mine) dispatch({ type: "write/active", cap: key });
    dispatch({ type: "run/started", cap: key });
    let done: Done;
    try {
      const a = await agentReady();
      const entry = await entryFor(a, site, id);
      if (!entry) throw new Error(`${site.site.name} no longer offers ${id}.`);
      const invocation = crypto.randomUUID();
      ownInvocations.add(invocation);
      const receipts = await a.engine.actions.execute([{ entry, args: input }], async () => true, invocation).finally(() => ownInvocations.delete(invocation));
      let o = outcomeOf(receipts?.[0] ?? { action: entry.ref, status: "not_started" }, effect);
      // A write whose window was never opened cannot have reached the site.
      if (mine && !mine.opened && o.kind === "unknown") o = { kind: "not_started", message: `The approval window was never opened, so nothing was sent to ${site.site.name}.`, requestId: o.requestId };
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
      // Only this write's own window is closed; a read finishing meanwhile leaves it alone.
      if (mine) {
        if (pendingWindow?.owner === mine) pendingWindow = null;
        if (currentWrite === mine) {
          currentWrite = null;
          if (getState().asking) dispatch({ type: "approval/ask", origin: null });
          if (getState().confirming) dispatch({ type: "approval/sheet", origin: null });
          dispatch({ type: "write/active", cap: null });
        }
      }
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
    // One write at a time: its window, its sheet and its answer belong to it alone.
    if (r.cap.side_effects === "write" && currentWrite) return false;
    // While an agent turn runs, its own writes come first.
    if (r.cap.side_effects === "write" && liveTurn) return false;
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

  /** Origins the person allowed in a connect that stopped at "pick a network". */
  const choiceConsent = new Set<string>();

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
      if (existing) {
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
      // 1. Consent, before any request to the site. Picking one of its networks right after the
      //    person allowed it (connect/choose) does not ask again.
      const decision = choiceConsent.delete(origin) ? "allow" : await a.engine.requestConsent({
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
        // No redirects: a manifest served from another origin is not this site's.
        const res = await fetch(`${origin}/agent-manifest.json`, { credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
        if (new URL(res.url).origin !== origin) throw new Error(`${host}/agent-manifest.json came from another origin`);
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
          choiceConsent.add(origin);
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
        // A network the host already links returns at once from connectNetwork; resolving it (cached
        // when connectNetwork just did) registers its bridge actions in the registry.
        await a.engine.resolveRemote(`${origin}/${network}`, [], null);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/action (bridge|catalog|protocol)|actions? (is|are) not exposed|callerOrigins/i.test(message)) dispatch({ type: "connect/stage", origin, stage: "bridge" });
        return fail(origin, message);
      }
      dispatch({ type: "connect/stage", origin, stage: "bridge" });
      const site = siteFromEntries(a.engine.actions.entries.values(), { origin, network, manifest });
      if (!site.capabilities.length) return fail(origin, `${site.site.name}'s action bridge lists no capabilities for ${location.host}. Nothing was run.`);
      dispatch({
        type: "connect/stage",
        origin,
        stage: "bridge",
        patch: { siteName: site.site.name, capabilities: site.capabilities.length, writes: site.capabilities.filter((c) => c.side_effects === "write").length },
      });
      await pace(180);
      dispatch({ type: "site/added", site, key: nextKey++ });
      dispatch({ type: "site/ready", origin });
      setTimeout(() => dispatch({ type: "site/settled", origin }), FRESH_MS);
      checkBuild(origin);
      runContextReads(site);
      return true;
    },
    disconnect(origin) {
      // Unlink in the agent too: it can no longer reach the site, and its slot frees up.
      const conn = connFor(origin);
      if (conn) agent?.disconnectNetwork(conn.site.url);
      dispatch({ type: "site/removed", origin });
    },
    run,
    async sendAll() {
      dispatch({ type: "publish/sending", sending: true });
      try {
        const model = deriveModel(getState());
        const isUnknown = (key: CapKey) => {
          const r = getState().runs[key];
          return r?.status === "error" && !!r.unknown;
        };
        for (const w of model.writes) {
          if (getState().runs[w.key]?.status === "done") continue;
          // Skip a write with an unknown outcome, and any write that takes a value from one.
          if (isUnknown(w.key)) continue;
          if (inputKeys(w).some((f) => { const b = model.bindingFor(w.key, f); return !!b && b.kind !== "prop" && isUnknown(b.cap); })) continue;
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
      if (!popup) {
        dispatch({ type: "approval/blocked" });
        return;
      }
      if (p.owner) p.owner.opened = true;
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
    runOutcome,
    sendMessage,
    stopTurn,
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

