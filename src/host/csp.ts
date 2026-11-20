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
 * The deployed host page's Content-Security-Policy. Scripts come from the host only: that is the
 * boundary. Frames and fetches may reach any https origin, because a person can connect a site
 * Mosaic has never seen and choose their own model router; the consent dialog gates every new
 * origin before contact (spec §5). Listed origins stay for http sites in local runs. Workers are
 * the runtime's own sandbox worker.
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
    `connect-src ${reach} https:`,
    `frame-src ${reach} https:`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
