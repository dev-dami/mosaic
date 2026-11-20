import { afterAll, describe, expect, test } from "bun:test";
import { docsSite } from "../providers/docs";
import { serveSite } from "../providers/site";
import { runtimeFile } from "../src/runtime-files";

const isJs = (res: Response) => /^(text|application)\/javascript/.test(res.headers.get("content-type") ?? "");

describe("vendored nsdeploy runtime", () => {
  test("serves runtime modules with a JavaScript content type", async () => {
    const res = runtimeFile("/runtime/index.js");
    expect(res.status).toBe(200);
    expect(isJs(res)).toBe(true);
    expect(await res.text()).toContain('export { Engine } from "./engine.js"');
    expect(isJs(runtimeFile("/runtime/langchain-runner.mjs"))).toBe(true);
  });

  test("refuses paths outside the runtime folder and files that are not runtime code", () => {
    expect(runtimeFile("/runtime/../package.json").status).toBe(404);
    expect(runtimeFile("/runtime/%2e%2e/package.json").status).toBe(404);
    expect(runtimeFile("/runtime/VENDOR.md").status).toBe(404);
    expect(runtimeFile("/runtime/nope.js").status).toBe(404);
    expect(runtimeFile("/runtime/").status).toBe(404);
  });

  const site = serveSite(docsSite, { port: 0 });
  afterAll(() => site.stop(true));

  test("every demo site serves /runtime/*", async () => {
    const res = await fetch(new URL("/runtime/engine.js", site.url));
    expect(res.status).toBe(200);
    expect(isJs(res)).toBe(true);
  });

  test("the Mosaic host serves /runtime/*", async () => {
    const port = 4900 + Math.floor(Math.random() * 90);
    const host = Bun.spawn(["bun", "src/host/server.ts"], {
      env: { ...process.env, PORT: String(port) },
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      let res: Response | undefined;
      for (let i = 0; i < 100 && !res; i++) {
        res = await fetch(`http://localhost:${port}/runtime/index.js`).catch(() => undefined);
        if (!res) await Bun.sleep(100);
      }
      expect(res?.status).toBe(200);
      expect(isJs(res!)).toBe(true);
    } finally {
      host.kill();
      await host.exited;
    }
  }, 20_000);
});
