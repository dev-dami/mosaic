// The one workspace store: state, typed actions, and the async operations (connect, run, publish)
// that talk to sites through the bridge. Owner: foundation (shared).
//
// Components read with `useMosaic()` and change things only through `actions`. The security
// model lives below this layer and is not changed here: BridgeClient accepts messages only from
// the site's iframe window and origin, and every write waits for the site's own approval sheet.
import { createContext, useContext, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { FormError } from "../../form";
import { discoverSite, type Site } from "../../protocol";
import { BridgeCallError, BridgeClient } from "../bridge-client";
import { capKey, hostOf, type Binding, type CapKey, type CapRef } from "../doc";
import { deriveModel, type Model } from "./model";
import { initialState, reducer } from "./reducer";
import type { Action, HostInfo, Receipt, State } from "./types";

/** How long a site's own sheet stays up after its result, so "Done" or "Denied" is seen. */
export const SHEET_LINGER_MS = 750;
/** How long a newly connected site counts as fresh. */
export const FRESH_MS = 2600;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pace = (ms = 260) => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));

export type Actions = {
  /**
   * Connect a site by URL (or bare host). Reports progress through `state.trace` and problems through
   * `state.connectError`. Resolves true once the site is added (its bridge may still be starting).
   */
  connect: (raw: string) => Promise<boolean>;
  disconnect: (origin: string) => void;
  /** Run one capability with its current inputs. Writes open the site's own approval sheet. Resolves true on success. */
  run: (r: CapRef) => Promise<boolean>;
  /** Walk the pending writes in step order, one approval sheet at a time; stops at the first that is not approved. */
  sendAll: () => Promise<void>;
  setTitle: (title: string) => void;
  setProp: (key: "project" | "version", value: string) => void;
  setValue: (cap: CapKey, field: string, value: string | boolean) => void;
  /** Link a field to a source, or pass null to type it by hand. */
  setBinding: (cap: CapKey, field: string, binding: Binding | null) => void;
  setHot: (cap: CapKey | null) => void;
  /** Pick a site's hue. Snapped into the safe bands, so it never reads as a status colour. */
  setHue: (origin: string, hue: number) => void;
  /**
   * Start the bridge for a site in the given iframe (rendered by the review area's approval layer).
   * Returns the cleanup to call when the iframe goes away.
   */
  attachBridge: (site: Site, frame: HTMLIFrameElement) => () => void;
};

type Store = {
  getState: () => State;
  dispatch: (a: Action) => void;
  subscribe: (l: () => void) => () => void;
  actions: Actions;
};

