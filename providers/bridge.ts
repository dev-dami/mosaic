// Runs on the provider's origin inside a hidden iframe that a Mosaic host embeds.
// The bridge, not the host, decides what runs: it checks who sent each message,
// and it asks the person itself before any write.
import { BRIDGE_PROTOCOL, isBridgeMessage, type BridgeError, type BridgeToHost, type HostToBridge } from "../src/protocol";
import type { BridgeConfig } from "./site";

// The Approve button stays disabled this long after the prompt appears, so a host
// cannot trick a click that was aimed at its own page (as browser permission prompts do).
const APPROVE_DELAY_MS = 700;

const configPromise: Promise<BridgeConfig> = fetch("/mosaic/bridge-config").then((r) => r.json());
const root = document.getElementById("root")!;
let confirmQueue: Promise<unknown> = Promise.resolve();

function send(hostOrigin: string, message: BridgeToHost) {
  window.parent.postMessage(message, hostOrigin);
}

function askPerson(config: BridgeConfig, hostOrigin: string, title: string, input: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    root.replaceChildren();
    const h = document.createElement("h1");
    h.textContent = `${config.site}: ${title}?`;
    const who = document.createElement("p");
    who.className = "who";
    who.textContent = `${hostOrigin} asks ${config.site} to do this for you. ${config.site} shows this prompt, not the page behind it.`;
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(input, null, 2);
    const deny = document.createElement("button");
    deny.textContent = "Deny";
    const approve = document.createElement("button");
    approve.textContent = "Approve";
    approve.className = "approve";
    approve.disabled = true;
    setTimeout(() => (approve.disabled = false), APPROVE_DELAY_MS);
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(deny, approve);
    root.append(h, who, pre, actions);
    const finish = (ok: boolean) => {
      root.replaceChildren();
      resolve(ok);
    };
    deny.onclick = () => finish(false);
    approve.onclick = () => finish(true);
  });
}

async function invoke(config: BridgeConfig, hostOrigin: string, msg: Extract<HostToBridge, { kind: "invoke" }>) {
  const capability = config.capabilities.find((c) => c.id === msg.capability);
  if (!capability) {
    return send(hostOrigin, { protocol: BRIDGE_PROTOCOL, kind: "result", id: msg.id, ok: false, error: { code: "unknown_capability", message: `no capability ${msg.capability}` } });
  }
  if (capability.side_effects === "write") {
    // One prompt at a time: a second write waits until the person answers the first.
    const approved = (confirmQueue = confirmQueue.then(() => {
      send(hostOrigin, { protocol: BRIDGE_PROTOCOL, kind: "confirm-needed", id: msg.id });
      return askPerson(config, hostOrigin, capability.title, msg.input);
    })) as Promise<boolean>;
    if (!(await approved)) {
      return send(hostOrigin, { protocol: BRIDGE_PROTOCOL, kind: "result", id: msg.id, ok: false, error: { code: "denied", message: "the person denied this action" } });
    }
  }
  const response = await fetch(`/api/capabilities/${encodeURIComponent(capability.id)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(msg.input),
    signal: AbortSignal.timeout(20_000),
  }).catch((e: Error) => e);
  if (response instanceof Error) {
    return send(hostOrigin, { protocol: BRIDGE_PROTOCOL, kind: "result", id: msg.id, ok: false, error: { code: "provider_error", message: response.message } });
  }
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (response.ok) return send(hostOrigin, { protocol: BRIDGE_PROTOCOL, kind: "result", id: msg.id, ok: true, output: body });
  const error: BridgeError = { code: response.status === 400 ? "invalid_input" : "provider_error", message: String(body.error) };
  send(hostOrigin, { protocol: BRIDGE_PROTOCOL, kind: "result", id: msg.id, ok: false, error });
}

window.addEventListener("message", async (event) => {
  if (window.parent === window || event.source !== window.parent) return;
  if (!isBridgeMessage(event.data)) return;
  const config = await configPromise;
  if (!config.allowed_hosts.includes(event.origin)) {
    send(event.origin, { protocol: BRIDGE_PROTOCOL, kind: "refused", error: { code: "host_not_allowed", message: `${config.site} does not accept requests from ${event.origin}` } });
    return;
  }
  const msg = event.data as HostToBridge;
  switch (msg.kind) {
    case "hello":
      return send(event.origin, { protocol: BRIDGE_PROTOCOL, kind: "ready" });
    case "invoke":
      return invoke(config, event.origin, msg);
  }
});
