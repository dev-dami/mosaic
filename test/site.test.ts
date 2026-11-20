import { describe, expect, test } from "bun:test";
import { releasesSite } from "../providers/releases";
import { createSite } from "../providers/site";

const origin = "http://localhost:4102";
const call = (site: ReturnType<typeof createSite>, id: string, body: unknown, from = origin) =>
  site.handleApi(new Request(`${origin}/api/capabilities/${id}`, { method: "POST", headers: { origin: from }, body: JSON.stringify(body) }), id);

describe("site API", () => {
  test("refuses a caller from another origin", async () => {
    const site = createSite(releasesSite, origin, ["http://localhost:4000"]);
    const res = await call(site, "publish-release", { version: "v1", notes: "x" }, "http://localhost:4000");
    expect(res.status).toBe(403);
    expect(site.activity).toHaveLength(0);
  });

  test("refuses input that does not match the capability schema", async () => {
    const site = createSite(releasesSite, origin, []);
    expect((await call(site, "draft-changelog", { version: "v1" })).status).toBe(400);
  });

  test("records writes in the activity log and not reads", async () => {
    const site = createSite(releasesSite, origin, []);
    expect((await call(site, "draft-changelog", { version: "v1", highlights: ["a"] })).status).toBe(200);
    expect(site.activity).toHaveLength(0);
    const res = await call(site, "publish-release", { version: "v1", notes: "x" });
    expect(await res.json()).toMatchObject({ version: "v1", url: "/releases/v1" });
    expect(site.activity.map((a) => a.capability)).toEqual(["publish-release"]);
  });

  test("the published files omit the server-side run functions", () => {
    const site = createSite(releasesSite, origin, []);
    expect(site.bridgeConfig.capabilities.some((c) => "run" in c)).toBe(false);
  });
});
