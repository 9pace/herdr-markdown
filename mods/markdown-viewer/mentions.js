// The Markdown paths a terminal's agent mentioned: on its screen, and in its Claude Code session's
// transcript, newest first. Imports nothing from Herdr, so `node --test` can load it.
import { MARKDOWN, absolute } from "./markdown.js";

// A path-ish run ending in .md, .markdown or .mdx. It stops at spaces, quotes, brackets,
// box-drawing and the marks agents put around paths.
const TOKEN = /[^\s`'"<>()\[\]{}|│⎿●✻*,;]+?\.(?:md|markdown|mdx)(?![\w-])/giu;

function tokens(text) {
  const out = [];
  for (const [match] of text.matchAll(TOKEN)) {
    if (/^[a-z][\w+.-]*:\/\//i.test(match) && !match.startsWith("file://")) continue; // a web link
    let p = match.replace(/^file:\/\//, "").replace(/^@/, "");
    try { p = decodeURIComponent(p); } catch {}
    if (p.length > 1) out.push(p);
  }
  return out;
}

// The paths in terminal text, lowest first. Agents and terminals wrap long lines, so each line's
// last word is also tried joined to the next line's first; a wrong join doesn't exist on disk.
export function mentions(text) {
  const lines = text.split("\n"), out = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const tail = lines[i].match(/\S+$/)?.[0], head = lines[i + 1]?.match(/^\s*(\S+)/)?.[1];
    if (tail && head) out.push(...tokens(tail + head));
    out.push(...tokens(lines[i]).reverse());
  }
  return [...new Set(out)];
}

/**
 * The paths a Claude Code transcript (JSONL) mentions, newest first, as absolute paths (relative
 * ones from the folder the session was in at that entry): the agent's messages, its tools'
 * `file_path` or `path`, and the paths in its shell commands.
 */
export function transcriptMentions(jsonl, home) {
  const out = [];
  for (const line of jsonl.split("\n").reverse()) {
    if (!/\.(md|mdx|markdown)\b/i.test(line) || !line.includes('"assistant"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type !== "assistant") continue;
    const found = [];
    for (const c of [...(entry.message?.content ?? [])].reverse()) {
      if (c?.type === "text" && typeof c.text === "string") found.push(...mentions(c.text));
      if (c?.type !== "tool_use") continue;
      if (typeof c.input?.command === "string") found.push(...mentions(c.input.command));
      const file = c.input?.file_path ?? c.input?.path;
      if (typeof file === "string" && MARKDOWN.test(file)) found.push(file);
    }
    out.push(...found.map((p) => absolute(p, entry.cwd, home)));
  }
  return [...new Set(out)];
}

/** A session's transcript: Claude Code names its folder after the cwd, other characters than letters, digits and "-" as "-". */
export function transcriptPath(home, cwd, session) {
  return `${home}/.claude/projects/${cwd.replace(/[^A-Za-z0-9-]/g, "-")}/${session}.jsonl`;
}
