// Starts Mosaic and the three demo sites, each on its own origin (port).
const base = Number(process.env.PORT_BASE ?? 4000);
const host = `http://localhost:${base}`;
const sites = ["docs", "releases", "announcer"].map((name, i) => ({ file: `providers/${name}.ts`, port: base + 101 + i }));
const procs = [
  Bun.spawn(["bun", "src/host/server.ts"], {
    env: { ...process.env, PORT: String(base), MOSAIC_SUGGEST: sites.map((s) => `http://localhost:${s.port}`).join(",") },
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
