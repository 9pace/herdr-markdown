import { test } from "node:test";
import assert from "node:assert/strict";
import { visible, caretAt } from "../mods/markdown-viewer/caret.js";

test("visible: the syntax a line hides isn't counted, offsets point back into it", () => {
  for (const [line, want] of [
    ["## A **bold** and *it* `code`", "A bold and it code"],
    ["- [ ] a [link](https://x.y/z) and [[Note|alias]]", "a link and alias"],
    ["> quoted ==mark==", "quoted mark"],
    ["1. one", "one"],
  ]) assert.equal(visible(line).chars.map((c) => c.ch).join(""), want);
  assert.deepEqual(visible("**bo**ld", 10).chars.map((c) => c.at), [12, 13, 16, 17]);
});

const line = "The quick brown fox jumps over the lazy dog";
const code = "```js\nconst x = 1;\nlet y = 2;\n```";
const table = "| a |\n| --- |\n| x |\n| x |";

test("caretAt: the offset for a click at (x, y) in a block of that size", () => {
  for (const [name, src, kind, x, y, w, h, want] of [
    ["paragraph start", line, "text", 0, 10, 800, 21, 0],
    ["paragraph end", line, "text", 790, 10, 800, 21, line.length],
    ["a second source line", "first line\nsecond line", "text", 0, 30, 800, 42, 11],
    ["a list item, after its marker", "- item", "item", 0, 5, 800, 21, 2],
    ["code, first line", code, "code", 14, 14, 800, 66, 6],
    ["code, second line, column 4", code, "code", 14 + 4 * 7.8, 35, 800, 66, 23],
    ["code, bottom padding: the last line of code, not the fence", code, "code", 14, 60, 800, 66, 19],
    ["table, first row", table, "table", 10, 5, 800, 72, 0],
    ["table, a repeated row", table, "table", 10, 70, 800, 72, table.lastIndexOf("| x |")],
    ["empty front matter", "---\n---", "front", 10, 5, 800, 20, 0],
  ]) assert.equal(caretAt(src, kind, x, y, w, h), want, name);
  const mid = caretAt(line, "text", 150, 10, 800, 21);
  assert.ok(mid > 15 && mid < 28, `middle of the line landed at ${mid}`);
});

test("caretAt: a wrapped paragraph's second row starts after a space", () => {
  const text = `${line} ${line} ${line}`, second = caretAt(text, "text", 0, 30, 300, 84);
  assert.ok(second > 20 && second < 50 && text[second - 1] === " ", `second row starts at ${second}`);
});

test("caretAt: an emoji is one character, the cursor never lands inside it", () => {
  const src = "😀😀😀 smile";
  for (let x = 0; x < 120; x += 3) {
    const c = src.charCodeAt(caretAt(src, "text", x, 5, 800, 21));
    assert.ok(!(c >= 0xdc00 && c <= 0xdfff), `x=${x}`);
  }
});
