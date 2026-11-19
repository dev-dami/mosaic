// The site's own approval sheet: how it looks and reads. Plain DOM, runs on the site's origin
// inside the bridge iframe. Area C "review" owns this file and providers/bridge.html.
// What it must not decide: who may ask, and when Approve becomes clickable. providers/bridge.ts
// owns both (sender origin checks, and the 700 ms Approve delay it applies to the button returned here).
import type { BridgeConfig } from "./site";

type CapabilityInfo = BridgeConfig["capabilities"][number];

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function applyLook(config: BridgeConfig) {
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

function siteHeaderWrap(config: BridgeConfig): HTMLElement {
  const wrap = el("div", "sheet");
  wrap.style.flex = "none";
  wrap.style.paddingBottom = "0";
  wrap.append(siteHeader(config));
  return wrap;
}

/** Show the site's own progress and result, so the host never has to draw a spinner over the prompt. */
export function renderStatus(root: HTMLElement, config: BridgeConfig, kind: "working" | "done" | "denied" | "failed", message: string, sub: string) {
  const box = el("div", `status ${kind}`);
  if (kind === "working") box.append(el("div", "spinner"));
  else box.append(el("div", "icon", kind === "done" ? "✓" : "✕"));
  box.append(el("div", "msg", message), el("div", "sub", sub));
  root.replaceChildren(el("div", "bar"), siteHeaderWrap(config), box);
}

/**
 * Draw the approval prompt for one write and return its two buttons. The caller wires the clicks
 * and enforces the Approve delay; this function only renders.
 */
export function renderPrompt(root: HTMLElement, config: BridgeConfig, hostOrigin: string, capability: CapabilityInfo, input: unknown): { approve: HTMLButtonElement; deny: HTMLButtonElement } {
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
  const actions = el("div", "actions");
  actions.append(deny, approve);

  sheet.append(siteHeader(config), ask, items, consequence, details, actions);
  root.replaceChildren(el("div", "bar"), sheet);
  return { approve, deny };
}
