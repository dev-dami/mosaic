// Holds the person's model profiles and the MosaicAgent built from the selected one, and rebuilds
// the agent whenever the selection changes. Also owns the consent dialog every contact with another
// site goes through. Areas read it with useAgentEngine(); C7 (connect) and C9 (outcome turns) wire it in.
import * as Dialog from "@radix-ui/react-dialog";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MosaicAgent, routerHostOf, type ConsentDecision, type ConsentRequest, type ModelSetup } from "../agentic/engine";
import { Button } from "../primitives";
import { loadProfileStore, type ByokProfile, type ByokStore, type ProfileStore } from "./byok-store";
import "./settings.css";

export interface AgentEngineValue {
  /** The agent for the current setup; null while it loads or when loading failed. */
  agent: MosaicAgent | null;
  status: "loading" | "ready" | "error";
  error: string | null;
  /** Saved profiles. Keys stay inside; never render `profile.key`. */
  store: ByokStore | null;
  /** "model" with a selected key, otherwise "manual" (no model call). */
  mode: "model" | "manual";
  routerHost: string;
  saveProfile(profile: Partial<ByokProfile>): void;
  selectProfile(id: string): void;
  deleteProfile(id: string): void;
}

const EngineContext = createContext<AgentEngineValue | null>(null);

export function useAgentEngine(): AgentEngineValue {
  const value = useContext(EngineContext);
  if (!value) throw new Error("useAgentEngine needs <AgentEngineProvider>.");
  return value;
}

const sameSetup = (a: ModelSetup | null, b: ModelSetup) => !!a && a.key === b.key && a.router === b.router && a.model === b.model;

interface PendingConsent {
  req: ConsentRequest;
  resolve: (d: ConsentDecision) => void;
}

export function AgentEngineProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<ProfileStore | null>(null);
  const [store, setStore] = useState<ByokStore | null>(null);
  const [setup, setSetup] = useState<ModelSetup | null>(null);
  const [agent, setAgent] = useState<MosaicAgent | null>(null);
  const [status, setStatus] = useState<AgentEngineValue["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [consents, setConsents] = useState<PendingConsent[]>([]);
  const agentRef = useRef<MosaicAgent | null>(null);
  const build = useRef(0);

  const onConsent = useCallback(
    (req: ConsentRequest) => new Promise<ConsentDecision>((resolve) => setConsents((q) => [...q, { req, resolve }])),
    [],
  );
  // Stop: the contact requests a stopped turn left waiting are declined, and their dialogs close.
  const cancelConsents = useCallback(() => {
    setConsents((q) => {
      for (const c of q) if (c.req.kind !== "connect") c.resolve("decline");
      return q.filter((c) => c.req.kind === "connect");
    });
  }, []);

  // Load byok.js and the first setup.
  useEffect(() => {
    let live = true;
    loadProfileStore()
      .then((p) => {
        if (!live) return;
        setProfiles(p);
        setStore(p.load());
        setSetup(p.setup());
      })
      .catch((e: Error) => {
        setStatus("error");
        setError(`Mosaic's agent runtime did not load: ${e.message}`);
      });
    return () => {
      live = false;
    };
  }, []);

  // Build (or rebuild) the agent for the current setup.
  useEffect(() => {
    if (!setup) return;
    const n = ++build.current;
    setStatus("loading");
    const prev = agentRef.current;
    const next = prev ? prev.rebuild(setup) : MosaicAgent.create({ setup, onConsent, cancelConsents });
    next.then(
      (a) => {
        if (n !== build.current) return;
        agentRef.current = a;
        setAgent(a);
        setStatus("ready");
        setError(null);
      },
      (e: Error) => {
        if (n !== build.current) return;
        setStatus("error");
        setError(e.message);
      },
    );
  }, [setup, onConsent, cancelConsents]);

  const apply = useCallback(
    (next: ByokStore) => {
      if (!profiles) return;
      setStore(next);
      const s = profiles.setup();
      setSetup((cur) => (sameSetup(cur, s) ? cur : s));
    },
    [profiles],
  );

  const mode: AgentEngineValue["mode"] = setup?.key ? "model" : "manual";
  const value = useMemo<AgentEngineValue>(
    () => ({
      agent,
      status,
      error,
      store,
      mode,
      routerHost: routerHostOf(mode === "model" && setup ? setup : {}),
      saveProfile: (p) => profiles && apply(profiles.save(p)),
      selectProfile: (id) => profiles && apply(profiles.select(id)),
      deleteProfile: (id) => profiles && apply(profiles.remove(id)),
    }),
    [agent, status, error, store, mode, setup, profiles, apply],
  );

  const current = consents[0];
  const decide = (d: ConsentDecision) => {
    current?.resolve(d);
    setConsents((q) => q.slice(1));
  };

  return (
    <EngineContext.Provider value={value}>
      {children}
      <ConsentDialog request={current?.req ?? null} routerHost={value.routerHost} onDecide={decide} />
    </EngineContext.Provider>
  );
}

/** Asks before Mosaic's agent contacts another site, and names that site's origin. */
function ConsentDialog({ request, routerHost, onDecide }: { request: ConsentRequest | null; routerHost: string; onDecide: (d: ConsentDecision) => void }) {
  const host = request?.peerOrigin ?? "";
  const connecting = request?.kind === "connect";
  return (
    <Dialog.Root open={!!request} onOpenChange={(open) => !open && onDecide("decline")}>
      <Dialog.Portal>
        <Dialog.Overlay className="palette-overlay" />
        <Dialog.Content className="settings consent" aria-describedby="consent-body">
          <Dialog.Title className="settings-title">{connecting ? `Connect ${host}?` : `Contact ${host}?`}</Dialog.Title>
          <div id="consent-body" className="settings-body">
            <p>
              {connecting
                ? `Mosaic will load the agent network "${request?.peerLabel}" that ${host} publishes and run it in this browser.`
                : `Mosaic's agent wants to run ${request?.peerLabel && request.peerLabel !== host ? `"${request.peerLabel}" from ` : ""}${host} for this request.`}
            </p>
            {connecting && <p className="consent-turns">Mosaic's agent may use {host} during your turns. Disconnect it to stop.</p>}
            {!connecting && request?.requestText && <blockquote className="consent-request">{request.requestText}</blockquote>}
            <p className="settings-note">
              {host} gets requests for its own published files and actions only. Your key stays with {routerHost}.
            </p>
          </div>
          <div className="settings-actions">
            <Button variant="tertiary" onClick={() => onDecide("decline")}>
              Decline
            </Button>
            <Button variant="secondary" onClick={() => onDecide("always")}>
              Always allow {host}
            </Button>
            <Button variant="primary" onClick={() => onDecide("allow")}>
              Allow
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
