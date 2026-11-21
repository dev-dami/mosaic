// Connected sites as the runbook sees them, read from the runtime's action registry (MVP Profile
// 0.3). A site publishes /agent-manifest.json and its actions through its own action bridge; once
// MosaicAgent.connectNetwork has resolved the network, the runtime has registered each bridge
// action as an entry "<origin>/<network>#<name>". This file turns those entries into the
// Capability shape the runbook renders, and receipts from registry.execute into outcomes.
// Pure: no fetch, no DOM.
import type { Capability, JsonSchema } from "../../protocol";

/** Mosaic's manifest extension: an agent performs these actions on a site that did not publish them. */
export type AgentInfo = { name: string; drives: string; learned_by: string };

export type SiteInfo = { name: string; origin: string; description?: string; theme_color?: string; agent?: AgentInfo };

/** One connected site network. Keyed by origin in the workspace: one network per origin. */
export type Site = {
  site: SiteInfo;
  /** The exact network name, and its URL `<origin>/<network>`. */
  network: string;
  url: string;
  capabilities: Capability[];
  /** Registry ref per capability id. */
  refs: Record<string, string>;
};

/** The slice of a site's /agent-manifest.json the host reads. */
export type PublishedManifest = {
  brand?: string;
  networks?: { name: string; description?: string }[];
  theme?: { primary?: string };
  x_mosaic?: { agent?: AgentInfo };
};

/** An entry of the runtime's ActionRegistry (vendor/nsdeploy-runtime/actions.js). */
export type RegistryEntry = {
  ref: string;
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  effect: "read" | "write" | "irreversible";
  availability: string;
  base: string;
  network: string;
};

/** One receipt of ActionRegistry.execute. */
export type ActionReceipt = { action: string; requestId?: string; status: "succeeded" | "unknown" | "not_started"; result?: unknown; error?: string };

export type ActionRegistry = {
  entries: Map<string, RegistryEntry>;
  execute(plan: { entry: RegistryEntry; args: unknown }[], confirm: (items: unknown[]) => Promise<boolean>, invocationId: string): Promise<ActionReceipt[] | null>;
};

const stripOrigin = (s: string) => s.replace(/\/+$/, "");

/**
 * What the person typed, as a connect target: an origin, plus the network name when the URL has
 * one ("http://localhost:4102/tagforge"). Null for search text.
 */
export function connectTarget(text: string): { origin: string; network: string | undefined } | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  if (!t.includes("://") && !/^localhost(:\d+)?(\/.*)?$/i.test(t) && !/^[\w-]+(\.[\w-]+)*\.[a-z][\w-]*(:\d+)?(\/.*)?$/i.test(t) && !/^\d+\.\d+\.\d+\.\d+(:\d+)?/.test(t)) return null;
  const withScheme = t.includes("://") ? t : `${/^(localhost|127\.|\d+\.\d+\.\d+\.\d+)/i.test(t) ? "http" : "https"}://${t}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const network = url.pathname.split("/").filter(Boolean).pop();
    return { origin: url.origin, network: network ? decodeURIComponent(network) : undefined };
  } catch {
    return null;
  }
}

/** The network to connect: the exact name asked for (fail closed), the only one, or a choice. */
export function pickNetwork(manifest: PublishedManifest, name: string | undefined, host: string): { name: string } | { choices: string[] } {
  const names = (manifest.networks ?? []).map((n) => n.name).filter((n): n is string => typeof n === "string" && !!n);
  if (name !== undefined) {
    if (!names.includes(name)) throw new Error(`No published network named '${name}' at ${host}; refusing to run a different network.`);
    return { name };
  }
  if (names.length === 0) throw new Error(`${host} publishes no agent network.`);
  if (names.length === 1) return { name: names[0]! };
  return { choices: names };
}

const humanize = (name: string) => {
  const words = name.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** A registry entry as the runbook's Capability. A write's result fields `ok`/`reason` are the bridge's, not the site's. */
export function capabilityOf(entry: RegistryEntry): Capability {
  const { title, ...input } = entry.inputSchema;
  const write = entry.effect !== "read";
  const output: JsonSchema = entry.outputSchema ? { ...entry.outputSchema } : { type: "object", properties: {} };
  if (write && output.properties) {
    const { ok: _ok, reason: _reason, ...rest } = output.properties;
    output.properties = rest;
  }
  return {
    id: entry.name,
    title: typeof title === "string" && title ? title : humanize(entry.name),
    description: entry.description,
    side_effects: write ? "write" : "read",
    input_schema: input,
    output_schema: output,
  };
}

/** One connected site from the registry entries the runtime registered for (origin, network). */
export function siteFromEntries(entries: Iterable<RegistryEntry>, at: { origin: string; network: string; manifest: PublishedManifest }): Site {
  const origin = stripOrigin(at.origin);
  const mine = [...entries].filter((e) => stripOrigin(e.base) === origin && e.network === at.network);
  const published = at.manifest.networks?.find((n) => n.name === at.network);
  const agent = at.manifest.x_mosaic?.agent;
  return {
    site: {
      name: at.manifest.brand || at.network,
      origin,
      ...(published?.description ? { description: published.description } : {}),
      ...(at.manifest.theme?.primary ? { theme_color: at.manifest.theme.primary } : {}),
      ...(agent ? { agent } : {}),
    },
    network: at.network,
    url: `${origin}/${at.network}`,
    capabilities: mine.map(capabilityOf),
    refs: Object.fromEntries(mine.map((e) => [e.name, e.ref])),
  };
}

export type Outcome =
  | { kind: "done"; output: unknown; requestId?: string }
  | { kind: "denied"; requestId?: string }
  | { kind: "failed"; message: string; requestId?: string }
  | { kind: "unknown"; message: string; requestId?: string }
  | { kind: "not_started"; message: string; requestId?: string };

/**
 * A receipt in the dock's words. succeeded with ok !== false → done; ok:false "denied" → denied;
 * other ok:false → failed with the site's reason; unknown → unknown (the site may have done it:
 * never retried); not started, or a window cancelled before it opened → not_started.
 */
export function outcomeOf(receipt: ActionReceipt, effect: "read" | "write" = "write"): Outcome {
  const requestId = receipt.requestId;
  if (receipt.status === "not_started") return { kind: "not_started", message: "Not started: an earlier action did not finish.", requestId };
  if (receipt.status === "unknown") {
    const message = receipt.error || "The outcome is unknown.";
    // The runtime's own words for "nothing was sent": a window cancelled or never connected.
    if (/not started|no action was sent|action was cancelled/i.test(message)) return { kind: "not_started", message, requestId };
    return { kind: "unknown", message, requestId };
  }
  const result = receipt.result;
  if (effect === "read") return { kind: "done", output: result, requestId };
  const r = (result && typeof result === "object" ? result : {}) as { ok?: unknown; reason?: unknown };
  if (r.ok === false) {
    const reason = typeof r.reason === "string" && r.reason ? r.reason : "The site did not do this.";
    return reason === "denied" ? { kind: "denied", requestId } : { kind: "failed", message: reason, requestId };
  }
  const { ok: _ok, reason: _reason, ...output } = r as Record<string, unknown>;
  return { kind: "done", output, requestId };
}
