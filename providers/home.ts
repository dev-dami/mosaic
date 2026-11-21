// A demo site's own home page: what it offers and what has changed on it.
// Area C "review" owns this file (the page people land on from a receipt link).
// The e2e reads "No changes yet." and the capability id of each write from this page.
import type { Activity, SiteDefinition, SiteLook } from "./site";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const FONTS: Record<SiteLook["font"], { body: string; title: string; radius: number }> = {
  sans: { body: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`, title: `ui-rounded, "Nunito", system-ui, sans-serif`, radius: 6 },
  serif: { body: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`, title: `"Newsreader", Georgia, "Times New Roman", serif`, radius: 3 },
  mono: { body: `ui-monospace, "SF Mono", Menlo, Consolas, monospace`, title: `ui-monospace, "SF Mono", Menlo, Consolas, monospace`, radius: 4 },
  rounded: { body: `ui-rounded, "Nunito", system-ui, sans-serif`, title: `ui-rounded, "Nunito", system-ui, sans-serif`, radius: 14 },
};

/** One input value, short and readable: Yes/No, first line of long text, compact JSON for the rest. */
function brief(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    const line = value.replace(/^\s*(#{1,6}|[-*•])\s+/gm, "").split("\n").map((l) => l.trim()).filter(Boolean).join(" · ");
    return line.length > 80 ? line.slice(0, 79) + "…" : line || "(empty)";
  }
  return JSON.stringify(value);
}

function inputRows(input: unknown, titles: Record<string, string>): string {
  if (!input || typeof input !== "object") return `<code>${escapeHtml(JSON.stringify(input))}</code>`;
  return Object.entries(input as Record<string, unknown>)
    .map(([k, v]) => `<span class="kv"><span class="k">${escapeHtml(titles[k] ?? k)}</span> ${escapeHtml(brief(v))}</span>`)
    .join("");
}

export function renderHome(def: SiteDefinition, look: SiteLook, activity: Activity[]): Response {
  const dark = look.scheme === "dark";
  const f = FONTS[look.font];
  const titlesFor = (id: string) => {
    const props = def.capabilities.find((c) => c.id === id)?.input_schema.properties ?? {};
    return Object.fromEntries(Object.entries(props).map(([k, s]) => [k, s.title ?? k]));
  };
  const titleOf = (id: string) => def.capabilities.find((c) => c.id === id)?.title ?? id;
  const rows = activity
    .map(
      (a) => `<tr>
        <td><time datetime="${a.at}">${escapeHtml(a.at.slice(0, 16).replace("T", " "))} UTC</time></td>
        <td><b>${escapeHtml(titleOf(a.capability))}</b><code class="id">${escapeHtml(a.capability)}</code></td>
        <td class="inputs">${inputRows(a.input, titlesFor(a.capability))}</td>
      </tr>`,
    )
    .join("");
  const caps = def.capabilities
    .map(
      (c) => `<tr>
        <td><b>${escapeHtml(c.title)}</b><code class="id">${escapeHtml(c.id)}</code></td>
        <td><span class="tag ${c.side_effects}">${c.side_effects === "write" ? "changes this site" : "read only"}</span></td>
        <td>${escapeHtml(c.description)}</td>
      </tr>`,
    )
    .join("");
  const initial = escapeHtml((def.name.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase());
  const accent = escapeHtml(look.accent);
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(def.name)}</title>
<link rel="agent-manifest" href="/agent-manifest.json">
<style>
:root{color-scheme:${dark ? "dark" : "light"};--accent:${accent};
--bg:${dark ? "hsl(240 8% 9%)" : look.font === "rounded" ? "#fff8f4" : "hsl(75 14% 95%)"};--card:${dark ? "hsl(235 8% 14%)" : "#fff"};
--ink:${dark ? "hsl(0 0% 92%)" : "#151515"};--muted:${dark ? "hsl(0 0% 62%)" : "hsl(0 0% 40%)"};
--line:${dark ? "hsl(230 8% 22%)" : "hsl(78 13% 85%)"};--sunken:${dark ? "hsl(240 8% 11%)" : "#f9faf7"};
--ledge:color-mix(in oklab,var(--accent) ${dark ? 45 : 55}%,#000);--r:${f.radius}px}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 ${f.body};-webkit-font-smoothing:antialiased}
.top{height:5px;background:var(--accent)}
main{max-width:860px;margin:0 auto;padding:36px 20px 64px}
header{display:flex;align-items:center;gap:14px}
.mark{width:48px;height:48px;border-radius:var(--r);display:grid;place-items:center;background:var(--accent);color:${dark ? "#111" : "#fff"};font:800 22px ${f.title};border:1px solid color-mix(in oklab,var(--accent) 70%,#000);box-shadow:0 3px 0 var(--ledge);flex:none}
h1{margin:0;font:800 30px/1.1 ${f.title};letter-spacing:-.01em}
.lede{margin:4px 0 0;color:var(--muted)}
.note{margin:22px 0 30px;padding:9px 12px;border:1px dashed var(--line);border-radius:var(--r);color:var(--muted);font-size:13px}
h2{margin:28px 0 8px;font:600 11px/1.5 ${f.body};text-transform:uppercase;letter-spacing:.075em;color:var(--muted)}
table{width:100%;border-collapse:separate;border-spacing:0;background:var(--card);border:1px solid var(--line);border-radius:calc(var(--r) + 2px);box-shadow:0 3px 0 var(--line);overflow:hidden;font-size:13px}
th{text-align:left;padding:7px 10px;background:var(--sunken);font:700 11px ${f.body};text-transform:uppercase;letter-spacing:.04em;color:var(--muted);box-shadow:inset 0 -1px var(--line)}
td{padding:8px 10px;border-top:1px solid var(--line);vertical-align:top}
tbody tr:first-child td{border-top:0}
th:first-child,td:first-child{padding-left:16px}
td:first-child{box-shadow:inset 3px 0 0 var(--accent)}
td b{display:block;font-weight:650}
code.id{font:11.5px ui-monospace,"SF Mono",Menlo,monospace;color:var(--muted)}
time{font:12px ui-monospace,"SF Mono",Menlo,monospace;color:var(--muted);white-space:nowrap}
.tag{display:inline-block;padding:1px 6px;border:1px solid var(--line);border-radius:var(--r);font-size:11px;font-weight:500;white-space:nowrap;color:var(--muted)}
.tag.write{color:var(--accent);border-color:currentColor}
.inputs{display:flex;flex-direction:column;gap:2px}
.kv{overflow-wrap:anywhere}.k{display:inline-block;min-width:88px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.empty td{color:var(--muted);text-align:center;padding:18px;box-shadow:none}
@media (max-width:600px){th:nth-child(3),td:nth-child(3):not(.inputs){display:none}table{font-size:12.5px}h1{font-size:24px}}
</style>
<div class="top"></div>
<main>
<header><div class="mark" aria-hidden="true">${initial}</div><div><h1>${escapeHtml(def.name)}</h1><p class="lede">${escapeHtml(def.description)}</p></div></header>
<p class="note">Fictional demo site. Nothing leaves this server.</p>
<h2>What this site offers</h2>
<table><thead><tr><th>Capability</th><th>Kind</th><th>What it does</th></tr></thead><tbody>${caps}</tbody></table>
<h2>Changes</h2>
<table id="activity"><thead><tr><th>When</th><th>Change</th><th>With</th></tr></thead><tbody>${rows || `<tr class="empty"><td colspan="3">No changes yet.</td></tr>`}</tbody></table>
</main></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
