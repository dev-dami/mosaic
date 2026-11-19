// A demo site's own home page: what it offers and what has changed on it.
// Area C "review" owns this file (the page people land on from a receipt link).
// The e2e reads "No changes yet." and the capability id of each write from this page.
import { MANIFEST_PATH } from "../src/protocol";
import type { Activity, SiteDefinition, SiteLook } from "./site";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function renderHome(def: SiteDefinition, look: SiteLook, activity: Activity[]): Response {
  const rows = activity
    .map((a) => `<li><time>${a.at}</time> <b>${escapeHtml(a.capability)}</b> <code>${escapeHtml(JSON.stringify(a.input))}</code></li>`)
    .join("");
  const caps = def.capabilities.map((c) => `<li><b>${escapeHtml(c.title)}</b> (${c.side_effects}): ${escapeHtml(c.description)}</li>`).join("");
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${escapeHtml(def.name)}</title>
<link rel="mosaic-capabilities" href="${MANIFEST_PATH}">
<style>body{font:15px/1.55 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;background:${look.scheme === "dark" ? "#141218" : "#fbfaf7"};color:${look.scheme === "dark" ? "#ecebf2" : "#1d1c1a"}}h1{color:${look.accent}}code{font-size:12px;word-break:break-all}li{margin:6px 0}</style>
<h1>${escapeHtml(def.name)}</h1><p>${escapeHtml(def.description)}</p>
<p><small>Fictional demo site. Nothing leaves this server.</small></p>
<h2>Capabilities</h2><ul>${caps}</ul>
<h2>Activity</h2><ul id="activity">${rows || "<li>No changes yet.</li>"}</ul>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
