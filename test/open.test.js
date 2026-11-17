// open.sh against a fake home: a fake herdr-app and a fake `open` record what they're asked.
// Nothing reaches the real app.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../mods/markdown-viewer/open.sh");
const homes = [];
after(() => { for (const h of homes) rmSync(h, { recursive: true, force: true }); });

// The fake herdr-app answers like the real one (JSON, exit 1 with {"error": ...}). With `ack`, it
// plays a viewer that's showing: on `show` it acknowledges the request. Each program logs its calls,
// one argument per line, then an END line.
const END = "--end--";
function fakeHome({ settings, answer = '{ "pane": "p1" }', fallback = "md.obsidian", ack = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "md-open-"));
  homes.push(home);
  const bin = join(home, ".local/bin"), data = join(home, ".config/herdr-app/data/markdown-viewer");
  mkdirSync(bin, { recursive: true }); mkdirSync(data, { recursive: true });
  const fake = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n{ for a; do printf '%s\\n' "$a"; done; echo ${END}; } >> "${home}/${name}.log"\n${body}`);
    chmodSync(join(bin, name), 0o755);
  };
  fake("herdr-app", ack
    ? `[ "$2" = markdown-viewer.show ] && sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p' "${data}/request.json" > "${data}/ack"\n`
    : `printf '%s\\n' '${answer}'\n${answer.includes('"error"') ? "exit 1\n" : ""}`);
  fake("open", "");
  if (fallback) writeFileSync(join(data, "fallback"), fallback);
  if (settings) writeFileSync(join(home, ".config/herdr-app/markdown-viewer.json"), JSON.stringify(settings));
  const run = (file, front) => execFileSync("/bin/sh", [SCRIPT, file, front], { env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } });
  const calls = (name) => existsSync(join(home, `${name}.log`))
    ? readFileSync(join(home, `${name}.log`), "utf8").split(`${END}\n`).filter(Boolean).map((c) => c.replace(/\n$/, "").split("\n"))
    : [];
  return { run, calls, data };
}

test("anything but Herdr in front: the app the router took over from, else TextEdit", () => {
  for (const [fallback, app] of [["md.obsidian", "md.obsidian"], [null, "com.apple.TextEdit"]]) {
    const h = fakeHome({ settings: { click: "tab" }, fallback });
    h.run("/x/Note.md", "/System/Library/CoreServices/Finder.app");
    assert.deepEqual(h.calls("open"), [["-b", app, "/x/Note.md"]]);
    assert.deepEqual(h.calls("herdr-app"), []);
  }
});

test('"click": "tab": a new tab named after the file, quotes and backslashes intact', () => {
  const h = fakeHome({ settings: { click: "tab" } });
  const file = '/Users/me/My "odd" \\ notes/Plan.md';
  h.run(file, "/Applications/Herdr.app");
  const [[verb, command, json], ...more] = h.calls("herdr-app");
  assert.deepEqual([verb, command, more.length], ["do", "tab.new", 0]);
  assert.deepEqual(JSON.parse(json), { mod: "markdown-viewer", name: "Plan.md", props: { file } });
});

test("without the setting: a viewer showing is asked first, then a split on the right", () => {
  const h = fakeHome();
  const file = '/x/a "b".md';
  h.run(file, "/Applications/Herdr.app");
  const [show, split] = h.calls("herdr-app");
  assert.deepEqual(show, ["do", "markdown-viewer.show"]);
  assert.equal(JSON.parse(readFileSync(join(h.data, "request.json"), "utf8")).file, file);
  assert.deepEqual(split.slice(0, 4), ["do", "pane.split", "--direction", "right"]);
  assert.equal(JSON.parse(split[split.indexOf("--props") + 1]).file, file);
});

test("a viewer that answers takes the file: no split", () => {
  const h = fakeHome({ ack: true });
  h.run("/x/Note.md", "/Applications/Herdr.app");
  assert.deepEqual(h.calls("herdr-app"), [["do", "markdown-viewer.show"]]);
});

test("a command Herdr refuses (exit 1) sends the file elsewhere", () => {
  for (const settings of [{ click: "tab" }, undefined]) {
    const h = fakeHome({ settings, answer: '{ "error": "no window" }' });
    h.run("/x/Note.md", "herdr-app");
    assert.deepEqual(h.calls("open"), [["-b", "md.obsidian", "/x/Note.md"]]);
  }
});
