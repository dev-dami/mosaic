// A model client for the nsdeploy runtime that calls Claude through Anthropic's Messages API with
// the official SDK, from the browser, on the visitor's own key. The runtime's LlmClient speaks the
// OpenAI chat format only; MosaicEngine (engine.ts) puts this client in its place when the router
// is api.anthropic.com. It keeps LlmClient's contract (runner.js runAgentManual): OpenAI-shaped
// messages and tools in, { content, toolCalls, finishReason, usage, model } out.
import Anthropic from "@anthropic-ai/sdk";

export const ANTHROPIC_HOST = "api.anthropic.com";
export const ANTHROPIC_ROUTER = "https://api.anthropic.com";
export const CLAUDE_DEFAULT_MODEL = "claude-opus-5-5";
const MAX_TOKENS = 64000;
/** Models that take the server-side refusal fallback with `fallbacks: "default"`. */
const FALLBACK_MODELS = new Set(["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

/** The OpenAI chat shapes the runtime's runner builds (runner.js runAgentManual). */
export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; name?: string; content: string };
export interface ChatTool {
  type: "function";
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}
export interface ChatResult {
  content: string;
  toolCalls: ChatToolCall[];
  finishReason: string | null;
  usage: Anthropic.Beta.BetaUsage | null;
  model: string | null;
}
interface Trace {
  start(kind: string, fields: Record<string, unknown>): unknown;
  update(span: unknown, fields: Record<string, unknown>): void;
  end(span: unknown, fields: Record<string, unknown>): void;
  fail(span: unknown, err: unknown): void;
}

export function isAnthropicRouter(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).host === ANTHROPIC_HOST;
  } catch {
    return false;
  }
}

// The runner keeps each tool call object it gets back in its message list. Claude's full assistant
// content (thinking blocks included) is kept against the first call, so the next request replays
// that turn unchanged, as preserved thinking requires.
const assistantContent = new WeakMap<object, Anthropic.Beta.BetaContentBlockParam[]>();

/** The runtime's model-name rule (vendor model.js normalizeModelName): trim, drop surrounding quotes. */
export function normalizeModelName(value: unknown): string {
  let model = String(value ?? "").trim();
  while (model.length >= 2 && ((model.startsWith('"') && model.endsWith('"')) || (model.startsWith("'") && model.endsWith("'")))) model = model.slice(1, -1).trim();
  return model;
}

function parseArgs(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { request: raw };
  }
}

function isToolResults(m: Anthropic.Beta.BetaMessageParam): boolean {
  return m.role === "user" && Array.isArray(m.content) && m.content.length > 0 && m.content.every((b) => b.type === "tool_result");
}

/** OpenAI chat messages to a system prompt and Messages API turns. Tool results of one step share one user turn. */
export function toClaudeRequest(messages: ChatMessage[]): { system: string; messages: Anthropic.Beta.BetaMessageParam[] } {
  const system: string[] = [];
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      system.push(m.content);
    } else if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const calls = m.tool_calls ?? [];
      const first = calls[0];
      const kept = first ? assistantContent.get(first) : undefined;
      if (kept) {
        out.push({ role: "assistant", content: kept });
      } else {
        const content: Anthropic.Beta.BetaContentBlockParam[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const c of calls) content.push({ type: "tool_use", id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) });
        if (content.length) out.push({ role: "assistant", content });
      }
    } else {
      const block: Anthropic.Beta.BetaToolResultBlockParam = { type: "tool_result", tool_use_id: m.tool_call_id, content: m.content };
      const last = out[out.length - 1];
      if (last && isToolResults(last)) (last.content as Anthropic.Beta.BetaContentBlockParam[]).push(block);
      else out.push({ role: "user", content: [block] });
    }
  }
  // The runtime trims history to its last entries, which can leave an assistant turn (or the tool
  // results of a dropped one) first. The Messages API needs a user turn first.
  while (out.length && (out[0]!.role === "assistant" || isToolResults(out[0]!))) out.shift();
  return { system: system.join("\n\n"), messages: out };
}

export function toClaudeTools(tools: ChatTool[] | undefined): Anthropic.Beta.BetaTool[] {
  return (tools ?? []).map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    input_schema: (t.function.parameters ?? { type: "object", properties: {} }) as Anthropic.Beta.BetaTool.InputSchema,
  }));
}

const FINISH: Record<string, string> = { end_turn: "stop", tool_use: "tool_calls", max_tokens: "length", stop_sequence: "stop" };

