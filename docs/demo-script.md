# Demo script: the bug in the comments

A 60 to 90 second recording. One morning of real work: a viewer reports a bug under my video, it
becomes an issue, an agent on my own server fixes it, a post goes out, and the viewer gets a reply.
Four sites, one outcome, no copy and paste.

## Before you record

- Start everything fresh: `bun run dev`. State lives in memory, so restart before each take. Then the
  issue is #43, the agent run is run-412 and the post is post-1 every time.
- Open http://localhost:4000 in a 1440x900 window. Light theme.
- The sites: Reelhouse (videos) on :4105, Patchbay (code issues) on :4106, Foreman (agents on your
  servers) on :4107, Loudhailer (posts) on :4103.
- Every value below comes from the sites. You type only the outcome, four addresses, and "Mosaic".

## The full take (about 80 seconds)

### 1. The outcome (0:00 to 0:06)

- Click the outcome box. Type: **Fix the bug from my comments and post the fix**
- Press Enter. The connect palette opens.

> "Every morning starts the same way: the comments on my latest video."

### 2. Connect four sites (0:06 to 0:18)

In the palette, type `localhost:4105`, press Enter, then Esc. Reelhouse is connected. Then, in this order:

- Ctrl K, `localhost:4106`, Enter, Esc. Patchbay.
- Ctrl K, `localhost:4107`, Enter, Esc. Foreman.
- Ctrl K, `localhost:4103`, Enter, Esc. Loudhailer.

The palette also lists these addresses under "Suggested sites", so you can click them instead.

What appears: four numbered steps, in story order: 1 Reelhouse, 2 Patchbay, 3 Foreman, 4 Loudhailer.
The plan line under the outcome lists them. Each site has its own colour chip.

> "Four sites I already use. Each one tells Mosaic what it can do."

### 3. Name the project (0:18 to 0:21)

- Click the **Project** chip under the outcome. Type **Mosaic**.

> "This is about Mosaic."

### 4. Read the comments (0:21 to 0:31)

- In step 1, click **Run** on **Read comments**. A table of six comments appears.
- Click **Run** on **Find bug reports**. It returns the title **Connect button does nothing on Safari**,
  the body, and comment **c-2042** by **@tomasz_k**.

> "Six comments. One of them is a bug report. On Safari, the connect button does nothing."

### 5. Turn it into an issue (0:31 to 0:39)

- Scroll to step 2. **Preview issue** already shows two tokens: title and description, both from
  Reelhouse. Nobody linked them.
- Click **Run**. The issue appears as **#43**, label bug, milestone **v1.0.1**.

> "I didn't copy anything. The title and the body are already here."

### 6. Plan the fix (0:39 to 0:49)

- Step 3. **Plan fix** takes the issue from Patchbay. Click **Run**.
- The plan appears: cause, change, test, files, and the branch **fix/connect-button-safari**. Under it:
  task, summary and a reply for the viewer.
- Point at the **summary** token at the bottom of the step. A wire draws to step 4.

> "Foreman plans the fix for an agent on one of my own servers."

### 7. Draft the post (0:49 to 0:55)

- Step 4. **Draft announcement** shows: project Mosaic (from the outcome), version from Patchbay,
  release notes from Foreman. Click **Run**.
- The post reads: **Introducing Mosaic v1.0.1.** Fixed #43, with thanks to @tomasz_k.

> "The post writes itself from the fix."

### 8. Approve four changes (0:55 to 1:15)

- Click **Review** in the bar at the bottom (or Ctrl Enter). Four changes are waiting.
- Approve them in story order, each with its own **Approve on ...** button. Each site shows its own
  sheet, in its own style. Wait for the Approve fill, then click Approve.
  1. **File bug**, on Patchbay. The sheet shows the title and the description from the comment.
     Receipt: issue 43, with a link.
  2. **Send agent to fix**, on Foreman. The sheet shows the task, server **gpu-01** and the branch.
     Receipt: **run-412**, running on gpu-01, links to the pull request and the log.
  3. **Schedule announcement**, on Loudhailer. The sheet shows the post. Receipt: **post-1**.
  4. **Reply to comment**, on Reelhouse. The sheet shows comment c-2042 and the reply: "Thanks
     @tomasz_k, you found a real bug..." Receipt: a link to the reply under the video.

> "Every change is approved on the site's own sheet. The issue. The agent. The post. The reply."

### 9. Close (1:15 to 1:22)

- Hold on the finished runbook. The top bar still says **Mosaic unchanged**.

> "The bug report was sitting in my comments the whole time. The missing piece was always in front of us."

## The 30-second cut

Same setup. Type faster, skip Read comments and the hover.

| Time | Do | Say |
|---|---|---|
| 0:00 | Type **Fix the bug from my comments and post the fix**. Enter. | "A viewer found a bug." |
| 0:03 | Connect `localhost:4105`, `4106`, `4107`, `4103` with Ctrl K. Esc. Type **Mosaic** in Project. | "Four sites I already use." |
| 0:10 | Run **Find bug reports**, **Preview issue**, **Plan fix**, **Draft announcement**, top to bottom. | "Comment, issue, fix, post. Nothing copied." |
| 0:18 | Review, then **Send all 4 for approval**. Approve each sheet as it opens. They come in step order: the reply on Reelhouse, the issue on Patchbay, the agent on Foreman, the post on Loudhailer. | "Each site asks me itself." |
| 0:27 | Hold on the finished runbook. | "The missing piece was always in front of us." |

## If something looks off

- A step says it is waiting for another step: run the steps top to bottom.
- Project shows a long phrase: that is read from the outcome. Type **Mosaic** over it (step 3).
- Numbers higher than #43 or run-412: the servers kept state from an earlier take. Restart `bun run dev`.
