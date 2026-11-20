# Vendored: nsdeploy browser runtime

- Source repository: https://github.com/cognizant-ai-labs/agentic-web
- Path: `skills/agentify-website/runtime/`
- Commit: `0516537` (05165377aca457381bd41b5c05e7a26cd23e6d74, 2026-11-19)
- License: Apache-2.0 (`LICENSE`, copied from the repository root; `LICENSE.txt` ships with the runtime)

Every file except `LICENSE` and this `VENDOR.md` is copied unchanged. Do not edit them.
To update, copy the folder again from a newer commit and change the commit above.
Check with:

    diff -r vendor/nsdeploy-runtime <agentic-web>/skills/agentify-website/runtime

It must list only `LICENSE` and `VENDOR.md`.

Mosaic serves these files at `/runtime/*` from the host and from every demo site
(`src/runtime-files.ts`).
