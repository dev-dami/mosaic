// The site's own approval sheet: how it looks and reads. Plain DOM, runs on the site's origin
// in the nsdeploy action bridge's popup (providers/bridge-actions.ts, styles in bridge-page.html) and,
// until C7, in the old bridge/0 iframe (providers/bridge.ts, bridge.html).
// What it must not decide: who may ask, and when Approve becomes clickable. The caller owns both
// (the runtime's callerOrigins check, and the 700 ms Approve delay applied to the button returned here).
// Every value from the host is written with textContent, never as HTML.
import { diffWordsWithSpace } from "diff";
import { changedKeys, humanKey, plainText, showValue, type Shown } from "./sheet-format";
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

/** What the person answered last time this sheet asked for a capability, kept for this page's life. */
const history = new Map<string, { input: Record<string, unknown>; answer: "approved" | "denied"; at: Date }>();

const asRecord = (input: unknown): Record<string, unknown> => (input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : { input });
const clock = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function svg(path: string, cls = "ico"): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(ns, "svg");
  s.setAttribute("viewBox", "0 0 256 256");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("class", cls);
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", path);
  s.append(p);
  return s;
}
// Icon paths: Phosphor (MIT), bold weight, inlined because the sheet is plain DOM.
const LOCK = "M208,76H180V56A52,52,0,0,0,76,56V76H48A20,20,0,0,0,28,96V208a20,20,0,0,0,20,20H208a20,20,0,0,0,20-20V96A20,20,0,0,0,208,76ZM100,56a28,28,0,0,1,56,0V76H100ZM204,204H52V100H204Z";
const CHECK = "M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z";
const CROSS = "M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z";

