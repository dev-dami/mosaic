// `bun run conformance`: runs test/conformance (one file per MVP Profile 0.3 §6 check) and prints
// one line per check: PASS when every test named "§6.N …" passed. Exits 1 when any check fails or
// has no test.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHECKS = [
  "Publish a two-agent network and a manifest",
  "Run on the published default router, and on BYOK",
  "Call an internal agent and a grounded site action",
  "Consent, then an exact named network from a second origin",
  "A user key never reaches a site; a peer cannot change the router",
  "Private context crosses only by name",
  "Invalid network, cycle, over budget, denied origin: visible stops",
];

const dir = mkdtempSync(join(tmpdir(), "mosaic-conformance-"));
const report = join(dir, "junit.xml");
const proc = Bun.spawn(["bun", "test", "test/conformance", "--reporter=junit", `--reporter-outfile=${report}`], { stdout: "ignore", stderr: "pipe" });
const stderr = await new Response(proc.stderr).text();
await proc.exited;
let xml = "";
try {
  xml = readFileSync(report, "utf8");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const cases = [...xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)].map((m) => ({
  name: unescape(/\bname="([^"]*)"/.exec(m[1]!)?.[1] ?? ""),
  failed: /<failure|<error/.test(m[3] ?? ""),
  skipped: /<skipped/.test(m[3] ?? ""),
}));

let ok = true;
console.log("MVP Profile 0.3 §6 interoperability checks (test/conformance)");
CHECKS.forEach((title, i) => {
  const mine = cases.filter((c) => c.name.startsWith(`§6.${i + 1} `));
  const passed = mine.filter((c) => !c.failed && !c.skipped).length;
  const pass = mine.length > 0 && passed === mine.length;
  ok &&= pass;
  console.log(`${pass ? "PASS" : "FAIL"}  §6.${i + 1}  ${title.padEnd(66)} ${passed}/${mine.length} tests`);
});
if (!ok) {
  console.error(stderr.split("\n").filter((l) => /fail|error/i.test(l)).slice(0, 40).join("\n"));
  process.exit(1);
}
