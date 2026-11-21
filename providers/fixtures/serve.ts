// Serves one fixture origin (./index.ts) for the browser runbook (e2e/areas/interop.cjs).
// Test-only: FIXTURE_ROLE is "a" or "b"; FIXTURE_A, FIXTURE_B and FIXTURE_DENIED are the origins.
// Every file is public JSON any origin may read, without credentials, as for a real site.
import { fixtureFiles } from "./index";

const role = process.env.FIXTURE_ROLE === "b" ? "b" : "a";
const at = { a: process.env.FIXTURE_A ?? "", b: process.env.FIXTURE_B ?? "", denied: process.env.FIXTURE_DENIED ?? "http://localhost:9" };
if (!at.a || !at.b) throw new Error("Set FIXTURE_A and FIXTURE_B to the two fixture origins.");
const files = fixtureFiles(role, at);
const port = Number(process.env.PORT ?? 0);

const server = Bun.serve({
  port,
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response(`Fixtures ${role.toUpperCase()} (test only)`);
    if (!(path in files)) return new Response("not found", { status: 404 });
    return Response.json(files[path], { headers: { "access-control-allow-origin": "*" } });
  },
});
console.log(`Fixtures ${role.toUpperCase()} on http://localhost:${server.port} (test only)`);
