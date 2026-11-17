// A Markdown file as blocks, for editing one at a time: each heading, paragraph, list item, quote
// (callouts too), table, fenced block, %%comment%% and the front matter. Every character is kept:
// `lead` (blank lines before the first block) and each block's `gap` (what follows it) are stored as
// written, so join(split(text)) === text. Imports nothing from Herdr, so `node --test` can load it.
import { fenceEnd } from "./markdown.js";

const HEADING = /^ {0,3}#{1,6}(\s|$)/;
// Only a marker at the start of a line starts an item; an indented one belongs to the item above.
const ITEM = /^([-*+]|\d{1,9}[.)])(\s|$)/;
const QUOTE = /^ {0,3}>/;

const kindOf = (line) => ITEM.test(line) ? "item" : QUOTE.test(line) ? "quote" : /^\s*\|/.test(line) ? "table" : "text";
const blank = (line) => line.trim() === "";
// An odd number of %% leaves a comment open.
const opens = (line) => (line.match(/%%/g) ?? []).length % 2 === 1;

// Whether `line`, right after a line of a block of `kind`, starts a new block. In a list item, an
// indented line (a nested item, a fence) belongs to the item.
function starts(line, kind) {
  if (kind === "item" && /^[ \t]/.test(line)) return false;
  if (HEADING.test(line) || fenceEnd([line], 0) > 0 || ITEM.test(line)) return true;
  return QUOTE.test(line) && kind !== "quote";
}

// Where a paragraph, item, quote or table starting at `start` ends. It runs on across blank lines
// while a %%comment%% is open, or, for a list item, to an indented line after them.
function textEnd(lines, start, kind) {
  let end = start + 1;
  const run = () => { while (end < lines.length && !blank(lines[end]) && !starts(lines[end], kind)) end++; };
  run();
  for (;;) {
    if (lines.slice(start, end).filter(opens).length % 2 === 1 && end < lines.length) {
      while (end < lines.length && !opens(lines[end++]));
      continue;
    }
    let k = end;
    while (k < lines.length && blank(lines[k])) k++;
    if (kind !== "item" || k === end || k === lines.length || !/^[ \t]+\S/.test(lines[k])) return end;
    end = k + 1;
    run();
  }
}

/** The blocks of a text: { lead, blocks: [{ text, gap, kind }] }. */
export function split(text) {
  const lines = text.split("\n"), at = [];
  let n = 0;
  for (const line of lines) { at.push(n); n += line.length + 1; }
  const blocks = [];
  let i = 0;
  while (i < lines.length && blank(lines[i])) i++;
  const lead = text.slice(0, i < lines.length ? at[i] : text.length);
  while (i < lines.length) {
    let kind = kindOf(lines[i]), end;
    const front = i === 0 && lines[0] === "---" ? lines.findIndex((l, k) => k > 0 && (l === "---" || l === "...")) : -1;
    if (front > 0) { end = front + 1; kind = "front"; }
    else if ((end = fenceEnd(lines, i)) > 0) kind = "code";
    else if (HEADING.test(lines[i])) { end = i + 1; kind = "heading"; }
    else end = textEnd(lines, i, kind);
    let next = end;
    while (next < lines.length && blank(lines[next])) next++;
    const to = at[end - 1] + lines[end - 1].length;
    blocks.push({ text: text.slice(at[i], to), gap: text.slice(to, next < lines.length ? at[next] : text.length), kind });
    i = next;
  }
  return { lead, blocks };
}

/** The text again: lead, then each block and its gap. */
export function join(doc) {
  return doc.lead + doc.blocks.map((b) => b.text + b.gap).join("");
}

/**
 * Block `i` now reads `text`, as its editor holds it. Text that is still one block (or none) is kept
 * as typed, newlines included, so the next keystroke replaces it exactly. Text that is several
 * blocks (a blank line, a new item, a line after a heading) replaces it with them, the last taking
 * its gap. Returns the index of the last.
 */
export function replace(doc, i, text) {
  const old = doc.blocks[i], parts = split(text);
  if (parts.blocks.length <= 1) { doc.blocks[i] = { ...old, text, kind: parts.blocks[0]?.kind ?? old.kind }; return i; }
  parts.blocks[parts.blocks.length - 1].gap += old.gap;
  if (i > 0) doc.blocks[i - 1].gap += parts.lead; else doc.lead += parts.lead;
  doc.blocks.splice(i, 1, ...parts.blocks);
  return i + parts.blocks.length - 1;
}

/** Removes block `i`; the block before it takes its gap when it was the last. */
export function remove(doc, i) {
  const [gone] = doc.blocks.splice(i, 1);
  if (i > 0 && i === doc.blocks.length) doc.blocks[i - 1].gap = gone.gap;
}

/** Adds an empty block at the end, a blank line after the last one. Returns its index. */
export function append(doc) {
  const last = doc.blocks[doc.blocks.length - 1];
  if (last) last.gap = "\n\n";
  doc.blocks.push({ text: "", gap: last ? "\n" : "", kind: "text" });
  return doc.blocks.length - 1;
}

/** The index of the block reading `text` (trailing whitespace aside) nearest `i`, or -1. */
export function nearest(doc, text, i) {
  let best = -1;
  doc.blocks.forEach((b, k) => {
    if (b.text.trimEnd() === text.trimEnd() && (best < 0 || Math.abs(k - i) < Math.abs(best - i))) best = k;
  });
  return best;
}
