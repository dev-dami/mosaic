// Recipes: a workspace as a link (recipe/1). A recipe holds the outcome and the connected sites'
// network URLs (`<origin>/<network>`), in order; a site Scout learned also carries its adapter
// template, so a Mosaic with a different Scout can import it and rebuild the same workspace.
// Nothing else travels: no key, router, model or profile, no inputs, no results, no approvals.
// A recipe grants nothing: opening one connects each site through the normal consent dialog.
// recipe/0 links (capabilities/0 origins, now retired) are refused with a plain message.
// Owner: entry.
import { scout } from "./agent";
import type { Actions, State } from "./state";

export type Recipe = {
  mosaic: "recipe/1";
  outcome: string;
  /** Network URLs, `<origin>/<network>`, in connection order. */
  networks: string[];
  /** A Scout template (mosaic-adapter/0) per network URL Scout serves. */
  adapters?: Record<string, unknown>;
};

export const MAX_RECIPE_BYTES = 64 * 1024;
export const MAX_NETWORKS = 20;
const MAX_OUTCOME = 2000;
const MAX_URL = 2048;

/** The slice of Scout's client a recipe uses. */
type ScoutClient = Pick<typeof scout, "templates" | "adapter" | "import">;

const toB64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const encodeRecipe = (r: Recipe) => toB64(new TextEncoder().encode(JSON.stringify(r)));

const BAD_LINK = "This is not a valid recipe link.";

