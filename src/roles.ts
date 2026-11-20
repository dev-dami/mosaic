// One repository, one deployment per origin. MOSAIC_ROLE picks what this origin serves: the Mosaic
// host, one of the seven demo sites, or Corkboard (the forum with no manifest that Scout learns).
// Scout itself runs elsewhere (docs/deploy.md). Root server.ts runs this from source, or the bundle
// scripts/build-deploy.ts makes of it.
import { serveSite, type SiteDefinition } from "../providers/site";
import { docsSite } from "../providers/docs";
import { releasesSite } from "../providers/releases";
import { announcerSite } from "../providers/announcer";
import { newsletterSite } from "../providers/newsletter";
import { videosSite } from "../providers/videos";
import { issuesSite } from "../providers/issues";
import { agentsSite } from "../providers/agents";
import { CORKBOARD_PORT, corkboardFetch } from "../providers/corkboard";

export const sites: Record<string, SiteDefinition> = {
  docs: docsSite,
  releases: releasesSite,
  announcer: announcerSite,
  newsletter: newsletterSite,
  videos: videosSite,
  issues: issuesSite,
  agents: agentsSite,
};
export const ROLES = ["host", ...Object.keys(sites), "corkboard"];

const role = process.env.MOSAIC_ROLE ?? "host";

if (role === "host") await import("./host/server");
else if (sites[role]) serveSite(sites[role]);
else if (role === "corkboard") {
  const port = Number(process.env.PORT ?? CORKBOARD_PORT);
  Bun.serve({ port, fetch: corkboardFetch });
  console.log(`Corkboard (no Mosaic manifest) on ${process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`}`);
} else throw new Error(`Unknown MOSAIC_ROLE "${role}"; one of ${ROLES.join(", ")}`);
