// Corkboard: a fictional support forum that publishes no Mosaic manifest. It is plain HTML with
// forms and tables, as most of the web is. Mosaic cannot connect it directly; Scout (agent/scout.ts)
// opens it in a browser, learns what its pages can do, and serves that as a Mosaic site.
type Post = { author: string; body: string; at: string };
type Thread = { id: number; title: string; author: string; status: "open" | "answered"; posts: Post[] };

const threads: Thread[] = [
  {
    id: 1,
    title: "Connect button does nothing on Safari 18",
    author: "tomasz_k",
    status: "open",
    posts: [
      { author: "tomasz_k", body: "Clicking Connect on Safari 18.2 does nothing. No error in the console. Chrome works.", at: "2026-11-18" },
      { author: "lena.v", body: "Same here on macOS 15. It started after the last update.", at: "2026-11-18" },
      { author: "okafor", body: "Private windows show it too, so it is not an extension.", at: "2026-11-19" },
    ],
  },
  {
    id: 2,
    title: "Feature request: dark approval sheets",
    author: "ines.r",
    status: "open",
    posts: [{ author: "ines.r", body: "The approval sheet is bright at night. Could sites declare a dark scheme?", at: "2026-11-17" }],
  },
  {
    id: 3,
    title: "How do I feed two outputs into one field?",
    author: "sam_p",
    status: "answered",
    posts: [
      { author: "sam_p", body: "I want the summary and the version in one post. Is that possible?", at: "2026-11-15" },
      { author: "mod_ada", body: "Yes. Pick both tokens in the field menu; Mosaic joins them.", at: "2026-11-15" },
    ],
  },
  {
    id: 4,
    title: "Release notes show the old version after a reconnect",
    author: "okafor",
    status: "open",
    posts: [{ author: "okafor", body: "After reconnecting Patchbay the version stays at v1.0.0.", at: "2026-11-16" }],
  },
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} · Corkboard</title>
<meta name="theme-color" content="#a0662b"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font:15px/1.5 Georgia,serif;margin:0;background:#f4ead8;color:#2b2118}
header{background:#a0662b;color:#fff;padding:10px 24px;display:flex;gap:16px;align-items:center}
header a{color:#fff}main{max-width:860px;margin:24px auto;padding:0 16px}
table{width:100%;border-collapse:collapse;background:#fffaf0}th,td{border:1px solid #d9c6a5;padding:6px 10px;text-align:left}
th{background:#ead9b9}form{background:#fffaf0;border:1px solid #d9c6a5;padding:12px;margin:16px 0;display:grid;gap:8px;max-width:560px}
label{font-weight:bold}input,textarea{font:inherit;padding:6px;border:1px solid #b9a07a}button{font:inherit;background:#a0662b;color:#fff;border:0;padding:6px 14px;cursor:pointer;justify-self:start}
ol.posts{padding:0;list-style:none}ol.posts li{background:#fffaf0;border:1px solid #d9c6a5;padding:10px;margin:8px 0}
</style></head><body><header><b>Corkboard</b><a href="/">Threads</a><a href="/new">Start a thread</a></header><main>${body}</main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

const searchForm = (q = "") => `<form action="/search" method="get" role="search" aria-label="Search threads">
<label for="q">Search threads</label><input id="q" name="q" value="${esc(q)}" placeholder="Words in the title or posts"><button>Search</button></form>`;

function table(list: Thread[]): string {
  if (!list.length) return "<p>No threads match.</p>";
  const rows = list
    .map((t) => `<tr><td><a href="/thread/${t.id}">${esc(t.title)}</a></td><td>${esc(t.author)}</td><td>${t.posts.length - 1}</td><td>${t.status}</td></tr>`)
    .join("");
  return `<table id="threads"><thead><tr><th>Thread</th><th>Author</th><th>Replies</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function threadPage(t: Thread): Response {
  const posts = t.posts.map((p) => `<li><b class="author">${esc(p.author)}</b> <time>${p.at}</time><p>${esc(p.body)}</p></li>`).join("");
  return page(
    t.title,
    `<h1>${esc(t.title)}</h1><p>Started by ${esc(t.author)} · ${t.status}</p><ol class="posts">${posts}</ol>
<h2>Reply</h2><form method="post" action="/thread/${t.id}/reply" aria-label="Reply to this thread">
<label for="author">Name</label><input id="author" name="author" required>
<label for="body">Your reply</label><textarea id="body" name="body" rows="4" required></textarea>
<button>Post reply</button></form>`,
  );
}

export function corkboardFetch(req: Request): Response | Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === "/" && req.method === "GET") {
    return page("Threads", `<h1>Mosaic support forum</h1>${searchForm()}${table(threads)}`);
  }
  if (path === "/search") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const hits = threads.filter((t) => [t.title, ...t.posts.map((p) => p.body)].join(" ").toLowerCase().includes(q));
    return page("Search", `<h1>Search results</h1>${searchForm(q)}${table(hits)}`);
  }
  if (path === "/new" && req.method === "GET") {
    return page(
      "Start a thread",
      `<h1>Start a thread</h1><form method="post" action="/threads" aria-label="Start a thread">
<label for="title">Title</label><input id="title" name="title" required>
<label for="body">What happened?</label><textarea id="body" name="body" rows="5" required></textarea>
<label for="author">Name</label><input id="author" name="author" required>
<button>Post thread</button></form>`,
    );
  }
  if (path === "/threads" && req.method === "POST") {
    return req.formData().then((f) => {
      const t: Thread = { id: threads.length + 1, title: String(f.get("title")), author: String(f.get("author")), status: "open", posts: [] };
      t.posts.push({ author: t.author, body: String(f.get("body")), at: new Date().toISOString().slice(0, 10) });
      threads.push(t);
      return Response.redirect(new URL(`/thread/${t.id}`, url).href, 303);
    });
  }
  const m = path.match(/^\/thread\/(\d+)(\/reply)?$/);
  const t = m && threads.find((x) => x.id === Number(m[1]));
  if (t && !m![2] && req.method === "GET") return threadPage(t);
  if (t && m![2] && req.method === "POST") {
    return req.formData().then((f) => {
      t.posts.push({ author: String(f.get("author")), body: String(f.get("body")), at: new Date().toISOString().slice(0, 10) });
      return Response.redirect(new URL(`/thread/${t.id}#post-${t.posts.length}`, url).href, 303);
    });
  }
  return page("Not found", "<h1>Not found</h1>");
}

export const CORKBOARD_PORT = 4109;

if (import.meta.main) {
  const port = Number(process.env.PORT ?? CORKBOARD_PORT);
  Bun.serve({ port, fetch: corkboardFetch });
  console.log(`Corkboard (no Mosaic manifest) on http://localhost:${port}`);
}
