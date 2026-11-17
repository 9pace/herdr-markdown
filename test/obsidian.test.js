import { test } from "node:test";
import assert from "node:assert/strict";
import { obsidian, embeddedPictures, wikiTarget, fileName, wikiCandidates, vaultOf, closest } from "../mods/markdown-viewer/obsidian.js";

const cases = (rows) => { for (const [input, want, options] of rows) assert.equal(obsidian(input, options), want, JSON.stringify(input)); };

test("wikilinks", () => cases([
  ["See [[My Note]].", "See [My Note](wikilink:My%20Note)."],
  ["[[My Note|that note]]", "[that note](wikilink:My%20Note)"],
  ["[[My Note#Part two]]", "[My Note › Part two](wikilink:My%20Note%23Part%20two)"],
  ["[[Note#^abc123]]", "[Note › abc123](wikilink:Note%23abc123)"],
  ["[[Projects/Plan.md]]", "[Plan](wikilink:Projects%2FPlan.md)"],
  ["[[#Later]]", "Later"],
  ["| [[Note\\|alias]] | x |", "| [alias](wikilink:Note) | x |"],
  ["[[a_b*c]]", "[a\\_b\\*c](wikilink:a_b*c)"],
]));

test("embeds: pictures as <img>, at a width or a path found for them; notes as links", () => {
  cases([
    ["![[diagram.png]]", '<img src="diagram.png" alt="diagram.png">'],
    ["![[diagram.png|300]]", '<img src="diagram.png" alt="diagram.png" width="300">'],
    ["![[diagram.png]]", '<img src="/v/att/diagram.png" alt="diagram.png">', { pictures: { "diagram.png": "/v/att/diagram.png" } }],
    ["![[Other note]]", "↳ [Other note](wikilink:Other%20note)"],
  ]);
  assert.deepEqual(embeddedPictures("![[a.png]] ![[Note]] ![[b.jpg|20]] ![[a.png]] `![[c.png]]`\n~~~\n![[d.png]]\n~~~"), ["a.png", "b.jpg"]);
});

test("callouts and GitHub alerts get a bold title line; only a quote's first line can be one", () => cases([
  ["> [!warning] Careful\n> Body", "> **⚠ Careful**\n>\n> Body"],
  ["> [!NOTE]\n> Body", "> **✎ Note**\n>\n> Body"],
  ["> [!tip]- Folded", "> **✦ Folded**\n>"],
  ["> > [!info] Nested", "> > **ℹ Nested**\n> >"],
  ["> [!custom] Mine", "> **✎ Mine**\n>"],
  ["> q\n> [!note] mid", "> q\n> [!note] mid"],
]));

test("highlights, comments and block ids", () => cases([
  ["a ==marked== b", "a **marked** b"],
  ["Title\n===", "Title\n==="],
  ["keep %%hidden%% this", "keep  this"],
  ["one\n%%\nhidden\nlines\n%%\ntwo", "one\n\ntwo"],
  ["x %%note with `code` inside%% y", "x  y"],
  ["`%%kept%%` and %%gone%%", "`%%kept%%` and "],
  ["A paragraph ^p1", "A paragraph"],
  ["- item\n\n^list-id\n", "- item\n\n"],
  ["Area is r ^2", "Area is r ^2"],
]));

test("code is left as written: fences, inline spans, indented code", () => cases([
  ["```md\n[[Not a link]] ==no== %%kept%%\n> [!note]\n```", "```md\n[[Not a link]] ==no== %%kept%%\n> [!note]\n```"],
  ["~~~\n[[x]]\n~~~\n[[y]]", "~~~\n[[x]]\n~~~\n[y](wikilink:y)"],
  ["``a ` [[x]]`` [[y]]", "``a ` [[x]]`` [y](wikilink:y)"],
  ["text\n\n    ==x== [[y]]", "text\n\n    ==x== [[y]]"],
  ["- a\n\n    more ==of== a", "- a\n\n    more **of** a"], // a list item's paragraph, not code
  ["# Title\n\nSome *text* with a [link](other.md).\n", "# Title\n\nSome *text* with a [link](other.md).\n"],
]));

test("front matter becomes a properties table, at the top only", () => cases([
  ["---\ntitle: \"Herdr mod\"\ntags:\n  - herdr\n  - obsidian\naliases: [one, 'two']\nempty:\nlink: \"[[Other]]\"\n---\n# Body\n", [
    "| Property | Value |", "| --- | --- |",
    "| title | Herdr mod |", "| tags | herdr, obsidian |", "| aliases | one, two |", "| empty |  |",
    "| link | [Other](wikilink:Other) |", "", "# Body", "",
  ].join("\n")],
  ["---\na: x | y\n---\n", "| Property | Value |\n| --- | --- |\n| a | x \\| y |\n\n"],
  ["---\r\na: 1\r\n---\r\n[[x]]\r\n", "| Property | Value |\n| --- | --- |\n| a | 1 |\n\n[x](wikilink:x)\n"],
  ["---\nSome text\n---", "---\nSome text\n---", { frontMatter: false }],
  ["text\n---\nmore", "text\n---\nmore"],
  ["---\nno end", "---\nno end"],
  ["> [!note] T\r", "> **✎ T**\n>\n"],
]));

test("a wikilink's file: name, candidates, the vault holding the note, the match Obsidian picks", () => {
  assert.deepEqual(wikiTarget("wikilink:My%20Note%23Part"), { target: "My Note", heading: "Part" });
  assert.equal(wikiTarget("https://x.y"), null);
  for (const [target, want] of [["Note", "Note.md"], ["Note.v2", "Note.v2.md"], ["Plan.md", "Plan.md"], ["deck.pdf", "deck.pdf"], ["Board.canvas", "Board.canvas"]])
    assert.equal(fileName(target), want);
  for (const [target, file, vault, want] of [
    ["Other", "/v/a/b/Note.md", "/v", ["/v/a/b/Other.md", "/v/Other.md"]],
    ["Other", "/v/Note.md", "/v", ["/v/Other.md"]],
    ["../up", "/r/docs/x.md", null, ["/r/up.md"]],
    ["/abs/Note", "/v/x.md", "/v", ["/abs/Note.md"]],
  ]) assert.deepEqual(wikiCandidates(target, file, vault), want);
  const json = JSON.stringify({ vaults: { a: { path: "/x/Vault" }, b: { path: "/x/Vault/Inner" }, c: { path: "/x/Vault2" } } });
  assert.equal(vaultOf("/x/Vault/Inner/n.md", json), "/x/Vault/Inner");
  assert.equal(vaultOf("/x/Vault2/n.md", json), "/x/Vault2");
  assert.equal(vaultOf("/x/elsewhere.md", json), null);
  assert.equal(vaultOf("/a.md", "not json"), null);
  assert.equal(closest(["/v/a/b/N.md", "/v/long-name/N.md", "/v/c/N.md"]), "/v/c/N.md");
  assert.equal(closest([]), null);
});
