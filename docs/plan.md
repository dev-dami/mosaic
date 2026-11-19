# Mosaic plan

Updated 2026-11-19. Challenge entry closes 2027-01-11 (from press coverage of the Open Agentic Web
Challenge; check the Devpost page).

## What the reference already does

Read from `projnanda/webagentica` at commit `34e2f3b` (2026-11-11):

- **`agent.pkg`** is a signed (Ed25519), data-only package: manifest, workflow graph, skills, JSON
  schemas, tool declarations, policy. It holds no executable code (`spec/agent-pkg-v0.md`).
- **Tool declarations** (`agents/webair/tools/*.tool.json`) already have the shape that Mosaic needs:
  `endpoint`, `method`, `input_schema`, `output_schema`, `side_effects`, `approval_required`,
  `permissions`, `domains`.
- **A site's own package can call that site's own API.** WebAir's package searches flights, gets a
  quote and simulates a purchase through WebAir's API, run in the person's runtime with the person's
  grants. So "a site's agent cannot act on its own site" is **not** the gap. Do not pitch it that way.
- **Discovery**: a site advertises packages with `<link rel="agent-package">` in its page head.
- **Two runtimes**: a Python reference (`agentpkg`) and a TypeScript core that runs in Chrome and in
  Node (`chrome-agent-browser/src/core`, Apache-2.0). The TypeScript core opens and verifies packages.
- **network.v0** gives bounded, model-chosen delegation between roles **inside one package**.

## The real gap that Mosaic fills

- **No composition across publishers.** One package comes from one publisher. network.v0 refuses
  remote roles (R-1: "a remote role (B-186; A2A later under the same bounds)"), and the threat model
  says "Cross-origin delegation is not supported."
- **No interface from capabilities.** The runtimes run a package's own workflow. Nothing turns the
  capabilities of several sites into one working application.
- **No site-owned consent across origins.** Approval happens in the runtime. There is no way for a
  site to show its own prompt for a write that another page asks for.

Mosaic is the composition layer: many publishers' capabilities, one workspace, writes approved by
each site.

## Open decision: where capability declarations come from

| Option | For | Against |
|---|---|---|
| A. Mosaic manifest only (the spike) | Simple. Works today. | A second format beside agent.pkg. No signature. Judges may see it as a parallel standard. |
| **B. Read tool declarations from the site's signed agent.pkg** (recommended) | One artifact for publishers. Signature and publisher trust come from the reference core. Strong "spec-compliant" story. | Needs the TypeScript core in the browser, and package build and signing for each demo site. |
| C. Both: agent.pkg first, manifest as fallback | Most compatible. | Two code paths to test. |

Recommendation: **B**. Keep the bridge (it is the extension), and get the declarations from
`<link rel="agent-package">` and the package's `tools/*.tool.json`. The bridge then needs one more
field per tool, for example `extensions["org.mosaic:bridge"]`, because the reference leaves
cross-origin transport out of scope.

## Phases

Each phase ends with the end-to-end test green.

1. **Spike (done).** Manifest discovery, schema-to-form compiler, cross-origin bridge with site-owned
   approval, three demo sites, a site added at runtime, refusal of a host the site does not allow.
2. **Signed declarations.** Option B: discover and verify packages with the WebAgentica TypeScript core,
   map tool declarations to capabilities, sign the demo sites' packages.
3. **Data flow between capabilities (first cut done).** Fill one capability's input from another's
   output (release notes into the announcement). Name matching, document properties, and one-click
   manual links work today; typed matching beyond strings does not.
4. **Real credentials.** Sign-in for a site inside the bridge (popup sign-in, or the Storage Access API,
   because browsers partition or block third-party iframe cookies). This is the largest remaining risk.
5. **Recipes.** Save a workspace as a declarative recipe: site URLs, capability ids, layout, data
   bindings. Another person loads it with their own credentials.
6. **Deploy and demo.** Each site on its own HTTPS domain. Record the "add a site Mosaic has never
   seen" moment.

## Known gaps

- shortcut: no `frame-ancestors` CSP on the bridge page, because Bun HTML-import routes cannot set
  headers. Upgrade: build the bridge with `Bun.build` and serve it with the header.
- shortcut: the clickjacking guard is a 700 ms delay only. Upgrade: Intersection Observer v2
  (`trackVisibility`) where available.
- shortcut: no sign-in. Demo sites keep state in memory and trust their own bridge.
- shortcut: Mosaic does not validate a capability's output against `output_schema`.
- The e2e test needs `CHROMIUM_PATH` on this machine, because the cached Chromium revision (1254)
  differs from the one that `playwright-core` expects (1255).
