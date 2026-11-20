// Recipes: a workspace as a link. A recipe holds the outcome and the sites in order; a learned site
// also carries its adapter template, so a Mosaic with a different Scout can import it and rebuild
// the same workspace. Nothing else travels: no inputs, no results, no approvals.
// Owner: entry.
import { scout } from "./agent";
import type { Actions, State } from "./state";

export type Recipe = {
  mosaic: "recipe/0";
  outcome: string;
  sites: { origin: string; adapter?: unknown }[];
};

const toB64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

export async function buildRecipe(state: State, agent?: string): Promise<Recipe> {
  const templates = agent ? await scout.templates(agent).catch(() => []) : [];
  const sites: Recipe["sites"] = [];
  for (const c of state.conns) {
    const origin = c.site.site.origin;
    const t = c.site.site.agent ? templates.find((x) => x.origin === origin) : undefined;
    sites.push(t && agent ? { origin, adapter: await scout.adapter(agent, t.id) } : { origin });
  }
  return { mosaic: "recipe/0", outcome: state.title, sites };
}

export async function recipeLink(state: State, agent?: string): Promise<string> {
  return `${location.origin}/#recipe=${toB64(JSON.stringify(await buildRecipe(state, agent)))}`;
}

/** The recipe in this page's address, if any. */
export function recipeFromHash(hash = location.hash): Recipe | null {
  const m = hash.match(/recipe=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const r = JSON.parse(fromB64(m[1]!)) as Recipe;
    return r.mosaic === "recipe/0" && typeof r.outcome === "string" && Array.isArray(r.sites) ? r : null;
  } catch {
    return null;
  }
}

/**
 * Rebuild a workspace: set the outcome, import learned templates into this Mosaic's Scout, then
 * connect each site in order. Every connection runs the usual checks; a recipe grants nothing.
 */
export async function applyRecipe(recipe: Recipe, actions: Actions, agent?: string) {
  actions.setTitle(recipe.outcome);
  for (const s of recipe.sites) {
    let origin = s.origin;
    if (s.adapter && agent) origin = (await scout.import(agent, s.adapter).catch(() => null))?.origin ?? origin;
    await actions.connect(origin);
  }
}
