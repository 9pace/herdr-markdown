// Three-way merge by lines, for a file someone is typing in while an agent (or Obsidian) edits it.
// `base` is what both started from, `mine` the editor's text, `theirs` what is on disk now.
// Changes to different lines both apply; changes to the same lines are a conflict, and nothing is
// merged. Imports nothing from Herdr, so `node --test` can load it.

/** The lines of a text, each keeping its newline, so joining them gives the text back exactly. */
function lines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

// The changes from a to b, as hunks { start, end, add }: a.slice(start, end) becomes add.
// Common start and end are trimmed first, so the usual small edit is cheap; the middle is an LCS.
function hunks(a, b) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const x = a.slice(pre, a.length - suf), y = b.slice(pre, b.length - suf);
  if (!x.length && !y.length) return [];
  if (x.length * y.length > 4_000_000) return [{ start: pre, end: a.length - suf, add: y }]; // too big to align: one hunk
  // lcs[i][j]: the longest common run of x[i..] and y[j..].
  const lcs = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out = [];
  let i = 0, j = 0, open = null;
  const close = () => { if (open) { out.push(open); open = null; } };
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { close(); i++; j++; continue; }
    open ??= { start: pre + i, end: pre + i, add: [] };
    if (j < y.length && (i === x.length || lcs[i][j + 1] >= lcs[i + 1][j])) open.add.push(y[j++]);
    else { i++; open.end = pre + i; }
  }
  close();
  return out;
}

const same = (h, k) => h.start === k.start && h.end === k.end && h.add.join("") === k.add.join("");
// Two hunks touch when their ranges overlap, start at the same place, or one inserts right where
// the other's range ends (merging those would put both changes there, duplicating lines).
const touch = (h, k) => (h.start < k.end && k.start < h.end) || h.start === k.start
  || (k.start === k.end && k.start === h.end) || (h.start === h.end && h.start === k.end);

/** The merged text, or null when both sides changed the same lines differently. */
export function merge3(base, mine, theirs) {
  if (mine === theirs || theirs === base) return mine;
  if (mine === base) return theirs;
  const b = lines(base), a = hunks(b, lines(mine)), t = hunks(b, lines(theirs));
  // Walk both sides' hunks in base order: two that touch must be the same change, or it's a conflict.
  const all = [...a.map((h) => ({ ...h, side: 0 })), ...t.map((h) => ({ ...h, side: 1 }))]
    .sort((h, k) => h.start - k.start || h.end - k.end || h.side - k.side);
  const out = [];
  let at = 0;
  for (let n = 0; n < all.length; n++) {
    const h = all[n], next = all[n + 1];
    if (next && touch(h, next)) {
      // One side's hunks never touch each other, so these are one from each side.
      if (!same(h, next)) return null;
      n++; // both made the same change: take it once
    }
    out.push(...b.slice(at, h.start), ...h.add);
    at = Math.max(at, h.end);
  }
  out.push(...b.slice(at));
  return out.join("");
}