/** The recipe in a link's fragment. Throws a plain message for a bad, oversize or old link. */
export function decodeRecipe(fragment: string): Recipe {
  if (!/^[A-Za-z0-9_-]*$/.test(fragment)) throw new Error(BAD_LINK);
  if (fragment.length > Math.ceil((MAX_RECIPE_BYTES * 4) / 3) + 4) throw new Error(`This recipe link is too large (over ${MAX_RECIPE_BYTES / 1024} KB).`);
  let json: unknown;
  try {
    const bin = atob(fragment.replace(/-/g, "+").replace(/_/g, "/"));
    if (bin.length > MAX_RECIPE_BYTES) throw new Error("too large");
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch (e) {
    if (e instanceof Error && e.message === "too large") throw new Error(`This recipe link is too large (over ${MAX_RECIPE_BYTES / 1024} KB).`);
    throw new Error(BAD_LINK);
  }
  return parseRecipe(json);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A network URL as a recipe may carry it: http(s), no credentials, query or fragment, one path segment. */
function networkUrl(raw: unknown): URL {
  if (typeof raw !== "string" || !raw || raw.length > MAX_URL) throw new Error(`${BAD_LINK} A site is not a URL.`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${BAD_LINK} A site is not a URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`${BAD_LINK} Sites must be http or https URLs.`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${BAD_LINK} A site URL carries extra parts.`);
  if (!/^\/[^/]+$/.test(url.pathname)) throw new Error(`${BAD_LINK} A site URL must name one network, like https://example.com/network.`);
  return url;
}

function checkAdapter(a: unknown) {
  if (!isObject(a) || a.mosaic !== "adapter/0" || !isObject(a.target) || typeof a.target.origin !== "string" || !/^https?:\/\/[^/]+$/.test(a.target.origin) || !Array.isArray(a.skills))
    throw new Error(`${BAD_LINK} A Scout template is malformed.`);
}

/** Check a decoded recipe strictly. Unknown fields are refused, so nothing rides along unseen. */
export function parseRecipe(json: unknown): Recipe {
  if (!isObject(json)) throw new Error(BAD_LINK);
  if (json.mosaic === "recipe/0") throw new Error("This recipe link is from an older Mosaic (recipe/0) and can't be opened here. Ask for a new link.");
  if (json.mosaic !== "recipe/1") throw new Error(BAD_LINK);
  const extra = Object.keys(json).filter((k) => !["mosaic", "outcome", "networks", "adapters"].includes(k));
  if (extra.length) throw new Error(`${BAD_LINK} Unexpected field: ${extra.join(", ")}.`);
  if (typeof json.outcome !== "string" || json.outcome.length > MAX_OUTCOME) throw new Error(`${BAD_LINK} The outcome is missing or too long.`);
  if (!Array.isArray(json.networks)) throw new Error(`${BAD_LINK} It lists no sites.`);
  if (json.networks.length > MAX_NETWORKS) throw new Error(`${BAD_LINK} It lists more than ${MAX_NETWORKS} sites.`);
  const origins = new Set<string>();
  for (const n of json.networks) {
    const { origin } = networkUrl(n);
    if (origins.has(origin)) throw new Error(`${BAD_LINK} It lists ${origin} twice.`);
    origins.add(origin);
  }
  const networks = json.networks as string[];
  const recipe: Recipe = { mosaic: "recipe/1", outcome: json.outcome, networks };
  if (json.adapters !== undefined) {
    if (!isObject(json.adapters)) throw new Error(`${BAD_LINK} Its Scout templates are malformed.`);
    for (const [k, a] of Object.entries(json.adapters)) {
      if (!networks.includes(k)) throw new Error(`${BAD_LINK} A Scout template names a site the recipe does not list.`);
      checkAdapter(a);
    }
    recipe.adapters = json.adapters;
  }
  return recipe;
}

/** The recipe from the connected sites. Only the outcome, network URLs and Scout's own templates. */
export async function buildRecipe(state: Pick<State, "title" | "conns">, agent?: string, client: ScoutClient = scout): Promise<Recipe> {
  const networks = state.conns.map((c) => c.site.url).slice(0, MAX_NETWORKS);
  const learned = state.conns.filter((c) => c.site.site.agent && networks.includes(c.site.url));
  const adapters: Record<string, unknown> = {};
  if (agent && learned.length) {
    const templates = await client.templates(agent).catch(() => []);
    for (const c of learned) {
      const t = templates.find((x) => x.origin === c.site.site.origin);
      if (t) adapters[c.site.url] = await client.adapter(agent, t.id);
    }
  }
  return { mosaic: "recipe/1", outcome: state.title.slice(0, MAX_OUTCOME), networks, ...(Object.keys(adapters).length ? { adapters } : {}) };
}

export async function recipeLink(state: Pick<State, "title" | "conns">, agent?: string, base = location.origin, client: ScoutClient = scout): Promise<string> {
  return `${base}/#recipe=${encodeRecipe(await buildRecipe(state, agent, client))}`;
}

/** The recipe in this page's address: null when there is none, else the recipe or a plain error. */
export function recipeFromHash(hash = location.hash): { recipe: Recipe } | { error: string } | null {
  const m = hash.match(/(?:^#|&)recipe=([^&]*)/);
  if (!m) return null;
  try {
    return { recipe: decodeRecipe(m[1]!) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : BAD_LINK };
  }
}

/**
 * Rebuild a workspace: set the outcome, import each template into this Mosaic's Scout (the served
 * network moves to this Scout's origin), then connect each network URL in order. Every connection
 * asks for consent and runs the usual checks; a recipe grants nothing. Returns plain problems for
 * the sites it could not rebuild (a connection's own failure shows in the connect flow).
 */
export async function applyRecipe(recipe: Recipe, actions: Pick<Actions, "setTitle" | "connect">, agent?: string, client: ScoutClient = scout): Promise<string[]> {
  const problems: string[] = [];
  actions.setTitle(recipe.outcome);
  for (const url of recipe.networks) {
    let target = url;
    const adapter = recipe.adapters?.[url];
    if (adapter !== undefined) {
      const drives = (adapter as { target: { origin: string } }).target.origin;
      if (!agent) {
        problems.push(`This Mosaic has no Scout, so the site Scout learned from ${drives} was not rebuilt.`);
        continue;
      }
      try {
        const t = await client.import(agent, adapter);
        target = `${t.origin}${new URL(url).pathname}`;
      } catch (e) {
        problems.push(`Scout here refused the template for ${drives}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
    }
    await actions.connect(target);
  }
  return problems;
}
