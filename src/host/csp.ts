import { OTARI_ROUTER } from "./agentic/network";

export type HostCspInput = {
  /** The demo sites' origins (SITE_ORIGINS and MOSAIC_SUGGEST). */
  siteOrigins: string[];
  /** Scout's origin (MOSAIC_AGENT), when set. */
  agent?: string;
  /** More origins to frame and fetch (MOSAIC_CSP_ORIGINS), such as a site connected by URL or Scout's adapters. */
  extra?: string[];
};

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

/**
 * The deployed host page's Content-Security-Policy. Scripts come from the host only. The page
 * frames and fetches the sites (their bridges and published agent files), Scout and the default
 * model router, and nothing else. Workers are the runtime's own sandbox worker.
 */
export function hostCsp({ siteOrigins, agent, extra = [] }: HostCspInput): string {
  const reach = [...new Set(["'self'", ...siteOrigins.map(originOf), ...(agent ? [originOf(agent)] : []), ...extra, new URL(OTARI_ROUTER).origin])].join(" ");
  return [
    "default-src 'self'",
    "script-src 'self'",
    "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src ${reach}`,
    `frame-src ${reach}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
