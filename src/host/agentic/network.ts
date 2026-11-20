// Mosaic's own agentic-web artifacts (MVP Profile 0.3): the agent manifest, the "mosaic" agent
// network and its links.json. Pure functions of the host config, so the server and the tests build
// the same documents. Each suggested site gets a link slot named by its slug; the spares are for
// sites the person connects by URL, and the engine wrapper hides them while they are unbound.

/** A site Mosaic suggests: its slug (the network name it publishes) and its origin. */
export interface SiteRef {
  slug: string;
  origin: string;
}

export interface HostNetworkConfig {
  sites: SiteRef[];
}

export const NETWORK_NAME = "mosaic";
export const FRONT_AGENT = "mosaic";
export const COMPOSER_AGENT = "composer";
export const SPARE_SLOTS = ["extra_1", "extra_2", "extra_3", "extra_4"] as const;
/** The only private context that may reach a linked site. */
export const DOWNSTREAM_SLY_DATA = ["project", "version"] as const;
export const OTARI_ROUTER = "https://api.otari.ai/api/v1";
export const DEFAULT_MODEL = "alibaba/qwen3.8-flash";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

const toSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, "");

/**
 * Reads SITE_ORIGINS: comma-separated `slug=origin` pairs, or bare origins whose slug is the first
 * hostname label (`https://pagewright.example` → pagewright). A bare loopback origin names nothing,
 * so it must carry a slug. Throws on anything that is not a URL.
 */
export function parseSiteOrigins(value: string): SiteRef[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const eq = entry.indexOf("=");
      const named = eq > 0 && !entry.slice(0, eq).includes(":");
      const url = new URL(named ? entry.slice(eq + 1).trim() : entry);
      const slug = toSlug(named ? entry.slice(0, eq) : LOOPBACK.has(url.hostname) ? "" : url.hostname.split(".")[0]!);
      if (!slug) throw new Error(`SITE_ORIGINS entry "${entry}" needs a slug: write slug=origin`);
      return { slug, origin: url.origin };
    });
}

const request = {
  type: "object",
  properties: { request: { type: "string", description: "What to do, in plain words." } },
  required: ["request"],
};

const label = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

/** The three published documents for the Mosaic host. */
export function buildHostNetwork({ sites }: HostNetworkConfig) {
  const slots = [...sites.map((s) => s.slug), ...SPARE_SLOTS];
  const description =
    "Turns an outcome you describe into steps across the sites you use, and runs them with your approval.";
  const sampleQueries = [
    "Ship release v2.4.0 of acme-api: publish the release notes, update the docs, and announce it.",
    "Draft the changelog post for acme-api v2.4.0 from its release notes.",
    "Which of my linked sites can open an issue for the acme-api docs?",
  ];

  const network = {
    metadata: { description, sample_queries: sampleQueries },
    llm_config: { model_name: DEFAULT_MODEL },
    link_slots: Object.fromEntries(slots.map((s) => [s, {}])),
    link_labels: Object.fromEntries(sites.map((s) => [s.slug, label(s.slug)])),
    tools: [
      {
        name: FRONT_AGENT,
        function: { description: "Plan and run an outcome across the linked sites.", parameters: request },
        instructions: [
          "You are Mosaic, an outcome planner.",
          "Turn the person's outcome into ordered steps across the linked sites, one site per step.",
          "Ground every claim in tool results; if a tool did not return it, say you do not know.",
          "Never invent sites: use only the linked site tools you are given.",
          `Ask ${COMPOSER_AGENT} to draft any text that passes from one site to another, then hand that draft to the next site.`,
          "Every write happens on the site itself, after the person approves it there.",
        ].join(" "),
        tools: [...slots, COMPOSER_AGENT],
        allow: { to_downstream: { sly_data: [...DOWNSTREAM_SLY_DATA] } },
      },
      {
        name: COMPOSER_AGENT,
        function: {
          description: "Draft a value one site passes to another, such as release notes turned into a docs update or a post.",
          parameters: request,
        },
        instructions: [
          "You draft text that moves between sites: a docs update from release notes, an announcement, a newsletter issue.",
          "Use only the facts given in the request; never add versions, dates, links or names that are not there.",
          "Return the draft only, ready to paste, with no commentary.",
        ].join(" "),
        tools: [],
      },
    ],
  };

  const agentManifest = {
    brand: "Mosaic",
    networks: [
      {
        name: NETWORK_NAME,
        front_man: FRONT_AGENT,
        hocon: `./${NETWORK_NAME}.network.json`,
        description,
        tags: ["agentic-website", "outcome-planner"],
        sample_queries: sampleQueries,
      },
    ],
    llm_router: { base_url: OTARI_ROUTER, mock: false, byok_router: OTARI_ROUTER },
    allowed_peers: sites.map((s) => s.origin),
    peer_policy: {
      mode: "closed",
      deny_origins: [],
      note: "Calls only the sites in allowed_peers, after the person agrees to each contact.",
    },
  };

  const links = {
    version: 1,
    networks: { [NETWORK_NAME]: Object.fromEntries(sites.map((s) => [s.slug, `${s.origin}/${s.slug}`])) },
  };

  return { agentManifest, network, links };
}
