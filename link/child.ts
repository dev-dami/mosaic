// Run one agent CLI as a child process that dies with the request.

import type { Subprocess } from "bun";

export class StepError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

/**
 * Kill a child: SIGTERM now, SIGKILL if it is still alive after a grace period.
 *
 * :param proc: The child.
 * :param graceMs: How long to wait before SIGKILL.
 */
export function killChild(proc: Subprocess, graceMs = 2000): void {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  try {
    proc.kill("SIGTERM");
  } catch {
    return;
  }
  const t = setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }, graceMs);
  proc.exited.finally(() => clearTimeout(t));
}

/**
 * Tie a child's life to a signal: abort kills it.
 *
 * :param proc: The child.
 * :param signal: The request's signal (client gone, or timeout).
 * :return: A function that unties them.
 */
export function bindAbort(proc: Subprocess, signal: AbortSignal): () => void {
  const onAbort = () => killChild(proc);
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

export function abortError(signal: AbortSignal): StepError {
  const reason = signal.reason as { name?: string } | undefined;
  if (reason?.name === "TimeoutError") return new StepError("the local agent did not answer in time", 504);
  return new StepError("the request was cancelled", 499);
}

/**
 * Run a command with stdin text and collect stdout; the signal kills it.
 *
 * :param cmd: argv.
 * :param opts: cwd, env, stdin text and the abort signal.
 * :return: Exit code, stdout and the last part of stderr.
 */
export async function runOnce(
  cmd: string[],
  opts: { cwd: string; env: Record<string, string | undefined>; stdin: string; signal: AbortSignal },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  let proc: Subprocess<"pipe", "pipe", "pipe">;
  try {
    proc = Bun.spawn(cmd, { cwd: opts.cwd, env: opts.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  } catch (err) {
    throw new StepError(`could not start ${cmd[0]}: ${(err as Error).message}. Is it installed and on PATH?`);
  }
  const unbind = bindAbort(proc, opts.signal);
  try {
    proc.stdin.write(opts.stdin);
    await proc.stdin.end();
  } catch {
    /* the child may exit before reading stdin; its exit code tells */
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  unbind();
  if (opts.signal.aborted) throw abortError(opts.signal);
  return { code, stdout, stderr: stderr.slice(-400) };
}
