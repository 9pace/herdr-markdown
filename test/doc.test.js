import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join as joinPath, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { split, join, replace, remove, append, nearest } from "../mods/markdown-viewer/doc.js";

const texts = (doc) => doc.blocks.map((b) => b.text);

test("blocks: one per heading, paragraph, item, quote, table, fence, comment and front matter", () => {
  for (const [text, want, kinds] of [
    ["# Title\nIntro one\nline two\n\n- a\n- b\n  more of b\n  - nested\n1. one", ["# Title", "Intro one\nline two", "- a", "- b\n  more of b\n  - nested", "1. one"], ["heading", "text", "item", "item", "item"]],
    ["> [!note] T\n> body\n\n| a |\n| --- |\n\n```js\nx\n\ny\n```\nafter", ["> [!note] T\n> body", "| a |\n| --- |", "```js\nx\n\ny\n```", "after"], ["quote", "table", "code", "text"]],
    ["---\ntitle: x\n---\n# H", ["---\ntitle: x\n---", "# H"], ["front", "heading"]],
    ["%%\nsecret\n\n# not a heading\n%%\nafter", ["%%\nsecret\n\n# not a heading\n%%", "after"]],
    ["x %% open\n\nnever closed", ["x %% open\n\nnever closed"]],
    ["- a\n\n    more of a\n- b", ["- a\n\n    more of a", "- b"]],
    ["- a\n  ```\n  x\n  ```\n- b", ["- a\n  ```\n  x\n  ```", "- b"]],
  ]) {
    const doc = split(text);
    assert.deepEqual(texts(doc), want, JSON.stringify(text));
    if (kinds) assert.deepEqual(doc.blocks.map((b) => b.kind), kinds);
  }
});

test("join gives back exactly what split read, this repo's Markdown included", () => {
  const root = joinPath(dirname(fileURLToPath(import.meta.url)), "..");
  const files = readdirSync(root).filter((f) => f.endsWith(".md")).map((f) => readFileSync(joinPath(root, f), "utf8"));
  for (const t of ["", "\n", "\n\n# x", "a", "a\n\n\n", "  \n\t\nb\n  \n", "# a\r\nb\r\n", "```\nnever closed\n\n", "---\nno end\n",
    "- a\n\n- b\n", "> q\nlazy\n\nz", "x\n===\n", "a  \n  \n b", ...files])
    assert.equal(join(split(t)), t, JSON.stringify(t.slice(0, 40)));
});

test("typing into a block: kept as typed while it's one block, split when it becomes several", () => {
  const doc = split("# T\n\npara\n\nend\n");
  assert.equal(replace(doc, 1, "para\n"), 1); // Enter at the end: still one block
  assert.equal(replace(doc, 1, "para\n\nnew"), 2);
  assert.deepEqual(texts(doc), ["# T", "para", "new", "end"]);
  assert.equal(join(doc), "# T\n\npara\n\nnew\n\nend\n");
  const lead = split("one\n\ntwo\n");
  replace(lead, 1, "\ntwo");
  replace(lead, 1, "\ntwox");
  assert.equal(join(lead), "one\n\n\ntwox\n");
  const several = split("one\n\ntwo\n");
  assert.equal(replace(several, 1, "\nx\n\ny"), 2); // a leading blank line goes to the gap before
  assert.equal(join(several), "one\n\n\nx\n\ny\n");
});

test("adding a block at the end, and removing one", () => {
  const doc = split("a\n");
  const i = append(doc);
  replace(doc, i, " "); replace(doc, i, "b");
  assert.equal(join(doc), "a\n\nb\n");
  const empty = split("");
  replace(empty, append(empty), "first");
  assert.equal(join(empty), "first");
  for (const [i, want] of [[1, "a\n"], [0, "b\n"]]) { const d = split("a\n\nb\n"); remove(d, i); assert.equal(join(d), want); }
});

test("nearest: the block with that text closest to where it was", () => {
  const doc = split("x\n\ny\n\nx\n\nz\n\nx");
  assert.equal(nearest(doc, "x", 3), 2);
  assert.equal(nearest(doc, "x  ", 0), 0);
  assert.equal(nearest(doc, "w", 1), -1);
});
