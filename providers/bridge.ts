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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function applyLook(config: BridgeConfig) {
  const html = document.documentElement;
  html.dataset.scheme = config.look.scheme;
  html.dataset.font = config.look.font;
  html.style.setProperty("--accent", config.look.accent);
}

function oneLine(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const flat = text.replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*]\s+/gm, "· ").replace(/\s*\n+\s*/g, " ").trim();
  return flat.length > 90 ? flat.slice(0, 89) + "…" : flat || "—";
}

function siteHeader(config: BridgeConfig): HTMLElement {
  const head = el("header", "site");
  const mark = el("div", "mark", (config.site.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase());
  const who = el("div");
  who.append(el("div", "name", config.site), el("div", "origin", location.origin));
  head.append(mark, who, el("span", "lock", "Prompt from this site"));
  return head;
}

/** Show the site's own progress and result, so the host never has to draw a spinner over the prompt. */
function showStatus(config: BridgeConfig, kind: "working" | "done" | "denied" | "failed", message: string, sub: string) {
  const box = el("div", `status ${kind}`);
  if (kind === "working") box.append(el("div", "spinner"));
  else box.append(el("div", "icon", kind === "done" ? "✓" : "✕"));
  box.append(el("div", "msg", message), el("div", "sub", sub));
  root.replaceChildren(el("div", "bar"), siteHeaderWrap(config), box);
}

function siteHeaderWrap(config: BridgeConfig): HTMLElement {
  const wrap = el("div", "sheet");
  wrap.style.flex = "none";
  wrap.style.paddingBottom = "0";
  wrap.append(siteHeader(config));
  return wrap;
}

function askPerson(config: BridgeConfig, hostOrigin: string, capability: BridgeConfig["capabilities"][number], input: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    applyLook(config);
    const sheet = el("div", "sheet");
    const ask = el("div", "ask");
    const via = el("div", "via");
    via.append(`on ${config.site} · requested via `, el("b", undefined, new URL(hostOrigin).host));
    ask.append(el("div", "verb", capability.title), via);

    const items = el("dl");
    const entries = input && typeof input === "object" ? Object.entries(input as Record<string, unknown>) : [["input", input] as const];
    for (const [key, value] of entries.slice(0, 5)) {
      const row = el("div");
      row.append(el("dt", undefined, capability.fields[key] ?? key), el("dd", undefined, oneLine(value)));
      items.append(row);
    }

    const consequence = el("p", "consequence", `This changes ${config.site}. ${capability.description} The page that asked cannot see or press this prompt.`);
    const details = el("details");
    details.append(el("summary", undefined, "Show exact request"), el("pre", undefined, JSON.stringify(input, null, 2)));

    const deny = el("button", "deny", "Deny");
    const approve = el("button", "approve");
    approve.append(el("span", "fill"), el("span", undefined, `Approve · ${capability.title}`));
    approve.disabled = true;
    setTimeout(() => (approve.disabled = false), APPROVE_DELAY_MS);
    const actions = el("div", "actions");
    actions.append(deny, approve);

    sheet.append(siteHeader(config), ask, items, consequence, details, actions);
    root.replaceChildren(el("div", "bar"), sheet);
    const finish = (ok: boolean) => {
      if (ok) showStatus(config, "working", `${capability.title}…`, `${config.site} is doing this now.`);
      else showStatus(config, "denied", "Denied", `Nothing was sent to ${config.site}.`);
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
      return askPerson(config, hostOrigin, capability, msg.input);
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
    if (capability.side_effects === "write") showStatus(config, "failed", "Did not go through", response.message);
    return send(hostOrigin, { protocol: BRIDGE_PROTOCOL, kind: "result", id: msg.id, ok: false, error: { code: "provider_error", message: response.message } });
  }
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (capability.side_effects === "write") {
    if (response.ok) showStatus(config, "done", "Done", `${capability.title} on ${config.site}.`);
    else showStatus(config, "failed", "Did not go through", String(body.error));
  }
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
