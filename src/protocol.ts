import Ajv from "ajv";
import manifestSchema from "../spec/capabilities-v0.schema.json";

export const MANIFEST_PATH = "/.well-known/mosaic-capabilities.json";
export const BRIDGE_PROTOCOL = "bridge/0";

export type JsonSchema = {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  format?: string;
  maxLength?: number;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  "x-mosaic-widget"?: "textarea";
  [keyword: string]: unknown;
};

export type Capability = {
  id: string;
  title: string;
  description: string;
  side_effects: "read" | "write";
  input_schema: JsonSchema;
  output_schema: JsonSchema;
};

export type Manifest = {
  mosaic: "capabilities/0";
  site: { name: string; origin: string; description?: string };
  bridge: string;
  capabilities: Capability[];
};

/** A manifest checked against the schema and bound to the origin that served it. */
export type Site = Manifest & { bridgeUrl: string };

export type BridgeError = {
  code: "host_not_allowed" | "unknown_capability" | "denied" | "invalid_input" | "provider_error";
  message: string;
};

export type HostToBridge =
  | { protocol: typeof BRIDGE_PROTOCOL; kind: "hello" }
  | { protocol: typeof BRIDGE_PROTOCOL; kind: "invoke"; id: string; capability: string; input: unknown };

export type BridgeToHost =
  | { protocol: typeof BRIDGE_PROTOCOL; kind: "ready" }
  | { protocol: typeof BRIDGE_PROTOCOL; kind: "confirm-needed"; id: string }
  | { protocol: typeof BRIDGE_PROTOCOL; kind: "result"; id: string; ok: true; output: unknown }
  | { protocol: typeof BRIDGE_PROTOCOL; kind: "result"; id: string; ok: false; error: BridgeError }
  | { protocol: typeof BRIDGE_PROTOCOL; kind: "refused"; error: BridgeError };

const ajv = new Ajv({ allErrors: true });
const validateManifest = ajv.compile<Manifest>(manifestSchema);

export class ManifestError extends Error {}

/**
 * Parse a manifest fetched from `fetchedFrom`. The manifest must name the same origin
 * that served it, so a site cannot claim capabilities for another origin.
 */
export function parseManifest(raw: unknown, fetchedFrom: string): Site {
  if (!validateManifest(raw)) {
    throw new ManifestError(`manifest does not match capabilities/0: ${ajv.errorsText(validateManifest.errors)}`);
  }
  const origin = new URL(fetchedFrom).origin;
  if (raw.site.origin !== origin) {
    throw new ManifestError(`manifest names origin ${raw.site.origin} but was served by ${origin}`);
  }
  const ids = new Set<string>();
  for (const capability of raw.capabilities) {
    if (ids.has(capability.id)) throw new ManifestError(`duplicate capability id ${capability.id}`);
    ids.add(capability.id);
  }
  const bridgeUrl = new URL(raw.bridge, origin);
  if (bridgeUrl.origin !== origin) throw new ManifestError("bridge must be on the site's own origin");
  return { ...raw, bridgeUrl: bridgeUrl.href };
}

export async function discoverSite(siteUrl: string, signal?: AbortSignal): Promise<Site> {
  const origin = new URL(siteUrl).origin;
  const response = await fetch(origin + MANIFEST_PATH, { signal, credentials: "omit" });
  if (!response.ok) throw new ManifestError(`no capability manifest at ${origin}${MANIFEST_PATH} (HTTP ${response.status})`);
  return parseManifest(await response.json(), origin);
}

export function isBridgeMessage(data: unknown): data is { protocol: typeof BRIDGE_PROTOCOL; kind: string } {
  return typeof data === "object" && data !== null && (data as { protocol?: unknown }).protocol === BRIDGE_PROTOCOL;
}
