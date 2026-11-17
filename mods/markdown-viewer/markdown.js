// Small pieces of Markdown and path handling the viewer's modules share. Imports nothing from
// Herdr, so `node --test` can load it.

/** A Markdown file's name. */
export const MARKDOWN = /\.(md|markdown|mdx)$/i;

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Where the fenced block opening at line `i` ends (the line after its closing fence, or the end), or -1. */
export function fenceEnd(lines, i) {
  const open = FENCE.exec(lines[i]);
  if (!open) return -1;
  const closing = new RegExp(`^ {0,3}${open[1][0]}{${open[1].length},}\\s*$`);
  let end = i + 1;
  while (end < lines.length && !closing.test(lines[end])) end++;
  return Math.min(end + 1, lines.length);
}

/** A path with `.`, `..` and repeated slashes resolved. */
export function normalize(path) {
  return "/" + path.split("/").reduce((acc, part) => part === ".." ? acc.slice(0, -1) : part === "." || part === "" ? acc : [...acc, part], []).join("/");
}

/** A path as an absolute one: relative from `cwd`, `~/` from `home`. */
export function absolute(path, cwd, home) {
  return normalize(path.startsWith("~/") ? home + path.slice(1) : path.startsWith("/") ? path : `${cwd || "/"}/${path}`);
}
