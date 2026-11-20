# Demo script: the bug in the comments

The video for the Devpost form. It must be under 2 minutes, public on YouTube, and show Mosaic running
in a browser. Judges may stop at 2:00, so this script ends at 1:52. It uses the live public URLs.

Story: a viewer reports a bug under a video. Mosaic's agent turns it into an issue, a fix and a post,
across four sites. Each site approves its own write. Then Mosaic connects a site it has never seen, and
Scout agentifies a forum that publishes nothing.

## Live URLs

Fill these after the deploy (card C13b). The names below are the suggested Vercel projects in
[deploy.md](deploy.md).

| Name in this script | URL |
|---|---|
| Mosaic | `TODO(verify): https://mosaic-host.vercel.app` |
| Reelhouse | `TODO(verify): https://mosaic-videos.vercel.app` |
| Patchbay | `TODO(verify): https://mosaic-issues.vercel.app` |
| Foreman | `TODO(verify): https://mosaic-agents.vercel.app` |
| Loudhailer | `TODO(verify): https://mosaic-announcer.vercel.app` |
| Inkpost | `TODO(verify): https://mosaic-newsletter.vercel.app/inkpost` |
| Corkboard | `TODO(verify): https://mosaic-corkboard.vercel.app` |
| Repository | `TODO(verify): repository URL, public before the submission` |

## Before you record