function createStore(): Store {
  let state = initialState;
  const listeners = new Set<() => void>();
  const dispatch = (a: Action) => {
    state = reducer(state, a);
    listeners.forEach((l) => l());
  };
  const getState = () => state;
  const clients = new Map<string, BridgeClient>();
  let nextKey = 1;
  let receiptId = 1;
  let firstBuild: string | null = null;
  let lingerTimer: ReturnType<typeof setTimeout> | undefined;

  void fetch("/mosaic-host.json")
    .then((r) => r.json())
    .then(
      (info: HostInfo) => {
        firstBuild = info.build;
        dispatch({ type: "host/loaded", info });
      },
      () => dispatch({ type: "host/loaded", info: { build: "unknown", suggestions: [] } }),
    );

  function record(r: CapRef, write: boolean, outcome: Receipt["outcome"], detail: string) {
    dispatch({ type: "receipt/added", receipt: { id: receiptId++, at: new Date(), origin: r.origin, siteName: r.siteName, title: r.cap.title, write, outcome, detail } });
  }

  function onBridgeReady(site: Site) {
    const origin = site.site.origin;
    dispatch({ type: "site/bridge", origin, status: "ready" });
    // Check Mosaic's own source fingerprint again: connecting a site must not need a Mosaic change.
    fetch("/mosaic-host.json")
      .then((r) => r.json())
      .then((now: HostInfo) => dispatch({ type: "site/build-checked", origin, build: now.build, same: firstBuild === now.build }))
      .catch(() => {});
    // Reads that need no input run at once, as context for the step.
    const client = clients.get(origin);
    for (const cap of site.capabilities) {
      if (cap.side_effects !== "read" || Object.keys(cap.input_schema.properties ?? {}).length > 0 || !client) continue;
      const key = capKey(origin, cap.id);
      dispatch({ type: "run/started", cap: key });
      client.invoke(cap.id, {}).then(
        (output) => dispatch({ type: "run/done", cap: key, output, at: new Date(), pulse: false }),
        (e: Error) => dispatch({ type: "run/failed", cap: key, message: e.message, denied: false, at: new Date() }),
      );
    }
  }

  function onSheet(origin: string, active: boolean) {
    clearTimeout(lingerTimer);
    if (active) dispatch({ type: "approval/sheet", origin });
    else
      lingerTimer = setTimeout(() => {
        if (getState().confirming === origin) dispatch({ type: "approval/sheet", origin: null });
      }, SHEET_LINGER_MS);
  }

  async function run(r: CapRef): Promise<boolean> {
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
    const client = clients.get(r.origin);
    if (!client) return false;
    dispatch({ type: "run/started", cap: r.key });
    const write = r.cap.side_effects === "write";
    try {
      const output = await client.invoke(r.cap.id, input);
      dispatch({ type: "run/done", cap: r.key, output, at: new Date(), pulse: true });
      record(r, write, "done", write ? `approved on ${hostOf(r.origin)}` : "read");
      return true;
    } catch (e) {
      const denied = e instanceof BridgeCallError && e.error.code === "denied";
      const message = e instanceof Error ? e.message : String(e);
      dispatch({ type: "run/failed", cap: r.key, message, denied, at: new Date() });
      record(r, write, denied ? "denied" : "failed", denied ? `denied on ${hostOf(r.origin)}, nothing changed` : message);
      return false;
    }
  }

  const actions: Actions = {
    async connect(raw) {
      let target: string;
      try {
        target = new URL(raw.includes("://") ? raw : `https://${raw}`).origin;
      } catch {
        dispatch({ type: "connect/rejected", message: "Enter a site URL, for example http://localhost:4101" });
        return false;
      }
      if (getState().conns.some((c) => c.site.site.origin === target)) {
        dispatch({ type: "connect/rejected", message: `${hostOf(target)} is already connected` });
        return false;
      }
      dispatch({ type: "connect/started", origin: target });
      try {
        const site = await discoverSite(target, AbortSignal.timeout(10_000));
        await pace();
        dispatch({ type: "connect/manifest-read", origin: target, site });
        await pace(180);
        dispatch({ type: "site/added", site, key: nextKey++ });
        setTimeout(() => dispatch({ type: "site/settled", origin: target }), FRESH_MS);
        return true;
      } catch (e) {
        dispatch({ type: "connect/failed", origin: target, message: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
    disconnect(origin) {
      clients.get(origin)?.close();
      clients.delete(origin);
      dispatch({ type: "site/removed", origin });
    },
    run,
    async sendAll() {
      dispatch({ type: "publish/sending", sending: true });
      try {
        for (const w of deriveModel(getState()).writes) {
          if (getState().runs[w.key]?.status === "done") continue;
          if (!(await run(w))) break;
        }
      } finally {
        dispatch({ type: "publish/sending", sending: false });
      }
    },
    setTitle: (title) => dispatch({ type: "doc/title", title }),
    setProp: (key, value) => dispatch({ type: "doc/prop", key, value }),
    setValue: (cap, field, value) => dispatch({ type: "input/value", cap, field, value }),
    setBinding: (cap, field, binding) => dispatch({ type: "input/binding", cap, field, binding, at: Date.now() }),
    setHot: (cap) => {
      if (getState().hot !== cap) dispatch({ type: "ui/hot", cap });
    },
    setHue: (origin, hue) => dispatch({ type: "site/hue", origin, hue: Math.round(hue) % 360 }),
    attachBridge(site, frame) {
      const origin = site.site.origin;
      const client = new BridgeClient(site, frame, (id) => onSheet(origin, id !== null));
      clients.set(origin, client);
      client.ready.then(
        () => onBridgeReady(site),
        (e: Error) => dispatch({ type: "site/bridge", origin, status: "failed", failure: e.message }),
      );
      return () => {
        client.close();
        if (clients.get(origin) === client) clients.delete(origin);
      };
    },
  };

  return {
    getState,
    dispatch,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    actions,
  };
}

const StoreContext = createContext<Store | null>(null);

export function MosaicProvider({ children }: { children: ReactNode }) {
  const store = useRef<Store | null>(null);
  store.current ??= createStore();
  return <StoreContext.Provider value={store.current}>{children}</StoreContext.Provider>;
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

