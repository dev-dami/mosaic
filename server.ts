// Deploy entry: one repository, one Vercel project per origin. MOSAIC_ROLE picks what this origin serves.
import { serveSite, type SiteDefinition } from "./providers/site";
import { docsSite } from "./providers/docs";
import { releasesSite } from "./providers/releases";
import { announcerSite } from "./providers/announcer";
import { newsletterSite } from "./providers/newsletter";

const sites: Record<string, SiteDefinition> = { docs: docsSite, releases: releasesSite, announcer: announcerSite, newsletter: newsletterSite };
const role = process.env.MOSAIC_ROLE ?? "host";

if (role === "host") await import("./src/host/server");
else if (sites[role]) serveSite(sites[role]);
else throw new Error(`Unknown MOSAIC_ROLE "${role}"`);
