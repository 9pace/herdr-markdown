// Where the cursor goes when a drawn block is clicked to edit it. Herdr can't say which character
// is under the pointer, so this estimates it: the block's Markdown without its syntax, laid out
// with typical letter widths, wrapped at the block's width and scaled to its real height. Imports
// nothing from Herdr, so `node --test` can load it.

/** Body text size, and each heading level's size as a multiple of it (main.js draws with these). */
export const FONT = 14;
export const HEADING_SCALE = [2, 1.5, 1.25, 1.1, 1, 1];
/** A drawn code block: padding, line height and font size, in px (main.js draws with these). */
export const CODE = { top: 12, left: 14, line: 21, font: 13 };

// Widths in em of a proportional UI font, by kind of character.
function em(ch) {
  if (ch === " ") return 0.28;
  if ("iljtfrI.,:;'!|()[]{}".includes(ch)) return 0.3;
  if ("mwMW@%".includes(ch)) return 0.85;
  if (/[A-Z]/.test(ch)) return 0.66;
  if (/[0-9]/.test(ch)) return 0.58;
  if (/[^\x00-\x7f]/.test(ch)) return 0.9;
  return 0.52;
}

const MONO = 0.6; // inline code and code blocks

/**
 * The characters a line shows, each with its offset in `src`, and its indent in em. List markers,
 * quote bars, heading marks, emphasis marks and link targets aren't shown.
 */
export function visible(line, start = 0) {
  let i = 0, indent = 0, scale = 1;
  const quote = /^(\s*>\s?)+/.exec(line);
  if (quote) { i = quote[0].length; indent += 1.2 * (quote[0].match(/>/g).length); }
  const heading = /^ {0,3}(#{1,6})\s+/.exec(line.slice(i));
  if (heading) { scale = HEADING_SCALE[heading[1].length - 1]; i += heading[0].length; }
  const item = /^(\s*)([-*+]|\d{1,9}[.)])\s+(\[[ xX]\]\s+)?/.exec(line.slice(i));
  if (item) { indent += 1.6 + item[1].length * 0.8; i += item[0].length; }
  const out = [];
  let code = false;
  while (i < line.length) {
    const rest = line.slice(i);
    let m;
    if (rest[0] === "`") { code = !code; i++; continue; }
    if (!code && (m = /^(\*\*|__|~~|==|\*|_)/.exec(rest))) { i += m[0].length; continue; }
    if (!code && (m = /^\[\[([^\]|]*\|)?/.exec(rest))) { i += m[0].length; continue; }
    if (!code && rest.startsWith("]]")) { i += 2; continue; }
    if (!code && (m = /^\]\([^)]*\)/.exec(rest))) { i += m[0].length; continue; }
    if (!code && rest[0] === "[") { i++; continue; }
    // A character may be two UTF-16 units (an emoji); the cursor never lands between them.
    const ch = String.fromCodePoint(line.codePointAt(i));
    out.push({ ch, at: start + i, w: (code ? MONO : em(ch)) * scale });
    i += ch.length;
  }
  return { chars: out, indent, scale, end: start + line.length };
}

// The block's lines as laid out: wrapped at `room` em, each with its characters and height (em).
function layout(src, room) {
  const rows = [];
  let start = 0;
  for (const line of src.split("\n")) {
    const v = visible(line, start), lineRoom = Math.max(4, room - v.indent);
    let row = [], used = 0, lastSpace = -1;
    for (const c of v.chars) {
      if (used + c.w > lineRoom && row.length) {
        const cut = lastSpace >= 0 ? lastSpace + 1 : row.length;
        rows.push({ chars: row.slice(0, cut), indent: v.indent, h: 1.5 * v.scale, end: row[cut]?.at ?? c.at });
        row = row.slice(cut); used = row.reduce((s, r) => s + r.w, 0); lastSpace = -1;
      }
      if (c.ch === " ") lastSpace = row.length;
      row.push(c); used += c.w;
    }
    rows.push({ chars: row, indent: v.indent, h: 1.5 * v.scale, end: v.end });
    start += line.length + 1;
  }
  return rows;
}

const tall = (rows, font) => rows.reduce((sum, r) => sum + r.h, 0) * font;

/** The offset in `src` nearest a click at (x, y) in a block drawn `width` × `height` px. */
export function caretAt(src, kind, x, y, width, height) {
  if (kind === "code") return codeCaret(src, x, y);
  if (kind === "front" || kind === "table") return rowStart(src, y, height);
  let font = FONT, rows = layout(src, width / font);
  // The real height says how big a line is (zoom, line spacing). Scale halfway first: bigger
  // letters also mean fewer per row.
  if (height > 0 && tall(rows, font) > 0) {
    font *= Math.sqrt(height / tall(rows, font));
    rows = layout(src, width / font);
    font *= height / tall(rows, font);
  }
  let top = 0, row = rows[rows.length - 1];
  for (const r of rows) { if (y < top + r.h * font) { row = r; break; } top += r.h * font; }
  let left = row.indent * font;
  for (const c of row.chars) {
    if (x < left + (c.w * font) / 2) return c.at;
    left += c.w * font;
  }
  return row.end;
}

// The opening fence isn't drawn, so drawn line 0 is source line 1; the last it can land on is the
// last line of code, not the closing fence.
function codeCaret(src, x, y) {
  const lines = src.split("\n"), closed = lines.length > 1 && /^\s*(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1]);
  const line = Math.min(Math.max(1, lines.length - (closed ? 2 : 1)), 1 + Math.max(0, Math.floor((y - CODE.top) / CODE.line)));
  const col = Math.max(0, Math.round((x - CODE.left) / (CODE.font * MONO)));
  let at = 0;
  for (let k = 0; k < line && k < lines.length; k++) at += lines[k].length + 1;
  return Math.min(at + Math.min(col, lines[line]?.length ?? 0), src.length);
}

// Tables and front matter: the start of the row clicked (separators and `---` aren't rows).
function rowStart(src, y, height) {
  const starts = [];
  let at = 0;
  for (const line of src.split("\n")) {
    if (!/^\s*\|?\s*:?-{3,}/.test(line) && line !== "---") starts.push(at);
    at += line.length + 1;
  }
  if (!starts.length) return 0;
  const row = Math.min(starts.length - 1, Math.max(0, Math.floor((y / Math.max(1, height)) * starts.length)));
  return starts[row];
}
