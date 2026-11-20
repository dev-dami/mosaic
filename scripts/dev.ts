// Starts Mosaic and every demo site, each on its own origin (ports base+101 to base+107).
// Inkpost (newsletter) stays out of the suggestions on purpose: it is the "site Mosaic has never
// seen", connected by typing its URL.
const base = Number(process.env.PORT_BASE ?? 4000);
const host = `http://localhost:${base}`;
const names = ["docs", "releases", "announcer", "newsletter", "videos", "issues", "agents"];
const sites = names.map((name, i) => ({ name, file: `providers/${name}.ts`, port: base + 101 + i }));
const suggest = sites.filter((s) => s.name !== "newsletter").map((s) => `http://localhost:${s.port}`);
const procs = [
  Bun.spawn(["bun", "src/host/server.ts"], {
    env: { ...process.env, PORT: String(base), MOSAIC_SUGGEST: suggest.join(",") },
    stdout: "inherit",
    stderr: "inherit",
  }),
  ...sites.map((s) => Bun.spawn(["bun", s.file], { env: { ...process.env, PORT: String(s.port), MOSAIC_HOSTS: host }, stdout: "inherit", stderr: "inherit" })),
];
process.on("SIGINT", () => {
  for (const p of procs) p.kill();
  process.exit(0);
});
await Promise.all(procs.map((p) => p.exited));
export {};
