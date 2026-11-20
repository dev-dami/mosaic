// The model routers the AI model dialog offers. Each fills the form; the person can still edit
// every field. The key is sent only to the router's host (Mosaic Link: a bridge on this computer).
import { ANTHROPIC_ROUTER, CLAUDE_DEFAULT_MODEL } from "./claude-client";
import { DEFAULT_MODEL, OTARI_ROUTER } from "./network";

/** Mosaic Link (link/, `bun run link`): runs Claude Code or Codex on the visitor's own computer. */
export const LINK_PORT = 4199;
export const LINK_ROUTER = `http://127.0.0.1:${LINK_PORT}/v1`;
/** The page reaches the bridge by either loopback name. The host CSP allows both. */
export const LINK_ORIGINS = [`http://127.0.0.1:${LINK_PORT}`, `http://localhost:${LINK_PORT}`];

export interface RouterPreset {
  id: "otari" | "openai" | "claude" | "local";
  label: string;
  name: string;
  router: string;
  model: string;
  keyHint: string;
  note: string;
}

export const ROUTER_PRESETS: RouterPreset[] = [
  { id: "otari", label: "Otari", name: "Otari", router: OTARI_ROUTER, model: DEFAULT_MODEL, keyHint: "otk_…", note: "One key for many models." },
  { id: "openai", label: "OpenAI", name: "OpenAI", router: "https://api.openai.com/v1", model: "gpt-5", keyHint: "sk-…", note: "Your OpenAI API key. Enter a model your account can use." },
  { id: "claude", label: "Claude", name: "Claude", router: ANTHROPIC_ROUTER, model: CLAUDE_DEFAULT_MODEL, keyHint: "sk-ant-…", note: "Your Anthropic API key. Mosaic calls Claude's Messages API directly." },
  {
    id: "local",
    label: "Agent on this computer",
    name: "Claude Code (local)",
    router: LINK_ROUTER,
    model: "claude-code",
    keyHint: "token from bun run link",
    note: "Run bun run link on this computer, then paste the token it prints. Models: claude-code, codex, claude-code-acp, codex-acp. Uses your Claude Code or Codex sign-in, so no API key.",
  },
];
