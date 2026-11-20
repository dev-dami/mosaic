import { serveSite, type SiteDefinition } from "./site";

// Foreman: a fictional service that runs coding agents on your own servers. "Plan fix" reads an
// issue and writes the agent's task, a branch, a summary of the change and a reply for whoever
// reported it; "Send agent to fix" starts the agent on one of your servers.

type Server = { name: string; region: string; hardware: string; status: "idle" | "busy"; agents: number };
type Run = { id: string; server: string; branch: string; task: string; started: string };

const servers: Server[] = [
  { name: "gpu-01", region: "home lab", hardware: "1x L40S, 64 GB", status: "idle", agents: 0 },
  { name: "edge-02", region: "Frankfurt", hardware: "8 vCPU, 16 GB", status: "idle", agents: 0 },
  { name: "build-03", region: "Helsinki", hardware: "16 vCPU, 32 GB", status: "busy", agents: 2 },
];
const SERVER_NAMES = servers.map((s) => s.name);
const runs: Run[] = [];
let runNumber = 411;
let pullNumber = 43;

/** What a known kind of bug usually needs. Matched on the issue text; the last entry always matches. */
const PLAYBOOK: { when: RegExp; cause: string; why: string; change: string; result: string; test: string; files: string[] }[] = [
  {
    when: /safari|webkit|ios/i,
    cause: "Safari drops a popup or focus request that starts after an `await`, so the click is lost without an error.",
    why: "Safari ignored the click because the sheet opened a moment too late",
    result: "The Connect button now opens the site's sheet on the first click in Safari.",
    change: "Open the site's sheet inside the click handler, before the first `await`, and show a retry hint if the browser blocks it.",
    test: "Add a WebKit run of the connect flow to the browser test.",
    files: ["src/host/entry/palette.tsx", "src/host/bridge-client.ts", "e2e/mosaic.e2e.cjs"],
  },
  {
    when: /narrow|mobile|overlap|layout/i,
    cause: "The layout assumes a wide window.",
    why: "the layout assumed a wide window",
    result: "It now fits narrow screens.",
    change: "Stack the parts below the breakpoint and keep the hit areas 44px.",
    test: "Add a 390px-wide screenshot check.",
    files: ["src/host/shell.css"],
  },
  {
    when: /./,
    cause: "Not known yet; the agent reproduces it first.",
    why: "I could reproduce it",
    result: "It no longer happens, and a test keeps it that way.",
    change: "Write a failing test from the report, then make the smallest change that passes it.",
    test: "Keep the new test in the suite.",
    files: [],
  },
];

const FILLER = new Set("a an the is are does do did not nothing on in of to when with after for it".split(" "));
/** "Connect button does nothing on Safari" → "connect-button-safari". */
const slug = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !FILLER.has(w))
    .slice(0, 4)
    .join("-");

/** The issue's title line ("## #43 Connect button…") and milestone, if the issue carries them. */
function readIssue(issue: string): { title: string; ref: string; milestone?: string; reporter?: string } {
  const head = issue.match(/^#{1,6}\s*(#\d+)?\s*(.+)$/m);
  const title = (head?.[2] ?? issue.split("\n").find((l) => l.trim()) ?? "the bug").trim();
  return {
    title,
    ref: head?.[1] ?? "",
    milestone: issue.match(/Milestone:\s*(v[\d.]+)/i)?.[1],
    reporter: issue.match(/Reported by (@[\w.]+)/i)?.[1],
  };
}

export const agentsSite: SiteDefinition = {
  name: "Foreman",
  description: "A fictional agent runner. It plans fixes and starts coding agents on your own servers.",
  port: 4107,
  look: { scheme: "dark", accent: "#c98a00", font: "sans" },
  capabilities: [
    {
      id: "list-servers",
      title: "List servers",
      description: "List your servers and what is running on them.",
      side_effects: "read",
      input_schema: { type: "object", properties: {} },
      output_schema: { type: "object", properties: { servers: { type: "array" } } },
      run: () => ({ servers: servers.map((s) => ({ server: s.name, where: s.region, hardware: s.hardware, status: s.status, agents: s.agents })) }),
    },
    {
      id: "plan-fix",
      title: "Plan fix",
      description: "Read an issue and plan the fix: the agent's task, a branch, and a summary of the change. Starts nothing.",
      side_effects: "read",
      input_schema: {
        type: "object",
        required: ["issue"],
        properties: { issue: { type: "string", title: "Issue", "x-mosaic-widget": "textarea" } },
      },
      output_schema: {
        type: "object",
        properties: {
          plan: { type: "string" },
          task: { type: "string" },
          branch: { type: "string" },
          summary: { type: "string" },
          reply: { type: "string" },
        },
      },
      run: (input: { issue: string }) => {
        const { title, ref, milestone, reporter } = readIssue(input.issue);
        const play = PLAYBOOK.find((p) => p.when.test(input.issue))!;
        const branch = `fix/${slug(title)}`;
        const shipsIn = milestone ? ` in ${milestone}` : "";
        const plan = [
          `## Plan for ${ref ? `${ref} ` : ""}${title}`,
          "",
          `- Reproduce: ${/safari/i.test(input.issue) ? "Safari 18 on the demo sites" : "from the steps in the issue"}`,
          `- Cause: ${play.cause}`,
          `- Change: ${play.change}`,
          `- Test: ${play.test}`,
          ...(play.files.length ? [`- Files: ${play.files.map((f) => `\`${f}\``).join(", ")}`] : []),
          `- Open a pull request from \`${branch}\``,
        ].join("\n");
        const task = `Fix ${ref ? `${ref}: ` : ""}${title}. ${play.change.replace(/`/g, "")} ${play.test} Open a pull request from ${branch} when the tests pass.`;
        const summary = `Fixed ${ref ? `${ref} ` : ""}“${title}”. ${play.result}${reporter ? ` Thanks to ${reporter} for the report.` : ""}`;
        const reply = `Thanks${reporter ? ` ${reporter}` : ""}, you found a real bug: ${play.why}. The fix is on its way${shipsIn}.`;
        return { plan, task, branch, summary, reply };
      },
    },
    {
      id: "send-agent",
      title: "Send agent to fix",
      description: "Start a coding agent on one of your servers. It works on a branch and opens a pull request.",
      side_effects: "write",
      input_schema: {
        type: "object",
        required: ["task", "server", "branch"],
        properties: {
          task: { type: "string", title: "Task", "x-mosaic-widget": "textarea" },
          server: { type: "string", title: "Server", enum: SERVER_NAMES, default: "gpu-01" },
          branch: { type: "string", title: "Branch" },
        },
      },
      output_schema: {
        type: "object",
        properties: {
          run_id: { type: "string" },
          status: { type: "string" },
          server: { type: "string" },
          pull_request: { type: "string" },
          pr_url: { type: "string" },
          log_url: { type: "string" },
        },
      },
      run: (input: { task: string; server: string; branch: string }) => {
        runNumber += 1;
        pullNumber += 1;
        const id = `run-${runNumber}`;
        runs.unshift({ id, server: input.server, branch: input.branch, task: input.task, started: new Date().toISOString() });
        const server = servers.find((s) => s.name === input.server);
        if (server) {
          server.agents += 1;
          server.status = "busy";
        }
        return {
          run_id: id,
          status: `running on ${input.server}`,
          server: input.server,
          pull_request: `#${pullNumber} from ${input.branch} (draft until tests pass)`,
          pr_url: `/runs/${id}/pull-request`,
          log_url: `/runs/${id}/log`,
        };
      },
    },
  ],
};

if (import.meta.main) serveSite(agentsSite);
