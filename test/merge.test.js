import { test } from "node:test";
import assert from "node:assert/strict";
import { merge3 } from "../mods/markdown-viewer/merge.js";

const base = "# Plan\n\nOne\nTwo\nThree\nFour\n";

test("merge3: both sides' changes apply unless they touch the same lines", () => {
  for (const [name, b, mine, theirs, want] of [
    ["only mine changed", base, base.replace("Two", "2"), base, base.replace("Two", "2")],
    ["only theirs changed", base, base, base + "Five\n", base + "Five\n"],
    ["neighbouring lines", base, base.replace("Two", "2"), base.replace("Three", "3"), "# Plan\n\nOne\n2\n3\nFour\n"],
    ["an agent appends while I edit the top", base, base.replace("# Plan", "# Plan, renamed"), base + "\n## New\n", base.replace("# Plan", "# Plan, renamed") + "\n## New\n"],
    ["a deletion and an edit elsewhere", base, base.replace("Two\nThree\n", ""), base.replace("# Plan", "# Plan v2"), "# Plan v2\n\nOne\nFour\n"],
    ["the same change on both sides", base, base.replace("Three", "3"), base.replace("Three", "3").replace("One", "1"), base.replace("Three", "3").replace("One", "1")],
    ["no final newline", "a\nb\nc", "A\nb\nc", "a\nb\nC", "A\nb\nC"],
    ["the same line, changed differently", base, base.replace("Two", "mine"), base.replace("Two", "theirs"), null],
    ["inserts at the same place", base, base.replace("Two\n", "Two\nA\n"), base.replace("Two\n", "Two\nB\n"), null],
    ["an insert where the other side's change ends", "\n\n- one\n", "\n\nNew line.\n- one\n", "\nNew line.\n- one\n", null],
    ["a deleted line the other side edits", base, base.replace("Two\n", ""), base.replace("Two", "2"), null],
    ["both add to an empty file", "", "mine\n", "theirs\n", null],
  ]) assert.equal(merge3(b, mine, theirs), want, name);
});
