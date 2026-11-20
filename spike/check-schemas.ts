// SPIKE (throwaway, C1/R4): run the vendored runtime's checkSchema over every capability
// schema the demo sites publish today. Run: bun spike/check-schemas.ts
// @ts-expect-error plain JS module without types
import { checkSchema } from "../vendor/nsdeploy-runtime/actions.js";
import { announcerSite } from "../providers/announcer";
import { issuesSite } from "../providers/issues";
import { agentsSite } from "../providers/agents";
import { docsSite } from "../providers/docs";
import { releasesSite } from "../providers/releases";
import { newsletterSite } from "../providers/newsletter";
import { videosSite } from "../providers/videos";

const sites = [docsSite, releasesSite, announcerSite, newsletterSite, videosSite, issuesSite, agentsSite];
let pass = 0;
let fail = 0;
for (const site of sites) {
  for (const cap of site.capabilities) {
    for (const [which, schema] of [["input", cap.input_schema], ["output", cap.output_schema]] as const) {
      if (!schema) continue;
      try {
        checkSchema(schema);
        pass++;
      } catch (e) {
        fail++;
        console.log(`REJECT ${site.name} ${cap.id} ${which}: ${(e as Error).message}`);
      }
    }
  }
}
console.log(`checkSchema: ${pass} accepted, ${fail} rejected`);
