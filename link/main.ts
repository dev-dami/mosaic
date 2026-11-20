// `bun run link`: start Mosaic Link on 127.0.0.1. `bun run link --rotate` makes a new token.

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { startLink } from "./server.ts";

export const TOKEN_FILE = join(homedir(), ".config", "mosaic", "link-token");

/**
 * Read the pairing token, or write a new random one (0600, in a 0700 directory).
 *
 * :param file: The token file.
 * :param rotate: True to replace an existing token.
 * :return: The token.
 */
export async function loadToken(file: string, rotate: boolean): Promise<string> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  if (!rotate) {
    const existing = (await readFile(file, "utf8").catch(() => "")).trim();
    if (/^mlk_[A-Za-z0-9_-]{40,}$/.test(existing)) {
      await chmod(file, 0o600);
      return existing;
    }
  }
  const token = "mlk_" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  await writeFile(file, token + "\n", { mode: 0o600 });
  await chmod(file, 0o600);
  return token;
}

if (import.meta.main) {
  const port = Number(process.env.MOSAIC_LINK_PORT || 4199);
  const origins = (process.env.MOSAIC_LINK_ORIGINS || "http://localhost:4000").split(",").map((s) => s.trim()).filter(Boolean);
  const token = await loadToken(TOKEN_FILE, process.argv.includes("--rotate"));
  startLink({ port, token, origins });
  console.log(`Mosaic Link on http://127.0.0.1:${port}/v1`);
  console.log(`Allowed origins: ${origins.join(", ")}`);
  console.log(`Pairing token (also in ${TOKEN_FILE}):\n  ${token}`);
  console.log("In Mosaic's model settings: router http://127.0.0.1:" + port + "/v1, key = the token, model claude-code (or codex, claude-code-acp, codex-acp).");
}
