// The deploy build's assets. From source (bun run dev, tests, e2e) this stays undefined and each
// server builds or reads its assets as it always did. scripts/build-deploy.ts swaps this module for
// a generated one while it bundles a deployment, so the deployed server never reads a file, never
// runs Bun.build and never uses an HTML import (Vercel's Bun runtime supports neither safely).

/** One file of the prebuilt host page. Binary files (fonts) are base64. */
export type PrebuiltFile = { type: string; body: string; base64?: true };

export type Prebuilt = {
  /** The host's source fingerprint at build time (src/host/fingerprint.ts). */
  fingerprint: string;
  /** src/host/index.html built for the browser, by URL path ("/" is the page). */
  host: Record<string, PrebuiltFile>;
  /** providers/bridge-page.html. */
  bridgePage: string;
  /** providers/bridge-actions.ts built for the browser. */
  bridgeActions: string;
  /** vendor/nsdeploy-runtime JavaScript modules, by path below the runtime folder. */
  runtime: Record<string, string>;
};

export const prebuilt: Prebuilt | undefined = undefined;
