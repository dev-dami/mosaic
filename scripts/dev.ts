export {};
// Starts Mosaic and the three demo sites, each on its own origin (port).
const procs = ["src/host/server.ts", "providers/docs.ts", "providers/releases.ts", "providers/announcer.ts"].map((file) =>
  Bun.spawn(["bun", file], { stdout: "inherit", stderr: "inherit" }),
);
process.on("SIGINT", () => {
  for (const p of procs) p.kill();
  process.exit(0);
});
await Promise.all(procs.map((p) => p.exited));
