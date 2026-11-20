// The site's actions for the nsdeploy action bridge (MVP profile 0.3). Built for the browser and
// served at /bridge/bridge-actions.js; bridge/agent-manifest.json names it, and the vendored
// runtime's serveActionBridge imports it inside /bridge/action-bridge.html on the site's origin.
//
// One action per capability. Reads run in the hidden frame a caller embeds. Writes are
// "irreversible": the runtime runs them only in a popup on this origin, and confirmsInWindow
// hands the confirmation to this module, which shows the site's own sheet (sheet.ts) with the
// Approve delay. Who may call is the runtime's job (callerOrigins = the site's Mosaic hosts);
// every call still goes through the site's API, which refuses other origins and logs writes.
import type { JsonSchema } from "../src/protocol";
import { renderPrompt, renderStatus } from "./sheet";
import type { BridgeConfig } from "./site";

type CapabilityInfo = BridgeConfig["capabilities"][number];
type StatusKind = "working" | "done" | "denied" | "failed";

/**
 * Approve stays disabled this long after the sheet appears, so a click aimed at the page that
 * opened the window cannot land on it. Applied here, not in sheet.ts, so restyling cannot weaken it.
 */
export const APPROVE_DELAY_MS = 700;
/** How long the site's result stays on screen before the runtime closes the window. */
const LINGER_MS = 900;

/** What an action needs from its surroundings; the browser versions are below, tests pass stubs. */
export type ActionDeps = {
  post: (id: string, args: unknown) => Promise<{ ok: boolean; body: unknown }>;
  ask: (capability: CapabilityInfo, args: unknown, callerOrigin: string) => Promise<boolean>;
  /** Shows the site's progress or result; for a result it resolves once the person has seen it. */
  status: (kind: StatusKind, message: string, sub: string) => void | Promise<void>;
};

type ActionsFacade = { register: (definition: object) => unknown };
type Context = { callerOrigin?: string } | undefined;

const errorOf = (body: unknown, fallback: string) => {
  const e = (body as { error?: unknown } | null)?.error;
  return typeof e === "string" && e ? e : fallback;
};

/** A write's result also carries ok and, when it did not happen, the site's reason. */
function writeOutput(schema: JsonSchema): JsonSchema {
  return { ...schema, properties: { ...schema.properties, ok: { type: "boolean" }, reason: { type: "string" } } };
}

function definition(config: BridgeConfig, cap: CapabilityInfo, deps: ActionDeps) {
  const common = {
    name: cap.id,
    description: cap.description,
    // The title rides in the schema's own "title", so a caller can name the step (catalog() has no title field).
    inputSchema: { ...cap.input_schema, title: cap.title },
    availability: "bridge",
    callerOrigins: config.allowed_hosts,
  };
  if (cap.side_effects === "read") {
    return {
      ...common,
      effect: "read",
      outputSchema: cap.output_schema,
      execute: async (args: unknown) => {
        const res = await deps.post(cap.id, args);
        if (!res.ok) throw new Error(errorOf(res.body, `${config.site} refused ${cap.title}.`));
        return res.body;
      },
    };
  }
  return {
    ...common,
    effect: "irreversible",
    confirmsInWindow: true,
    outputSchema: writeOutput(cap.output_schema),
    execute: async (args: unknown, context: Context) => {
      if (!(await deps.ask(cap, args, context?.callerOrigin ?? "about:blank"))) {
        await deps.status("denied", "Denied", `Nothing was sent to ${config.site}.`);
        return { ok: false, reason: "denied" };
      }
      deps.status("working", `${cap.title}…`, `${config.site} is doing this now.`);
      // A network failure here may still have reached the site: it throws, and the caller
      // reports the outcome as unknown instead of retrying.
      const res = await deps.post(cap.id, args);
      if (!res.ok) {
        const reason = errorOf(res.body, `${config.site} did not do this.`);
        await deps.status("failed", "Did not go through", reason);
        return { ok: false, reason };
      }
      await deps.status("done", "Done", `${cap.title} on ${config.site}.`);
      return { ok: true, ...(res.body as object) };
    },
  };
}

export function registerSiteActions(actions: ActionsFacade, config: BridgeConfig, deps: ActionDeps = browserDeps(config)) {
  for (const cap of config.capabilities) actions.register(definition(config, cap, deps));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function rootElement(): HTMLElement {
  let root = document.getElementById("root");
  if (!root) document.body.append((root = Object.assign(document.createElement("div"), { id: "root" })));
  return root;
}

/** The browser side: the site's API on this origin, and the site's own sheet in this window. */
export function browserDeps(config: BridgeConfig): ActionDeps {
  return {
    post: async (id, args) => {
      const res = await fetch(`/api/capabilities/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(20_000),
      });
      return { ok: res.ok, body: await res.json().catch(() => ({ error: `HTTP ${res.status}` })) };
    },
    ask: (cap, args, callerOrigin) =>
      new Promise((resolve) => {
        document.title = `${cap.title} · ${config.site}`;
        const { approve, deny } = renderPrompt(rootElement(), config, callerOrigin, cap, args);
        approve.disabled = true;
        setTimeout(() => (approve.disabled = false), APPROVE_DELAY_MS);
        deny.onclick = () => resolve(false);
        approve.onclick = () => resolve(true);
      }),
    // The runtime closes the window once execute returns, so a result stays up a moment first.
    status: (kind, message, sub) => {
      renderStatus(rootElement(), config, kind, message, sub);
      return kind === "working" ? undefined : sleep(LINGER_MS);
    },
  };
}

/** The bridge calls this export. The config comes from this site, next to this module. */
export async function registerActions(actions: ActionsFacade) {
  const res = await fetch(new URL("./bridge-config.json", import.meta.url));
  if (!res.ok) throw new Error(`Cannot load the bridge config (HTTP ${res.status}).`);
  registerSiteActions(actions, (await res.json()) as BridgeConfig);
}
