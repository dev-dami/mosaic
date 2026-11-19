import { BRIDGE_PROTOCOL, isBridgeMessage, type BridgeError, type BridgeToHost, type HostToBridge, type Site } from "../protocol";

const READY_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS = 30_000;

export class BridgeCallError extends Error {
  constructor(readonly error: BridgeError) {
    super(error.message);
  }
}

type Pending = { resolve: (output: unknown) => void; reject: (e: Error) => void; timer?: ReturnType<typeof setTimeout> };

/**
 * The host's end of one site's bridge. It accepts a message only from the site's own
 * iframe window and origin. Writes have no timeout: they wait for the person.
 */
export class BridgeClient {
  readonly ready: Promise<void>;
  private readonly pending = new Map<string, Pending>();
  private confirming: string | null = null;
  private readonly onMessage: (event: MessageEvent) => void;
  private markReady!: () => void;
  private markRefused!: (e: Error) => void;

  constructor(
    private readonly site: Site,
    private readonly frame: HTMLIFrameElement,
    private readonly onConfirm: (id: string | null) => void,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.markReady = resolve;
      this.markRefused = reject;
    });
    const timer = setTimeout(() => this.markRefused(new Error(`${site.site.name} bridge did not answer`)), READY_TIMEOUT_MS);
    void this.ready.finally(() => clearTimeout(timer)).catch(() => {});

    this.onMessage = (event) => {
      if (event.source !== this.frame.contentWindow || event.origin !== this.site.site.origin) return;
      if (isBridgeMessage(event.data)) this.handle(event.data as BridgeToHost);
    };
    window.addEventListener("message", this.onMessage);
    frame.addEventListener("load", () => this.post({ protocol: BRIDGE_PROTOCOL, kind: "hello" }), { once: true });
    frame.src = site.bridgeUrl;
  }

  invoke(capabilityId: string, input: unknown): Promise<unknown> {
    const capability = this.site.capabilities.find((c) => c.id === capabilityId);
    if (!capability) return Promise.reject(new Error(`unknown capability ${capabilityId}`));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const entry: Pending = { resolve, reject };
      if (capability.side_effects === "read") {
        entry.timer = setTimeout(() => this.settle(id, new Error(`${capability.title} timed out`)), READ_TIMEOUT_MS);
      }
      this.pending.set(id, entry);
      this.post({ protocol: BRIDGE_PROTOCOL, kind: "invoke", id, capability: capabilityId, input });
    });
  }

  close() {
    window.removeEventListener("message", this.onMessage);
    for (const id of this.pending.keys()) this.settle(id, new Error("disconnected"));
  }

  private post(message: HostToBridge) {
    this.frame.contentWindow?.postMessage(message, this.site.site.origin);
  }

  private handle(message: BridgeToHost) {
    switch (message.kind) {
      case "ready":
        return this.markReady();
      case "refused":
        return this.markRefused(new BridgeCallError(message.error));
      case "confirm-needed":
        this.confirming = message.id;
        return this.onConfirm(message.id);
      case "result":
        return this.settle(message.id, message.ok ? { output: message.output } : new BridgeCallError(message.error));
    }
  }

  private settle(id: string, outcome: { output: unknown } | Error) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (this.confirming === id) {
      this.confirming = null;
      this.onConfirm(null);
    }
    if (outcome instanceof Error) entry.reject(outcome);
    else entry.resolve(outcome.output);
  }
}