- Use a 1440x900 browser window, light theme, zoom 110 %. Hide bookmarks and other tabs.
- Redeploy or wait for a cold start, so the sites show their seed data. State lives in memory. A
  site that kept state from a rehearsal shows higher numbers (issue #44 and up).
- Open **AI model** and save a profile before you record: router empty (Otari) or your own router, a
  model, and your key. Never show the key on camera. Close the dialog.
- Rehearse the turn once with the exact outcome below. A real model can choose other steps.
  `TODO(verify): the full chain runs on Otari with the default model. If it does not, pick another
  model in the profile, or shorten the outcome to three sites.`
- Delete Scout's saved template for Corkboard, so Scout learns it on camera.
  `TODO(verify): the public Scout URL behind Caddy. If Scout is not public, record that beat on
  localhost and say so in the caption.`
- **Consent dialogs.** Mosaic asks before it contacts each new origin. On camera, click **Always allow
  <site>** on each dialog. Each one costs about one second, and then that origin does not ask again in
  this session. To save more time, show the first dialog and cut the next ones in the edit.
- Write popups: allow popups for the Mosaic origin in the browser before you record.

## Shot list (1:52)

| Time | Shot | Do | Say (voice-over) |
|---|---|---|---|
| 0:00-0:15 | The problem, and the outcome typed | Mosaic, empty workspace. Click the outcome box and type **Fix the bug in Mosaic from my comments and post the fix**. | "Each website now publishes its own agents. But my work crosses four sites: my videos, my issues, my build servers, my posts. Today I am the glue. So I type the outcome once." |
| 0:15-0:23 | AI model settings | Click **AI model**. Hold on the profile line and on "Your key is sent only to api.otari.ai. Mosaic and the sites you connect never see it." Close. | "It runs on my own model key. The key goes only to my router. Not to Mosaic, and not to the sites." |
| 0:23-0:30 | The turn starts | Click **Run with the agent**. The first consent dialog names Reelhouse's origin. Click **Always allow**. | "Before Mosaic contacts a site, it asks me, and it names the site." |
| 0:30-0:48 | The agent works across sites | The runbook fills: a Reelhouse step with its site chip, the `find-bug-reports` card with its input and output (the Safari bug, comment c-2042), then "Mosaic · composer" drafts the issue, then the Patchbay step. Allow each new site. | "Mosaic's network runs right here in my browser. It loads each site's published agent network and runs it on my model. It finds the bug report and drafts the issue." |
| 0:48-1:05 | A write, approved on the site's own sheet | The Patchbay card says **Waiting for approval**. Click **Open Patchbay to approve**. Patchbay's own window opens with its own sheet: the title and the description from the comment. Wait for the Approve fill, then click **Approve**. The card says **Published**, issue #43. | "Writes never run on Mosaic's page. Patchbay shows its own sheet, on its own site. The site owns consent, not the agent." |
| 1:05-1:12 | The rest of the chain | Approve Foreman's **Send agent to fix** and Loudhailer's **Schedule announcement** the same way. Speed up 2x or cut to the receipts. Hold on the summary. | "Same for the fix and the post. Four sites, one outcome, nothing copied." |
| 1:12-1:27 | A site Mosaic has never seen | Press Ctrl K. Paste the Inkpost URL. Allow the consent dialog. "+2 capabilities from Inkpost" appears. Point at **Mosaic unchanged** in the top bar. | "Inkpost is a newsletter Mosaic has never seen. I paste its URL. Mosaic loads the network by its exact name. No code changed." |
| 1:27-1:42 | Scout learns Corkboard | Press Ctrl K. Paste the Corkboard URL. Mosaic refuses it: no manifest. Click **Teach Scout this site**. After a few seconds: "Scout learned 5 skills". The step has a dashed **Scout** tag. | "Corkboard publishes nothing. Scout opens it in a browser, learns its pages, checks every read by running it, and publishes a conformant agent network for it." |
| 1:42-1:52 | End card | Static card, see below. | "Mosaic. One outcome, many sites, your key, and every site approves its own writes." |

`TODO(verify): the Scout skill count on the live Corkboard. The rules learner finds 5 skills locally.`

### End card (10 s)

> **Mosaic**
> One outcome. Many sites' agent networks, run in your browser on your own key.
> Every write approved on the site's own sheet.
> Built on the agentic-web MVP spec 0.3 and the nsdeploy runtime.
> REPOSITORY URL · LIVE DEMO URL

## Optional cuts

Use these to replace a beat, or in a longer cut that is not the submission video.

- **Wrong name fails closed (5 s).** Paste `<Pagewright URL>/wrongname`. The palette says the site
  has no network named "wrongname" and adds nothing.
- **Deny a write (6 s).** On a site's sheet, click **Deny**. The card says **Denied**, and nothing
  reaches the site.
- **The reply to the viewer (8 s).** Approve Reelhouse's **Reply to comment**. The receipt links to the
  reply under the video.
- **Manual mode (8 s).** Delete or deselect the profile. The outcome line says "Manual mode. No key, so
  Mosaic plans the steps by keyword". The runbook still plans the steps, with no model call.
- **Recipe link (8 s).** Ctrl K, **Copy recipe link**. Open the link in a new window. The outcome and
  the sites come back, and each site asks for consent again. The link holds no key.
- **Scout's write (12 s).** In the Corkboard step, reply to thread 1. **Open Corkboard to approve**
  shows Scout's sheet: "Scout will do this in a browser on <Corkboard host>. <Corkboard host> did not
  publish this action." Approve, then open the thread: the reply is there.

## Local rehearsal

`bun run dev` serves the same flow on localhost: Mosaic on :4000, Reelhouse :4105, Patchbay :4106,
Foreman :4107, Loudhailer :4103, Inkpost :4104, Scout :4108, Corkboard :4109. Restart it before each
take, so the issue is #43 and the agent run is run-412. Delete `.scout/` so that Scout learns
Corkboard again.

## If something looks off

- The model skips a site or stops early: rehearse with the same model, or shorten the outcome. Every
  stop shows a visible problem step. Read it, then run again.
- No "Open <site> to approve" button: the turn has not reached the write yet, or the site refused the
  input. Look at the card's output.
- Numbers higher than #43: a site kept state from an earlier take. Redeploy or wait for a cold start.
- Corkboard is under "Learned by Scout" before you teach it: Scout kept its template. Delete it and
  restart Scout.
