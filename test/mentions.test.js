import { test } from "node:test";
import assert from "node:assert/strict";
import { mentions, transcriptMentions, transcriptPath } from "../mods/markdown-viewer/mentions.js";

test("screen text: paths lowest first, a wrapped one joined, marks and file:// taken off, web links left out", () => {
  const screen = "Wrote ~/tasks/a/PLAN.md and `README.md`.\n⏺ See /Users/me/docs/very-long-\n  name.md, @notes/x.md\nsee file:///a%20b.md and https://x.y/z.md";
  // "name.md" is tried too; it won't exist on disk, so it's dropped later.
  assert.deepEqual(mentions(screen), ["/a b.md", "notes/x.md", "name.md", "/Users/me/docs/very-long-name.md", "README.md", "~/tasks/a/PLAN.md"]);
});

const entry = (content, cwd = "/t") => JSON.stringify({ type: "assistant", cwd, message: { content } });

test("transcript: the agent's messages, its tools' files and shell commands, newest first, resolved from each entry's folder", () => {
  const jsonl = [
    entry([{ type: "text", text: "Plan at /t/PLAN.md." }]),
    JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "what about /t/USER.md" }] } }),
    entry([{ type: "tool_use", name: "Write", input: { file_path: "/t/notes/new.md" } }]),
    entry([{ type: "tool_use", name: "Grep", input: { path: "docs/guide.mdx" } }], "/t/repo"),
    entry([{ type: "text", text: "Updated /t/PLAN.md and README.md, see /t/x.markdown" }], "/t/repo"),
    entry([{ type: "tool_use", name: "Bash", input: { command: "sed -n 1p RECIPE.md ~/x/AGENTS.md" } }], "/t/repo"),
    "not json .md \"assistant\"",
  ].join("\n");
  assert.deepEqual(transcriptMentions(jsonl, "/h"),
    ["/h/x/AGENTS.md", "/t/repo/RECIPE.md", "/t/x.markdown", "/t/repo/README.md", "/t/PLAN.md", "/t/repo/docs/guide.mdx", "/t/notes/new.md"]);
});

test("where a session's transcript is", () => {
  assert.equal(transcriptPath("/Users/me", "/Users/me/tasks/2026-11-10-x.y_z", "abc"),
    "/Users/me/.claude/projects/-Users-me-tasks-2026-11-10-x-y-z/abc.jsonl");
});
