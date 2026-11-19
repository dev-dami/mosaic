import { describe, expect, test } from "bun:test";
import { ManifestError, parseManifest } from "../src/protocol";

const manifest = () => ({
  mosaic: "capabilities/0",
  site: { name: "Demo", origin: "https://docs.example" },
  bridge: "/mosaic/bridge",
  capabilities: [
    { id: "preview", title: "Preview", description: "Preview a change.", side_effects: "read", input_schema: { type: "object" }, output_schema: { type: "object" } },
  ],
});

describe("parseManifest", () => {
  test("accepts a manifest from its own origin and resolves the bridge there", () => {
    expect(parseManifest(manifest(), "https://docs.example/").bridgeUrl).toBe("https://docs.example/mosaic/bridge");
  });

  test("refuses a manifest that names another origin", () => {
    expect(() => parseManifest(manifest(), "https://evil.example")).toThrow(ManifestError);
  });

  test("refuses a protocol-relative bridge on another origin", () => {
    expect(() => parseManifest({ ...manifest(), bridge: "//evil.example/bridge" }, "https://docs.example")).toThrow(ManifestError);
  });

  test("refuses duplicate capability ids", () => {
    const m = manifest();
    m.capabilities.push({ ...m.capabilities[0]! });
    expect(() => parseManifest(m, "https://docs.example")).toThrow("duplicate");
  });

  test("refuses an unknown side effect", () => {
    const m = manifest();
    (m.capabilities[0] as { side_effects: string }).side_effects = "delete";
    expect(() => parseManifest(m, "https://docs.example")).toThrow(ManifestError);
  });
});
