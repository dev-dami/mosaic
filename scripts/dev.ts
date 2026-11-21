// Starts Mosaic and every demo site, each on its own origin (ports base+101 to base+107).
// Inkpost (newsletter) stays out of the suggestions on purpose: it is the "site Mosaic has never
// seen", connected by typing its URL. Corkboard (base+109) publishes no manifest at all; Scout
// (base+108) is the agent that learns it, and serves what it learned from base+110 up.
const base = Number(process.env.PORT_BASE ?? 4000);
const host = `http://localhost:${base}`;
const names = ["docs", "releases", "announcer", "newsletter", "videos", "issues", "agents"];
const sites = names.map((name, i) => ({ name, file: `providers/${name}.ts`, port: base + 101 + i }));
const suggest = sites.filter((s) => s.name !== "newsletter").map((s) => `http://localhost:${s.port}`);
// Each suggested site by the network name it publishes; the host's agent network links each one.
// Inkpost stays unlinked too, so connecting it binds a spare slot at runtime.
const slugs: Record<string, string> = {
  docs: "pagewright", releases: "tagforge", announcer: "loudhailer", newsletter: "inkpost",
  videos: "reelhouse", issues: "patchbay", agents: "foreman",
};
const siteOrigins = sites.filter((s) => s.name !== "newsletter").map((s) => `${slugs[s.name]}=http://localhost:${s.port}`).join(",");
const scout = `http://localhost:${base + 108}`;
const procs = [
  Bun.spawn(["bun", "src/host/server.ts"], {
    env: { ...process.env, PORT: String(base), MOSAIC_SUGGEST: suggest.join(","), MOSAIC_AGENT: scout, SITE_ORIGINS: siteOrigins },
    stdout: "inherit",
    stderr: "inherit",
  }),
  ...sites.map((s) => Bun.spawn(["bun", s.file], { env: { ...process.env, PORT: String(s.port), MOSAIC_HOSTS: host }, stdout: "inherit", stderr: "inherit" })),
  Bun.spawn(["bun", "providers/corkboard.ts"], { env: { ...process.env, PORT: String(base + 109) }, stdout: "inherit", stderr: "inherit" }),
  Bun.spawn(["bun", "agent/scout.ts"], { env: { ...process.env, PORT: String(base + 108), MOSAIC_HOSTS: host }, stdout: "inherit", stderr: "inherit" }),
];
// Ctrl C or a SIGTERM from a supervisor stops every server this started, by its own PID.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    for (const p of procs) p.kill();
    process.exit(0);
  });
}
await Promise.all(procs.map((p) => p.exited));
export {};
