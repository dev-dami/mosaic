// A minimal Agent Client Protocol (ACP) client over stdio: newline-delimited JSON-RPC 2.0.
// Protocol version 1, per the stable schema in @agentclientprotocol/sdk (schema/v1/schema.json)
// and https://agentclientprotocol.com/protocol/v1/.
//
// One step = initialize, session/new, (session/set_config_option for a model), session/prompt.
// The client advertises no fs and no terminal capability, passes no MCP servers, rejects
// every session/request_permission, and answers any other agent request with "method not found".

import type { Subprocess } from "bun";
import { abortError, killChild, StepError } from "./child.ts";
import type { StepInput } from "./backends.ts";

export const ACP_PROTOCOL_VERSION = 1;

type RpcMessage = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: any;
  result?: any;
  error?: { code?: number; message?: string };
};

type PermissionOption = { optionId?: string; kind?: string };

/**
 * Choose the answer to session/request_permission: a reject option when the agent offers
 * one, else "cancelled". Never an allow option.
 *
 * :param options: The options from the request.
 * :return: The RequestPermissionResponse result.
 */
export function rejectPermission(options: PermissionOption[] | undefined): { outcome: { outcome: string; optionId?: string } } {
  const reject = (options || []).find((o) => o.kind === "reject_once") || (options || []).find((o) => o.kind === "reject_always");
  return reject?.optionId ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
}

class AcpConnection {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private buf = "";
  private closed: Error | null = null;
  text = "";
  sessionId = "";

  constructor(private proc: Subprocess<"pipe", "pipe", "ignore">) {
    void this.readLoop();
    void proc.exited.then((code) => this.fail(new StepError(`the ACP agent exited (code ${code})`)));
  }

  private async readLoop() {
    const dec = new TextDecoder();
    try {
      for await (const chunk of this.proc.stdout) {
        this.buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = this.buf.indexOf("\n")) >= 0) {
          const line = this.buf.slice(0, nl).trim();
          this.buf = this.buf.slice(nl + 1);
          if (!line) continue;
          let msg: RpcMessage;
          try {
            msg = JSON.parse(line);
          } catch {
            continue; // not protocol traffic
          }
          this.handle(msg);
        }
      }
    } catch {
      /* stream closed */
    }
  }

  private fail(err: Error) {
    if (this.closed) return;
    this.closed = err;
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private send(msg: RpcMessage) {
    if (this.closed) return;
    try {
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
      void this.proc.stdin.flush();
    } catch (err) {
      this.fail(new StepError(`could not write to the ACP agent: ${(err as Error).message}`));
    }
  }

  private handle(msg: RpcMessage) {
    if (msg.method && msg.id !== undefined && msg.id !== null) {
      // A request from the agent to the client.
      if (msg.method === "session/request_permission") {
        this.send({ id: msg.id, result: rejectPermission(msg.params?.options) });
      } else {
        this.send({ id: msg.id, error: { code: -32601, message: `Mosaic Link does not offer ${msg.method}` } });
      }
      return;
    }
    if (msg.method) {
      // A notification from the agent.
      if (msg.method === "session/update" && msg.params?.sessionId === this.sessionId) {
        const u = msg.params.update;
        if (u?.sessionUpdate === "agent_message_chunk" && u.content?.type === "text" && typeof u.content.text === "string") {
          this.text += u.content.text;
        }
      }
      return;
    }
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new StepError(`ACP agent error: ${msg.error.message || msg.error.code}`));
      else p.resolve(msg.result);
    }
  }

  request(method: string, params: unknown): Promise<any> {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }

  notify(method: string, params: unknown) {
    this.send({ method, params });
  }
}

/**
 * Ask an ACP agent for one step.
 *
 * :param cmd: argv of the ACP agent (e.g. ["claude-agent-acp"]).
 * :param input: The rendered prompt, cwd, env and signal.
 * :return: The agent's final message text.
 */
export async function runAcpStep(cmd: string[], input: StepInput): Promise<string> {
  let proc: Subprocess<"pipe", "pipe", "ignore">;
  try {
    proc = Bun.spawn(cmd, { cwd: input.cwd, env: input.env, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  } catch (err) {
    throw new StepError(`could not start ${cmd[0]}: ${(err as Error).message}. Is it installed and on PATH?`);
  }
  const conn = new AcpConnection(proc);
  // On abort: ask the agent to cancel (spec: session/cancel), then kill it shortly after.
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => {
    if (conn.sessionId) conn.notify("session/cancel", { sessionId: conn.sessionId });
    killTimer = setTimeout(() => killChild(proc), conn.sessionId ? 500 : 0);
  };
  if (input.signal.aborted) onAbort();
  else input.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const init = await conn.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "mosaic-link", version: "0.1.0" },
    });
    if (init?.protocolVersion !== ACP_PROTOCOL_VERSION) {
      throw new StepError(`the ACP agent speaks protocol ${init?.protocolVersion}, Mosaic Link speaks ${ACP_PROTOCOL_VERSION}`);
    }
    const session = await conn.request("session/new", { cwd: input.cwd, mcpServers: [] });
    if (typeof session?.sessionId !== "string") throw new StepError("the ACP agent returned no session id");
    conn.sessionId = session.sessionId;
    if (input.model) {
      const opt = (session.configOptions || []).find((o: { category?: string }) => o?.category === "model");
      if (!opt?.id) throw new StepError("this ACP agent offers no model option; drop the /model suffix", 400);
      await conn.request("session/set_config_option", { sessionId: conn.sessionId, configId: opt.id, value: input.model });
    }
    // session/new takes a systemPrompt only when the agent advertises it, so the
    // instructions lead the prompt instead.
    const text = `<instructions>\n${input.system}\n</instructions>\n\n${input.prompt}`;
    const res = await conn.request("session/prompt", { sessionId: conn.sessionId, prompt: [{ type: "text", text }] });
    if (res?.stopReason !== "end_turn") throw new StepError(`the ACP agent stopped: ${res?.stopReason}`);
    return conn.text;
  } catch (err) {
    if (input.signal.aborted) throw abortError(input.signal);
    throw err;
  } finally {
    input.signal.removeEventListener("abort", onAbort);
    clearTimeout(killTimer);
    killChild(proc);
  }
}
