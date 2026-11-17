import { test } from "node:test";
import assert from "node:assert/strict";
import { fenceEnd, absolute } from "../mods/markdown-viewer/markdown.js";

test("fenceEnd: the line after the closing fence, the end if none, -1 if no fence opens", () => {
  assert.equal(fenceEnd(["```js", "x", "```", "after"], 0), 3);
  assert.equal(fenceEnd(["~~~~", "~~~", "x"], 0), 3); // a shorter fence doesn't close it
  assert.equal(fenceEnd(["text"], 0), -1);
});

test("absolute: relative from the folder, ~ from home, . and .. resolved", () => {
  for (const [path, want] of [["PLAN.md", "/t/x/PLAN.md"], ["~/a.md", "/h/a.md"], ["../b/./c.md", "/t/b/c.md"], ["/abs//d.md", "/abs/d.md"]])
    assert.equal(absolute(path, "/t/x", "/h"), want);
});
