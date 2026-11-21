import { expect, test } from "bun:test";
import { agentsSite, checkRun, RUN_SECONDS } from "../providers/agents";

const cap = (id: string) => agentsSite.capabilities.find((c) => c.id === id)!;

test("a run is running until RUN_SECONDS pass, then its tests pass and its pull request is merged", () => {
  const sent = cap("send-agent").run({ task: "Fix #43", server: "gpu-01", branch: "fix/connect-button-safari" }) as { run_id: string; pull_request: string };
  const started = Date.now();
  const early = checkRun(sent.run_id, started + 1000);
  expect(early.merged).toBe(false);
  expect(early.status).toBe("running on gpu-01");
  const late = checkRun(sent.run_id, started + (RUN_SECONDS + 1) * 1000);
  expect(late).toMatchObject({ status: "done", merged: true, tests: "12 of 12 passed", branch: "fix/connect-button-safari" });
  expect(late.pull_request).toBe(`${sent.pull_request.split(" ")[0]} merged into main`);
});

test("a run this server never started (another instance) counts as done, with the pull request its id implies", () => {
  expect(checkRun("run-900")).toMatchObject({ status: "done", merged: true, pull_request: "#532 merged into main" });
});

test("check-run refuses anything that is not a run id", () => {
  expect(() => checkRun("issue 43")).toThrow(/not a run id/);
  expect(cap("check-run").side_effects).toBe("read");
});
