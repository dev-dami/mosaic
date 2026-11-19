# Mosaic

**What if the web could build the app you need, instead of making you navigate the apps it has?**

Mosaic is a browser workspace that is assembled at runtime from the capabilities that websites publish.
You connect a site by its URL. Mosaic reads the site's capability manifest and turns each capability into
working controls. Reads run at once. Writes run only after you approve them on a prompt that the site
itself shows, not Mosaic.

The test for the project: **can a person connect a newly deployed, compatible site, and use its
capabilities, with no change to Mosaic's source?** The end-to-end test proves this. It starts a site
after Mosaic has loaded, connects it, and runs one of its capabilities.

Status: early spike for the Open Agentic Web Challenge. All demo sites are
fictional. Nothing leaves your machine.

## Run it

Needs [Bun](https://bun.sh) 1.4 or later. The end-to-end test also needs Node 24 and a Chromium.

```sh
bun install
bun run dev        # Mosaic on :4000, demo sites on :4101, :4102, :4103
```

Open http://localhost:4000 and connect `http://localhost:4101`, then `http://localhost:4102`, then
`http://localhost:4103` (the empty page offers them as chips). Each port is a different origin, so each
site is a separate website to the browser. `PORT_BASE=8000 bun run dev` moves everything to 8000/8101-8103.

```sh
bun run typecheck
bun run test       # unit tests: form compiler, manifest parsing, site API guard
bun run e2e        # browser test of the whole flow (set CHROMIUM_PATH if needed, E2E_PORT_BASE to move ports)
```

## The workspace

The workspace is one document, a runbook for the outcome you name ("Launch Lumen v1.0").

- **Steps.** Each connected site becomes a numbered step, built from the capabilities in its manifest.
  Every step and value carries a host-drawn provenance chip: a monogram, the site name and its origin.
  The chip's colour comes from a hash of the origin, so a site cannot pick another site's colour.
- **Data flows between sites.** A field takes its value from a document property (Project, Version) or
  from another step's output with the same name, shown as a token and a connector line in the margin.
  Release notes drafted on one site fill the docs change on a second and the post on a third. You can
  unlink a token and type, or link an empty field to any output with one click.
- **Output as content.** Markdown is rendered, a before/after pair is a coloured diff, lists of records
  are tables. The raw JSON and the input schema are behind toggles.
- **Ready to publish.** Every write is gathered at the end for review. Each opens that site's own
  approval prompt, styled by the site, with the 700 ms Approve delay shown as a fill. Approved, denied
  and failed writes stay visible, and an activity log records each one.
- **No redeploy.** The top bar shows a fingerprint of Mosaic's own source. Mosaic checks it again after
  each connection, so the "connect a site Mosaic has never seen" moment shows the build did not change.

Mosaic matches fields by name and shape only. Nothing in `src/` knows the demo sites.

## How it works

```
 Mosaic page (origin A)                          Site (origin B)
 ─────────────────────                           ───────────────
 1. GET B/.well-known/mosaic-capabilities.json ─▶ manifest (public, CORS *)
 2. compile each input_schema into a form
 3. embed hidden iframe B/mosaic/bridge ────────▶ bridge page, runs on origin B
 4. postMessage {invoke, capability, input} ────▶ checks sender origin against its allow list
                                                  write? shows its own Approve / Deny prompt
                                                  POST B/api/capabilities/:id (same origin)
 5. ◀──────────────────────────── postMessage {result}
```

The parts:

| Path | What it is |
|---|---|
| `spec/capabilities-v0.schema.json` | The manifest format. Capability fields follow the WebAgentica tool declaration where they overlap. |
| `src/protocol.ts` | Manifest parsing (bound to the origin that served it) and the bridge message types. |
| `src/form.ts` | The capability-to-UI compiler: JSON Schema to form fields, and form values back to typed input. |
| `src/host/` | The Mosaic workspace (React) and the host end of the bridge. |
| `providers/site.ts`, `providers/bridge.ts` | A small kit that makes any site Mosaic-compatible: manifest, bridge page, guarded API. |
| `providers/{docs,releases,announcer}.ts` | Three fictional demo sites: Pagewright (docs), Tagforge (releases), Loudhailer (announcements). |
| `src/host/doc.ts` | Runbook logic: provenance hue, markdown and diff models, the outcome sentence, field bindings. |

### Security rules in the spike

- A manifest must name the origin that served it, and its bridge must be on that origin.
- The host accepts a bridge message only from that site's iframe window and origin.
- The bridge accepts requests only from host origins that the site allows (`MOSAIC_HOSTS`).
- The site API accepts calls only from its own origin, so a host page cannot call it directly.
- Every write needs approval on the site's own prompt. The Approve button stays disabled for 700 ms
  so that a host cannot redirect a click that was aimed at its own page.

Known gaps are in [docs/plan.md](docs/plan.md#known-gaps).

## Make your site Mosaic-compatible

Write a site definition and serve it with the kit:

```ts
import { serveSite } from "./providers/site";

serveSite({
  name: "My Site",
  description: "What the site does.",
  port: 4200,
  capabilities: [{
    id: "say-hello",
    title: "Say hello",
    description: "Return a greeting.",
    side_effects: "read",
    input_schema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
    output_schema: { type: "object", properties: { text: { type: "string" } } },
    run: ({ name }) => ({ text: `Hello, ${name}` }),
  }],
});
```

Run it, then paste its URL into Mosaic. Mosaic needs no change.

## Relation to WebAgentica

The challenge's reference work is MIT NANDA's [WebAgentica](https://github.com/projnanda/webagentica)
(Apache-2.0): signed, data-only `agent.pkg` packages that the person's own runtime verifies and runs.
Mosaic does not replace it. See [docs/plan.md](docs/plan.md) for what Mosaic reuses, what it adds, and
the open decision about where capability declarations come from.