/** A Messages API reply to the runner's result shape. */
export function fromClaudeMessage(msg: Anthropic.Beta.BetaMessage): ChatResult {
  if (msg.stop_reason === "refusal") {
    const why = msg.stop_details?.category ? ` (${msg.stop_details.category})` : "";
    throw new Error(`Claude declined this request${why}. Rephrase the outcome and try again.`);
  }
  let content = "";
  const toolCalls: ChatToolCall[] = [];
  for (const block of msg.content) {
    if (block.type === "text") content += block.text;
    else if (block.type === "tool_use") toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } });
  }
  const first = toolCalls[0];
  if (first) assistantContent.set(first, msg.content as Anthropic.Beta.BetaContentBlockParam[]);
  const finishReason = msg.stop_reason ? (FINISH[msg.stop_reason] ?? msg.stop_reason) : null;
  return { content, toolCalls, finishReason, usage: msg.usage ?? null, model: msg.model ?? null };
}

function friendly(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) return new Error("Anthropic rejected the API key. Open AI model settings and check the key.");
  if (err instanceof Anthropic.PermissionDeniedError) return new Error("This Anthropic key may not use that model.");
  if (err instanceof Anthropic.NotFoundError) return new Error("Anthropic does not know that model. Check the Model field, for example claude-opus-5-5.");
  if (err instanceof Anthropic.RateLimitError) return new Error("Anthropic rate limit reached. Wait a moment and try again.");
  if (err instanceof Anthropic.APIError) return new Error(`Anthropic API error ${err.status ?? ""}: ${err.message}`.trim());
  return err instanceof Error ? err : new Error(String(err));
}

export class ClaudeLlmClient {
  readonly baseUrl: string;
  readonly mock = false;
  private readonly client: Anthropic;

  constructor(private readonly opts: { apiKey: string; trace?: Trace; baseUrl?: string; client?: Anthropic }) {
    this.baseUrl = (opts.baseUrl || ANTHROPIC_ROUTER).replace(/\/$/, "");
    // No baseURL option: the key goes to api.anthropic.com and nowhere else.
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  }

  async chat(args: {
    model: string;
    messages: ChatMessage[];
    tools?: ChatTool[];
    origin?: string;
    parentSpan?: unknown;
    onContentDelta?: (text: string) => void;
    signal?: AbortSignal;
  }): Promise<ChatResult> {
    const { messages, tools, origin, parentSpan, onContentDelta, signal } = args;
    const model = normalizeModelName(args.model);
    if (!this.opts.apiKey || this.opts.apiKey === "demo") {
      throw new Error(`An Anthropic API key is required for ${ANTHROPIC_HOST}. Open AI model settings, paste your key, then select Save and use.`);
    }
    if (!model) throw new Error(`A model is required for ${ANTHROPIC_HOST}. Enter one in AI model settings, for example ${CLAUDE_DEFAULT_MODEL}.`);
    const trace = this.opts.trace;
    const claudeTools = toClaudeTools(tools);
    const span = trace?.start("model_call", {
      parent: parentSpan,
      origin,
      model,
      mock: false,
      routerHost: ANTHROPIC_HOST,
      endpoint: `${this.baseUrl}/v1/messages`,
      keySource: "local BYOK (not shown)",
      toolNames: claudeTools.map((t) => t.name),
    });
    const { system, messages: turns } = toClaudeRequest(messages);
    try {
      const stream = this.client.beta.messages.stream(
        {
          model,
          max_tokens: MAX_TOKENS,
          output_config: { effort: "medium" },
          cache_control: { type: "ephemeral" },
          ...(system ? { system } : {}),
          messages: turns,
          ...(claudeTools.length ? { tools: claudeTools, tool_choice: { type: "auto" as const } } : {}),
          ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        },
        { signal },
      );
      stream.on("text", (delta) => {
        if (signal?.aborted) return;
        onContentDelta?.(delta);
        trace?.update(span, { streamChunk: delta });
      });
      const result = fromClaudeMessage(await stream.finalMessage());
      trace?.end(span, {
        finishReason: result.finishReason,
        contentChars: result.content.length,
        toolCalls: result.toolCalls.map((t) => t.function.name),
        usage: result.usage,
        mock: false,
        verifiedReal: !!result.model,
        respModel: result.model,
        routeKind: "anthropic-messages",
      });
      return result;
    } catch (err) {
      if (signal?.aborted) {
        trace?.end(span, { status: "steered", interrupted: true });
        throw signal.reason ?? new DOMException("Model call aborted", "AbortError");
      }
      const error = friendly(err);
      trace?.fail(span, error);
      throw error;
    }
  }
}
