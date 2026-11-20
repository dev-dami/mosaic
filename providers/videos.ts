import { serveSite, type SiteDefinition } from "./site";

// Reelhouse: a fictional video host. The owner's channel, its videos and their comments.
// "Find bug reports" picks the comment that reads like a bug and hands on title, body and
// comment_id, so an issue tracker can open it and the reply can go back to the same comment.

type Comment = { id: string; author: string; text: string; likes: number; posted: string; replies: string[] };
type Video = { id: string; title: string; published: string; views: number; comments: Comment[] };

const comment = (id: string, author: string, text: string, likes: number, posted: string): Comment => ({ id, author, text, likes, posted, replies: [] });

const videos: Video[] = [
  {
    id: "v-118",
    title: "Building Mosaic in a weekend",
    published: "2026-11-14",
    views: 18240,
    comments: [
      comment("c-2041", "@lena.codes", "The part where the post wrote itself from the changelog got me. Subscribed.", 214, "2026-11-14"),
      comment("c-2042", "@tomasz_k", "Tried it tonight. The connect button does nothing on Safari 18. I click it, no sheet opens and there is no error in the console. Same page works fine in Chrome.", 87, "2026-11-15"),
      comment("c-2043", "@priya.makes", "What font is the runbook in? It looks great.", 41, "2026-11-15"),
      comment("c-2044", "@hollow_oak", "So it's an automation tool, but the websites do the work? Clever.", 33, "2026-11-16"),
      comment("c-2045", "@nadia.dev", "Would love a part two on the approval sheets.", 29, "2026-11-17"),
      comment("c-2046", "@kwame.builds", "How long did the bridge security take? That's the part I would get wrong.", 18, "2026-11-18"),
    ],
  },
  {
    id: "v-117",
    title: "Why every site should publish a manifest",
    published: "2026-11-02",
    views: 9310,
    comments: [comment("c-1987", "@lena.codes", "Finally someone said it.", 52, "2026-11-03")],
  },
  {
    id: "v-116",
    title: "My desk setup for long build streams",
    published: "2026-10-21",
    views: 22870,
    comments: [comment("c-1902", "@marco.r", "Link to the keyboard?", 12, "2026-10-22")],
  },
];

const VIDEO_TITLES = videos.map((v) => v.title);
const videoNamed = (title: string) => videos.find((v) => v.title === title) ?? videos[0]!;

const BUG_WORDS = /\b(does nothing|doesn't work|does not work|broken|crash(es|ed)?|error|bug|fails?|stuck|blank)\b/i;
const BROWSERS = /\b(Safari|Chrome|Firefox|Edge|iOS|Android)\b/i;

/** "The connect button does nothing on Safari 18." → "Connect button does nothing on Safari". */
function issueTitle(text: string): string {
  const sentence = text.split(/(?<=[.!?])\s+/).find((s) => BUG_WORDS.test(s)) ?? text;
  const browser = text.match(BROWSERS)?.[0];
  let t = sentence.replace(/[.!?]+$/, "").replace(/^(so|and|but|tried it\b[^,.]*[,.]?)\s*/i, "").replace(/^the\s+/i, "");
  if (browser) t = t.replace(new RegExp(`\\s*on ${browser}\\b.*$`, "i"), "") + ` on ${browser}`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const videosSite: SiteDefinition = {
  name: "Reelhouse",
  description: "A fictional video host. It lists your videos, reads their comments and posts your replies.",
  port: 4105,
  look: { scheme: "dark", accent: "#d6407f", font: "rounded" },
  capabilities: [
    {
      id: "list-videos",
      title: "List videos",
      description: "List the channel's videos, newest first.",
      side_effects: "read",
      input_schema: { type: "object", properties: {} },
      output_schema: { type: "object", properties: { videos: { type: "array" } } },
      run: () => ({
        videos: videos.map((v) => ({ title: v.title, published: v.published, views: v.views, comments: v.comments.length })),
      }),
    },
    {
      id: "read-comments",
      title: "Read comments",
      description: "Read the comments on one of your videos, newest last.",
      side_effects: "read",
      input_schema: {
        type: "object",
        required: ["video"],
        properties: { video: { type: "string", title: "Video", enum: VIDEO_TITLES, default: VIDEO_TITLES[0] } },
      },
      output_schema: { type: "object", properties: { video: { type: "string" }, comments: { type: "array" } } },
      run: (input: { video: string }) => {
        const v = videoNamed(input.video);
        return { video: v.title, comments: v.comments.map((c) => ({ author: c.author, comment: c.text, likes: c.likes, posted: c.posted })) };
      },
    },
    {
      id: "find-bug-reports",
      title: "Find bug reports",
      description: "Find the comment on a video that reports a bug, written up as an issue title and body. Changes nothing.",
      side_effects: "read",
      input_schema: {
        type: "object",
        required: ["video"],
        properties: { video: { type: "string", title: "Video", enum: VIDEO_TITLES, default: VIDEO_TITLES[0] } },
      },
      output_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          comment_id: { type: "string" },
          author: { type: "string" },
          found: { type: "integer" },
        },
      },
      run: (input: { video: string }) => {
        const v = videoNamed(input.video);
        const reports = v.comments.filter((c) => BUG_WORDS.test(c.text));
        const top = reports.sort((a, b) => b.likes - a.likes)[0];
        if (!top) return { found: 0, title: "", body: "", comment_id: "", author: "" };
        const browser = top.text.match(BROWSERS)?.[0];
        const body = [
          `Reported by ${top.author} in the comments on “${v.title}” (${top.posted}):`,
          "",
          `> ${top.text}`,
          "",
          browser ? `- Browser: ${top.text.match(new RegExp(`${browser}(\\s*\\d+(\\.\\d+)*)?`, "i"))?.[0].trim()}` : "",
          /works fine in (\w+)/i.test(top.text) ? `- Works in: ${top.text.match(/works fine in (\w+)/i)![1]}` : "",
          `- Likes on the comment: ${top.likes}`,
        ]
          .filter((l, i, all) => l !== "" || all[i - 1] !== "")
          .join("\n")
          .trim();
        return { found: reports.length, title: issueTitle(top.text), body, comment_id: top.id, author: top.author };
      },
    },
    {
      id: "reply-to-comment",
      title: "Reply to comment",
      description: "Post a reply under a comment, as the channel.",
      side_effects: "write",
      input_schema: {
        type: "object",
        required: ["comment_id", "reply"],
        properties: {
          comment_id: { type: "string", title: "Comment" },
          reply: { type: "string", title: "Reply", "x-mosaic-widget": "textarea" },
        },
      },
      output_schema: {
        type: "object",
        properties: { id: { type: "string" }, comment_id: { type: "string" }, url: { type: "string" }, posted_at: { type: "string" } },
      },
      run: (input: { comment_id: string; reply: string }) => {
        const v = videos.find((x) => x.comments.some((c) => c.id === input.comment_id));
        const c = v?.comments.find((x) => x.id === input.comment_id);
        if (!v || !c) throw new Error(`No comment ${input.comment_id}`);
        c.replies.push(input.reply);
        const id = `${c.id}-r${c.replies.length}`;
        return { id, comment_id: c.id, url: `/watch/${v.id}#${id}`, posted_at: new Date().toISOString() };
      },
    },
  ],
};

if (import.meta.main) serveSite(videosSite);
