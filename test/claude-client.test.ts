// The Claude model client (card C18): OpenAI-shaped runner messages in, Messages API requests out,
// through the real @anthropic-ai/sdk against a stub fetch that answers with Messages API SSE.
import { describe, expect, test } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import { ClaudeLlmClient, isAnthropicRouter, toClaudeRequest, type ChatMessage, type ChatTool } from "../src/host/agentic/claude-client";

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown } | { type: "thinking"; thinking: string; signature: string };

/** One Messages API reply as the SSE stream the API sends. */
function sse(blocks: Block[], stop: string, extra: Record<string, unknown> = {}): string {
  const ev = (type: string, data: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev("message_start", {
    message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } },
  });
  blocks.forEach((b, index) => {
    if (b.type === "text") {
      out += ev("content_block_start", { index, content_block: { type: "text", text: "" } });
      for (const part of b.text.match(/.{1,4}/g) ?? []) out += ev("content_block_delta", { index, delta: { type: "text_delta", text: part } });
    } else if (b.type === "tool_use") {
      out += ev("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      out += ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    } else {
      out += ev("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
      out += ev("content_block_delta", { index, delta: { type: "thinking_delta", thinking: b.thinking } });
      out += ev("content_block_delta", { index, delta: { type: "signature_delta", signature: b.signature } });
    }
    out += ev("content_block_stop", { index });
  });
  out += ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null, ...extra }, usage: { output_tokens: 5 } });
  return out + ev("message_stop", {});
}

/** A client whose fetch records each request and answers with the next reply. */
function stub(replies: string[]) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const body = replies.shift() ?? "";
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof globalThis.fetch;
  const client = new Anthropic({ apiKey: "sk-test", fetch, maxRetries: 0, dangerouslyAllowBrowser: true });
  return { requests, llm: new ClaudeLlmClient({ apiKey: "sk-test", client }) };
}

const TOOLS: ChatTool[] = [{ type: "function", function: { name: "pagewright", description: "Docs site.", parameters: { type: "object", properties: { request: { type: "string" } } } } }];

describe("Claude client", () => {
  test("a text reply streams and returns the runner's shape", async () => {
    const { llm, requests } = stub([sse([{ type: "text", text: "Hello there" }], "end_turn")]);
    const deltas: string[] = [];
    const res = await llm.chat({
      model: "claude-opus-5-5",
      messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }],
      tools: TOOLS,
      onContentDelta: (t) => deltas.push(t),
    });
    expect(res).toMatchObject({ content: "Hello there", toolCalls: [], finishReason: "stop", model: "claude-opus-5-5" });
    expect(deltas.join("")).toBe("Hello there");
    const req = requests[0]!;
    expect(new URL(req.url).host).toBe("api.anthropic.com");
    expect(req.url).toContain("/v1/messages");
    // This SDK release sends the key as a bearer token, with the browser opt-in header.
    expect(req.headers.get("authorization")).toBe("Bearer sk-test");
    expect(req.headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(req.body).toMatchObject({ model: "claude-opus-5-5", system: "Be brief.", stream: true, fallbacks: "default", messages: [{ role: "user", content: "hi" }] });
    expect(req.body.tools).toEqual([{ name: "pagewright", description: "Docs site.", input_schema: { type: "object", properties: { request: { type: "string" } } } }]);
    expect(req.body).not.toHaveProperty("thinking");
  });

  test("tool calls come back as OpenAI tool_calls, and the next request replays thinking and groups results", async () => {
    const thinking: Block = { type: "thinking", thinking: "", signature: "sig-1" };
    const { llm, requests } = stub([
      sse([thinking, { type: "tool_use", id: "tu_1", name: "pagewright", input: { request: "a" } }, { type: "tool_use", id: "tu_2", name: "pagewright", input: { request: "b" } }], "tool_use"),
      sse([{ type: "text", text: "Done" }], "end_turn"),
    ]);
    const messages: ChatMessage[] = [{ role: "system", content: "S" }, { role: "user", content: "go" }];
    const first = await llm.chat({ model: "claude-opus-5-5", messages, tools: TOOLS });
    expect(first.finishReason).toBe("tool_calls");
    expect(first.toolCalls.map((t) => [t.id, t.function.name, JSON.parse(t.function.arguments)])).toEqual([
      ["tu_1", "pagewright", { request: "a" }],
      ["tu_2", "pagewright", { request: "b" }],
    ]);
    // What runner.js runAgentManual appends after a tool step.
    messages.push({ role: "assistant", content: first.content || null, tool_calls: first.toolCalls });
    messages.push({ role: "tool", tool_call_id: "tu_1", name: "pagewright", content: "A" });
    messages.push({ role: "tool", tool_call_id: "tu_2", name: "pagewright", content: "B" });
    const second = await llm.chat({ model: "claude-opus-5-5", messages, tools: TOOLS });
    expect(second.content).toBe("Done");
    const sent = requests[1]!.body.messages as { role: string; content: { type: string }[] }[];
    expect(sent.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(sent[1]!.content.map((b) => b.type)).toEqual(["thinking", "tool_use", "tool_use"]);
    expect(sent[2]!.content).toEqual([
      { type: "tool_result", tool_use_id: "tu_1", content: "A" },
      { type: "tool_result", tool_use_id: "tu_2", content: "B" },
    ] as never);
  });

  test("a refusal is a visible error, not an empty answer", async () => {
    const { llm } = stub([sse([], "refusal")]);
    await expect(llm.chat({ model: "claude-opus-5-5", messages: [{ role: "user", content: "x" }] })).rejects.toThrow("Claude declined");
  });

  test("no key or no model fails before any request", async () => {
    const { requests } = stub([]);
    const noKey = new ClaudeLlmClient({ apiKey: "" });
    await expect(noKey.chat({ model: "claude-opus-5-5", messages: [] })).rejects.toThrow("Anthropic API key is required");
    const { llm } = stub([]);
    await expect(llm.chat({ model: " ", messages: [] })).rejects.toThrow("A model is required");
    expect(requests.length).toBe(0);
  });

  test("a model without a server-side fallback gets no fallbacks field", async () => {
    const { llm, requests } = stub([sse([{ type: "text", text: "ok" }], "end_turn")]);
    await llm.chat({ model: "claude-haiku-5-5", messages: [{ role: "user", content: "x" }] });
    expect(requests[0]!.body).not.toHaveProperty("fallbacks");
  });

  test("an assistant turn without kept content is rebuilt from its tool calls", () => {
    const { messages } = toClaudeRequest([
      { role: "user", content: "go" },
      { role: "assistant", content: "Checking.", tool_calls: [{ id: "x1", type: "function", function: { name: "t", arguments: '{"a":1}' } }] },
      { role: "tool", tool_call_id: "x1", content: "r" },
      { role: "user", content: "and then?" },
    ]);
    expect(messages).toEqual([
      { role: "user", content: "go" },
      { role: "assistant", content: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "x1", name: "t", input: { a: 1 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "x1", content: "r" }] },
      { role: "user", content: "and then?" },
    ]);
  });

  test("only api.anthropic.com counts as the Anthropic router", () => {
    expect(isAnthropicRouter("https://api.anthropic.com")).toBe(true);
    expect(isAnthropicRouter("https://api.anthropic.com/v1")).toBe(true);
    expect(isAnthropicRouter("https://api.anthropic.com.evil.example")).toBe(false);
    expect(isAnthropicRouter("https://api.openai.com/v1")).toBe(false);
    expect(isAnthropicRouter("not a url")).toBe(false);
  });
});