function siteHeader(config: BridgeConfig): HTMLElement {
  const head = el("header", "site");
  const mark = el("div", "mark", (config.site.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase());
  const who = el("div", "who");
  // An agent's sheet says whose prompt it is: the agent's, acting on a site that did not publish this.
  const tagline = config.agent ? `${config.agent.name} · agent, not ${new URL(config.agent.drives).host}` : "Prompt from this site";
  who.append(el("div", "name", config.site), el("div", "tagline", tagline));
  const pill = el("span", "origin-pill");
  pill.title = `This page is served by ${location.origin}`;
  pill.append(svg(LOCK), el("span", undefined, location.host));
  head.append(mark, who, pill);
  return head;
}

/** A value, shown for a person: Yes/No, local dates, lines and items, long text folded. */
function valueNode(shown: Shown): HTMLElement {
  switch (shown.kind) {
    case "empty":
      return el("span", "v-empty", shown.text);
    case "bool": {
      const b = el("span", `v-bool ${shown.value ? "yes" : "no"}`);
      b.append(svg(shown.value ? CHECK : CROSS), el("span", undefined, shown.text));
      return b;
    }
    case "date": {
      const d = el("span", "v-date");
      const t = el("time", undefined, shown.text);
      t.dateTime = shown.iso;
      d.append(t, el("span", "v-rel", shown.relative));
      return d;
    }
    case "number":
      return el("span", "v-num", shown.text);
    case "list": {
      const ul = el("ul", "v-list");
      for (const item of shown.items) ul.append(el("li", undefined, item));
      return ul;
    }
    case "json":
      return el("pre", "v-json", shown.text);
    case "text":
      return foldable(el("span", "v-text", shown.text), shown.long, "Show all");
    case "lines": {
      const box = el("div", "v-lines");
      let list: HTMLUListElement | null = null;
      for (const line of shown.lines) {
        if (line.kind === "item") {
          if (!list) box.append((list = el("ul")));
          list.append(el("li", undefined, line.text));
          continue;
        }
        list = null;
        box.append(el(line.kind === "heading" ? "strong" : "p", undefined, line.text));
      }
      return foldable(box, shown.long, `Show all ${shown.lines.length} lines`);
    }
  }
}

function foldable(node: HTMLElement, long: boolean, label: string): HTMLElement {
  if (!long) return node;
  const wrap = el("div", "fold folded");
  const more = el("button", "more", label);
  more.type = "button";
  more.onclick = () => {
    const folded = wrap.classList.toggle("folded");
    more.textContent = folded ? label : "Show less";
  };
  wrap.append(node, more);
  return wrap;
}

/** Word diff of one value against what was asked last time. */
function diffNode(before: unknown, after: unknown): HTMLElement {
  const out = el("div", "diff");
  for (const part of diffWordsWithSpace(plainText(before), plainText(after))) {
    if (part.added) out.append(el("ins", undefined, part.value));
    else if (part.removed) out.append(el("del", undefined, part.value));
    else out.append(part.value.length > 64 ? `${part.value.slice(0, 28)} … ${part.value.slice(-28)}` : part.value);
  }
  return out;
}

/** "Changed since you denied this": the honest comparison this sheet can make, with its own memory. */
function sinceNode(capability: CapabilityInfo, input: Record<string, unknown>): HTMLElement | null {
  const prev = history.get(capability.id);
  if (!prev) return null;
  const keys = changedKeys(prev.input, input);
  const box = el("div", `since ${keys.length ? "changed" : "same"}`);
  if (keys.length === 0) {
    box.append(el("span", undefined, `Same request you ${prev.answer} at ${clock(prev.at)}.`));
    return box;
  }
  box.append(el("div", "since-title", `Changed since you ${prev.answer} this at ${clock(prev.at)}`));
  for (const k of keys) {
    const row = el("div", "since-row");
    row.append(el("span", "since-key", capability.fields[k] ?? humanKey(k)), diffNode(prev.input[k], input[k]));
    box.append(row);
  }
  return box;
}

/** Show the site's own progress and result, so the host never has to draw a spinner over the prompt. */
export function renderStatus(root: HTMLElement, config: BridgeConfig, kind: "working" | "done" | "denied" | "failed", message: string, sub: string) {
  applyLook(config);
  const sheet = el("div", "sheet status-sheet");
  const box = el("div", `status ${kind}`);
  if (kind === "working") box.append(el("div", "spinner"));
  else {
    const icon = el("div", "icon");
    icon.append(svg(kind === "done" ? CHECK : CROSS));
    box.append(icon);
  }
  box.append(el("div", "msg", message), el("div", "sub", sub));
  sheet.append(siteHeader(config), box);
  root.replaceChildren(el("div", "bar"), sheet);
}

/**
 * Draw the approval prompt for one write and return its two buttons. The caller wires the clicks
 * and enforces the Approve delay; this function only renders (and remembers the answer it sees, to
 * show what changed if the same capability is asked again).
 */
export function renderPrompt(root: HTMLElement, config: BridgeConfig, hostOrigin: string, capability: CapabilityInfo, input: unknown): { approve: HTMLButtonElement; deny: HTMLButtonElement } {
  applyLook(config);
  const values = asRecord(input);
  const sheet = el("div", "sheet");

  const ask = el("div", "ask");
  const via = el("p", "via");
  via.append("Requested by ", el("b", undefined, new URL(hostOrigin).host), ". That page can't see or press this prompt.");
  ask.append(el("div", "kicker", `Approve a change on ${config.agent ? new URL(config.agent.drives).host : config.site}`), el("h1", "verb", capability.title), via);

  const items = el("dl", "values");
  for (const [key, value] of Object.entries(values)) {
    const row = el("div", "row");
    row.append(el("dt", undefined, capability.fields[key] ?? humanKey(key)));
    const dd = el("dd");
    dd.append(valueNode(showValue(value)));
    row.append(dd);
    items.append(row);
  }

  const consequence = el("p", "consequence");
  consequence.append(el("b", undefined, `This changes ${config.site}.`), ` ${capability.description}`);
  const agentNote = config.agent ? el("p", "agent-note") : null;
  if (config.agent && agentNote) {
    const host = new URL(config.agent.drives).host;
    agentNote.append(
      el("b", undefined, `${config.agent.name} will do this in a browser on ${host}.`),
      ` ${host} did not publish this action; ${config.agent.name} learned it from the site's pages. Approve only what you would do there yourself.`,
    );
  }
  const details = el("details");
  details.append(el("summary", undefined, "Show exact request"), el("pre", undefined, JSON.stringify(input, null, 2)));

  const deny = el("button", "deny", "Deny");
  deny.type = "button";
  const approve = el("button", "approve");
  approve.type = "button";
  approve.append(el("span", "fill"), el("span", "label", "Approve"));
  const actions = el("div", "actions");
  actions.append(deny, approve);
  const note = el("p", "delay-note", "Approve unlocks after a moment, so a click aimed at the page behind can't land on it.");

  const remember = (answer: "approved" | "denied") => history.set(capability.id, { input: structuredClone(values), answer, at: new Date() });
  deny.addEventListener("click", () => remember("denied"));
  approve.addEventListener("click", () => remember("approved"));

  const since = sinceNode(capability, values);
  sheet.append(siteHeader(config), ask, ...(since ? [since] : []), items, ...(agentNote ? [agentNote] : []), consequence, details);
  const foot = el("div", "foot");
  foot.append(actions, note);
  root.replaceChildren(el("div", "bar"), sheet, foot);
  return { approve, deny };
}
