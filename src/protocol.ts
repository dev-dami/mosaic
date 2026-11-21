// The capability authoring shape: how a demo site (providers/*.ts) and Scout's adapters describe
// what they can do. Sites publish these as nsdeploy bridge actions (providers/bridge-actions.ts,
// MVP Profile 0.3); the host reads them back from the runtime's registry (src/host/agentic/catalog.ts).

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
  "x-mosaic-widget"?: "textarea" | "datetime";
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
