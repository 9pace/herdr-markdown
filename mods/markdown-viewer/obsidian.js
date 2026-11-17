// Obsidian's additions to Markdown, rewritten as Markdown the viewer can draw. Code (fenced,
// indented and inline) is left as written. Imports nothing from Herdr, so `node --test` can load it.
//
// - Front matter becomes a properties table, as GitHub shows it.
// - [[Note]], [[Note|alias]], [[Note#Heading]] become `wikilink:` links; the viewer finds the note
//   on click (wikiCandidates).
// - ![[picture.png|300]] becomes an <img>; ![[Note]] a link.
// - Callouts, and GitHub's alerts (`> [!NOTE]`, the same syntax), get a bold title line.
// - ==highlights== are bold; %%comments%% and ^block-ids are hidden.
import { MARKDOWN, fenceEnd, normalize } from "./markdown.js";

const PICTURE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
// Files a wikilink can name with their extension; anything else gets ".md", as in Obsidian.
const ATTACHMENT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|pdf|canvas|base|mp3|wav|m4a|ogg|flac|mp4|webm|mov|mkv|ogv)$/i;
const CODE_SPAN = /(`+)[\s\S]*?[^`]\1(?!`)/g;
const EMBED = /!\[\[([^\]\n]+?)\]\]/g;
const ITEM = /^\s*([-*+]|\d{1,9}[.)])(\s|$)/;
const INDENTED = /^( {4}|\t)/;
// `^` and letters, digits or dashes with a letter or dash in it, so `r ^2` stays.
const BLOCK_ID = "\\^(?=[A-Za-z0-9-]*[A-Za-z-])[A-Za-z0-9-]+";

const CALLOUTS = {
  note: "✎", abstract: "≡", summary: "≡", tldr: "≡", info: "ℹ", todo: "☐", tip: "✦", hint: "✦",
  important: "✦", success: "✓", check: "✓", done: "✓", question: "?", help: "?", faq: "?",
  warning: "⚠", caution: "⚠", attention: "⚠", failure: "✗", fail: "✗", missing: "✗",
  danger: "⚡", error: "⚡", bug: "✱", example: "☰", quote: "❝", cite: "❝",
};

/**
 * A note, or one block of it, rewritten. `pictures` maps an embed's name to the file found for it.
 * `frontMatter: false` for a block that isn't the top of the file.
 */
export function obsidian(markdown, { pictures = {}, frontMatter = true } = {}) {
  const text = markdown.replace(/\r\n?/g, "\n");
  const { props, rest } = frontMatter ? readFrontMatter(text) : { props: [], rest: text };
  const out = props.length ? [prose(propertiesTable(props), pictures), ""] : [];
  for (const part of segments(rest)) out.push(part.code ? part.text : prose(part.text, pictures));
  return out.join("\n");
}

/** The pictures a note embeds by name (![[name]]), each once, outside code. */
export function embeddedPictures(markdown) {
  const found = new Set();
  for (const part of segments(markdown.replace(/\r\n?/g, "\n"))) {
    if (part.code) continue;
    outsideCode(part.text, (run) => {
      for (const m of run.matchAll(EMBED)) { const { target } = parseLink(m[1]); if (PICTURE.test(target)) found.add(target); }
      return run;
    });
  }
  return [...found];
}

// The text as runs of prose and code: fenced blocks, and indented code (after a blank line or at
// the start, and not continuing a list item).
function segments(text) {
  const lines = text.split("\n"), out = [];
  let plain = [], i = 0, inList = false;
  const take = (code, to) => {
    if (plain.length) out.push({ code: false, text: plain.join("\n") });
    plain = [];
    out.push({ code, text: lines.slice(i, to).join("\n") });
    i = to;
  };
  while (i < lines.length) {
    const line = lines[i], fence = fenceEnd(lines, i);
    if (fence > 0) { take(true, fence); inList = false; continue; }
    if (INDENTED.test(line) && line.trim() && !inList && (i === 0 || !lines[i - 1].trim())) {
      let end = i + 1;
      while (end < lines.length && (INDENTED.test(lines[end]) || !lines[end].trim())) end++;
      while (!lines[end - 1].trim()) end--;
      take(true, end);
      continue;
    }
    if (line.trim()) inList = ITEM.test(line) || (inList && /^\s/.test(line));
    plain.push(line); i++;
  }
  if (plain.length) out.push({ code: false, text: plain.join("\n") });
  return out;
}

// --- front matter ---------------------------------------------------------------------------

function readFrontMatter(text) {
  const m = /^---\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text);
  return m ? { props: parseYaml(m[1]), rest: text.slice(m[0].length) } : { props: [], rest: text };
}

// Enough YAML for properties: `key: value`, `key: [a, b]`, and `key:` with `- item` lines under it.
// Anything nested deeper is joined to its key's value as written.
function parseYaml(yaml) {
  const props = [];
  for (const line of yaml.split("\n")) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const key = /^([^\s:#][^:]*?):(?:\s+(.*))?$/.exec(line);
    if (key) { props.push({ key: key[1].trim(), values: scalar(key[2] ?? "") }); continue; }
    const item = /^\s*-\s+(.*)$/.exec(line);
    props[props.length - 1]?.values.push(...(item ? scalar(item[1]) : [line.trim()]));
  }
  return props;
}

function scalar(raw) {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) return v.slice(1, -1).split(",").map(unquote).filter(Boolean);
  return v ? [unquote(v)] : [];
}

const unquote = (s) => { const t = s.trim(); return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t; };

function propertiesTable(props) {
  const cell = (s) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
  return ["| Property | Value |", "| --- | --- |",
    ...props.map(({ key, values }) => `| ${cell(key)} | ${cell(values.join(", "))} |`)].join("\n");
}

// --- prose ----------------------------------------------------------------------------------

function prose(text, pictures) {
  const lines = uncomment(text).split("\n");
  return lines.flatMap((line, n) => callout(line, lines[n - 1]))
    .map((line) => outsideCode(line, (run) => inline(run, pictures))).join("\n");
}

// %%comments%% go, inline code stays. One scan for both, so a comment holding code (or code
// holding %%) reads as it does in Obsidian.
function uncomment(text) {
  return text.replace(new RegExp(`%%[\\s\\S]*?%%|${CODE_SPAN.source}`, "g"), (m) => m.startsWith("%%") ? "" : m);
}

// Runs `fix` on the text outside inline code spans.
function outsideCode(text, fix) {
  let out = "", last = 0;
  for (const m of text.matchAll(CODE_SPAN)) {
    out += fix(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fix(text.slice(last));
}

// The lines a line becomes: `> [!warning]- Title` a bold `> **⚠ Title**` and an empty quote line
// (without it Markdown joins the title to the body), only on a quote's first line; a line holding
// only a block id, none.
function callout(line, before) {
  if (new RegExp(`^\\s*${BLOCK_ID}\\s*$`).test(line)) return [];
  const m = /^(\s*(?:>\s*)+)\[!([\w-]+)\][+-]?\s*(.*)$/.exec(line);
  if (!m || /^\s*>.*[^>\s]/.test(before ?? "")) return [line];
  const type = m[2].toLowerCase();
  const title = m[3].trim() || type[0].toUpperCase() + type.slice(1);
  return [`${m[1]}**${CALLOUTS[type] ?? "✎"} ${title}**`, m[1].trimEnd()];
}

function inline(run, pictures) {
  return run
    .replace(EMBED, (_m, inner) => embed(inner, pictures))
    .replace(/\[\[([^\]\n]+?)\]\]/g, (_m, inner) => wikilink(inner))
    .replace(/(^|[^=])==(?=[^\s=])([^=\n]*?[^\s=])==(?!=)/g, "$1**$2**")
    .replace(new RegExp(`\\s${BLOCK_ID}$`), "");
}

// `Note#Heading|alias`; a `\|` inside a table counts as `|`.
function parseLink(inner) {
  const [where, ...alias] = inner.split(/\\?\|/);
  const hash = where.indexOf("#");
  return {
    target: (hash < 0 ? where : where.slice(0, hash)).trim(),
    heading: hash < 0 ? "" : where.slice(hash + 1).replace(/^\^/, "").trim(),
    alias: alias.join("|").trim(),
  };
}

const escape = (s) => s.replace(/([\\\[\]*_`<>])/g, "\\$1");

function wikilink(inner) {
  const { target, heading, alias } = parseLink(inner);
  const name = target.slice(target.lastIndexOf("/") + 1).replace(MARKDOWN, "");
  const shown = alias || (heading && name ? `${name} › ${heading}` : heading || name);
  if (!target) return escape(shown);
  return `[${escape(shown)}](wikilink:${encodeURIComponent(target + (heading ? `#${heading}` : ""))})`;
}

function embed(inner, pictures) {
  const { target, alias } = parseLink(inner);
  if (!PICTURE.test(target)) return `↳ ${wikilink(inner)}`;
  const attr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const width = /^\d+/.exec(alias)?.[0];
  return `<img src="${attr(pictures[target] ?? target)}" alt="${attr(target)}"${width ? ` width="${width}"` : ""}>`;
}

// --- finding the note a wikilink names --------------------------------------------------------

/** The target and heading of a `wikilink:` URL, or null for any other URL. */
export function wikiTarget(url) {
  if (!url.startsWith("wikilink:")) return null;
  let raw = url.slice("wikilink:".length);
  try { raw = decodeURIComponent(raw); } catch {}
  const { target, heading } = parseLink(raw);
  return { target, heading };
}

/** The file a wikilink target means: as written with a known extension, else with ".md". */
export function fileName(target) {
  return MARKDOWN.test(target) || ATTACHMENT.test(target) ? target : `${target}.md`;
}

/**
 * Where to look for a wikilink's file, in order: beside the note, then from the vault's root.
 * Obsidian also finds a bare name anywhere in the vault; the viewer searches when neither exists.
 */
export function wikiCandidates(target, file, vault) {
  const name = fileName(target);
  if (name.startsWith("/")) return [normalize(name)];
  const beside = normalize(`${file.slice(0, file.lastIndexOf("/"))}/${name}`);
  return [...new Set([beside, ...(vault ? [normalize(`${vault}/${name}`)] : [])])];
}

/** The vault holding a file, from Obsidian's obsidian.json: the deepest one, or null. */
export function vaultOf(file, obsidianJson) {
  let vaults;
  try { vaults = Object.values(JSON.parse(obsidianJson)?.vaults ?? {}).map((v) => v?.path).filter(Boolean); } catch { return null; }
  return vaults.filter((v) => file === v || file.startsWith(v.replace(/\/$/, "") + "/"))
    .sort((a, b) => b.length - a.length)[0] ?? null;
}

/** Of the paths a vault-wide search found, the one Obsidian picks: fewest folders, then shortest. */
export function closest(paths) {
  return [...paths].sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length)[0] ?? null;
}
