// Markdown: open the .md files an agent just printed, rendered, inside Herdr.
//
// Two roles, one mod:
// - Opened as its overlay (cmd-shift-o → mod.open:markdown): a picker of the Markdown
//   files mentioned in the focused terminal's recent output, newest first. Enter opens one
//   the way a Cmd+click would (a split beside the terminal, or a new tab with "click": "tab"
//   in markdown-viewer.json), cmd-Enter the other way; type to filter, or type/paste a path.
// - As a pane (props: { file, on }): the file, rendered and editable a block at a time (live
//   preview) or whole (Source), saved as you type and merged with changes made on disk; links to
//   other .md files followed in place (Back), web links in the browser.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Editor, EditorState, TextView, TextareaState, Textarea } from "gpui-base";
import { focused, panes, hc, exec, run, theme, settings, props, closeOverlay, home, appHome, readTextFile, writeTextFile, watchFolder, nextCommand, window, notify } from "herdr";
import * as fs from "fs/promises";
import { existing } from "./paths.js";
import { mentions, transcriptMentions, transcriptPath } from "./mentions.js";
import { MARKDOWN, absolute } from "./markdown.js";
import { icon as drawIcon, writeIcons } from "./icons.js";
import { blocks, loadLocal, loadWeb, pruneOld } from "./pictures.js";
import { obsidian, embeddedPictures, wikiTarget, wikiCandidates, fileName, vaultOf, closest } from "./obsidian.js";
import { merge3 } from "./merge.js";
import * as Doc from "./doc.js";
import { caretAt, FONT, HEADING_SCALE, CODE } from "./caret.js";

const DATA = () => `${appHome()}/data/markdown-viewer`;
const mac = () => window()?.platform === "macos";
const base = (p) => p.slice(p.lastIndexOf("/") + 1);
const dir = (p) => p.slice(0, p.lastIndexOf("/")) || "/";
const pretty = (p) => { const h = home(); return p === h || p.startsWith(h + "/") ? "~" + p.slice(h.length) : p; };

// Names people write after ``` that the code editor knows by another name. It has no TypeScript or
// JSX of its own, and its JavaScript still colors their keywords, strings and comments.
const LANGUAGES = {
  js: "javascript", jsx: "javascript", mjs: "javascript", ts: "javascript", tsx: "javascript", typescript: "javascript",
  py: "python", rb: "ruby", rs: "rust", golang: "go", sh: "bash", shell: "bash", zsh: "bash",
  console: "bash", yml: "yaml", md: "markdown", "c++": "cpp", csharp: "cs", "c#": "cs", htm: "html",
};
const SAVE_MS = 800; // after the last keystroke
const GONE = "This file isn't there (anymore).";
// The picker's last list per terminal, and the Claude Code session it came from. A mod file's top
// level runs once for all its copies, so the next picker shows it at once while it looks again.
const FOUND = new Map();
const FOUND_MAX = 50;
const TRANSCRIPT_TAIL = 4_000_000;

const openLink = (url) => exec(mac() ? "open" : "xdg-open", [url]).catch(() => null);
const reveal = (path) => exec(mac() ? "open" : "xdg-open", mac() ? ["-R", path] : [dir(path)]).catch(() => null);

// Opens a file outside Herdr. With the Markdown Router as macOS's default app for .md (router/), the
// default would send it straight back here, so this uses the app the router took over from.
async function openElsewhere(file) {
  if (!mac()) return exec("xdg-open", [file]).catch(() => null);
  const id = (await readTextFile(`${DATA()}/fallback`).catch(() => null))?.trim() ?? "";
  return exec("open", /^[\w.-]+$/.test(id) ? ["-b", id, file] : [file]).catch(() => null);
}

export default class Markdown extends View {
  init(_props, cx) {
    const p = props() ?? {};
    cx.spawn(async (cx) => { await writeIcons().catch(() => null); cx.notify(); });
    if (p.file) this.viewer = new Viewer(p.file, p.on ?? null, cx);
    else this.picker = new Picker(p.overlay, cx);
  }
  render(cx) { return (this.viewer ?? this.picker).render(cx); }
  async close() { await this.viewer?.flush(); }
}

// Opens a file: a new tab named after it, or a split beside the pane that had focus.
function open(file, on, split, pane) {
  const p = { file, ...(on ? { on } : {}) };
  if (split && pane) run("pane.split", { direction: "right", pane, mod: "markdown-viewer", props: p });
  else run("tab.new", { mod: "markdown-viewer", props: p, name: base(file) });
}

class Picker {
  constructor(overlay, cx) {
    const f = focused();
    this.overlay = overlay; this.pane = f?.pane ?? null;
    this.terminal = f?.terminal ?? null;
    // Relative paths are from the pane's folder (where the agent works), as Changes finds it.
    this.cwd = (f?.pane && panes().find((p) => p.pane === f.pane)?.cwd) || f?.cwd || null;
    this.on = this.terminal?.includes("/") ? this.terminal.split("/")[0] : null;
    this.files = FOUND.get(this.terminal)?.files ?? null; this.at = 0; this.filter = ""; this.tabs = false;
    // Enter does what a Cmd+click on a path does: a split, unless the setting says tabs.
    cx.spawn(async (cx) => {
      const json = await readTextFile(`${appHome()}/markdown-viewer.json`).catch(() => null);
      try { this.tabs = JSON.parse(json ?? "{}")?.click === "tab"; } catch {}
      cx.notify();
    });
    this.input = InputState.new({ placeholder: "Filter, or type a path…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", (e, cx) => this.choose(this.shown()[this.at], this.split(e?.secondary), cx));
    this.input.focus();
    cx.spawn(async (cx) => {
      try {
        if (!this.terminal) throw new Error("No terminal has focus");
        const r = await hc(["read", this.terminal, "--json", "--lines", "400"]);
        if (r.code !== 0) throw new Error((r.stderr || "Cannot read the terminal").trim());
        // What's on screen is newest; the session's transcript has everything that scrolled away.
        const candidates = mentions(JSON.parse(r.stdout).text ?? "");
        const { session, paths } = await this.fromTranscript().catch(() => ({ session: null, paths: [] }));
        candidates.push(...paths);
        // What was found last time for this session stays (if it still exists): a busy screen
        // can't empty the list.
        const last = FOUND.get(this.terminal);
        if (last && last.session === session) candidates.push(...last.files);
        const files = await existing([...new Set(candidates)], this.cwd, this.on);
        // Keep the row chosen while this looked, if it's still there.
        const chosen = this.shown()[this.at];
        this.files = files;
        FOUND.delete(this.terminal); FOUND.set(this.terminal, { session, files });
        if (FOUND.size > FOUND_MAX) FOUND.delete(FOUND.keys().next().value);
        this.at = Math.max(0, this.shown().indexOf(chosen));
      } catch (e) { if (!this.files?.length) { this.error = String(e?.message ?? e); this.files = []; } }
      cx.notify();
    });
  }

  // Plain Enter or click opens a file the way a Cmd+click does (a split, or a tab with the setting);
  // with Cmd (or Ctrl) the other way.
  split(modified) { return Boolean(modified) === this.tabs; }

  // The Markdown files the terminal's Claude Code session mentioned or touched, and which session
  // that is, from Revive's labels and the session's transcript. None for another machine's terminal.
  async fromTranscript() {
    if (this.on) return { session: null, paths: [] };
    const r = await hc(["get", this.terminal, "--json"]);
    const labels = r.code === 0 ? JSON.parse(r.stdout)?.labels ?? {} : {};
    const session = labels["revive.session"] ?? null, cwd = labels["revive.cwd"];
    if (!session || !cwd) return { session, paths: [] };
    // Transcripts run past readTextFile's 1 MiB; only the end is read, so a long session stays fast.
    const path = transcriptPath(home(), cwd, session);
    let text = await fs.readFile(path, "utf8").catch(() => null);
    if (text === null) text = (await exec("tail", ["-c", String(TRANSCRIPT_TAIL), path]).catch(() => null))?.stdout ?? null;
    if (text && text.length > TRANSCRIPT_TAIL) text = text.slice(text.indexOf("\n", text.length - TRANSCRIPT_TAIL) + 1);
    return { session, paths: text ? transcriptMentions(text, home()) : [] };
  }

  shown() {
    const q = this.filter.trim().toLowerCase();
    return (this.files ?? []).filter((f) => !q || pretty(f).toLowerCase().includes(q));
  }

  choose(file, split, cx) {
    const typed = this.filter.trim();
    if (!file && typed) {
      // Nothing listed matches: try what was typed as a path.
      cx.spawn(async (cx) => {
        const [found] = await existing([typed], this.cwd, this.on).catch(() => []);
        if (found) { open(found, this.on, split, this.pane); closeOverlay(this.overlay); }
        else { this.error = `No file at ${typed}`; cx.notify(); }
      });
      return;
    }
    if (!file) return;
    open(file, this.on, split, this.pane);
    closeOverlay(this.overlay);
  }

  render(cx) {
    const t = theme(), list = this.shown();
    if (this.at >= list.length) this.at = Math.max(0, list.length - 1);
    const row = (f, i) => h_flex().id(`md-${i}`).h(44).px(12).gap(10).flex_none().items_center().rounded(7).cursor_pointer()
      .bg(i === this.at ? t.selected : t.popover).hover((s) => s.bg(i === this.at ? t.selected : t.hover))
      .on_click((e, cx) => this.choose(f, this.split(e?.modifiers?.platform || e?.modifiers?.control), cx))
      .child(drawIcon("file").size(16).flex_none().text_color(t.muted))
      .child(v_flex().flex_1().min_w(0)
        .child(div().text_size(13).font_semibold().truncate().child(base(f)))
        .child(div().text_size(11).text_color(t.dim).truncate().child(pretty(dir(f)))))
      .child(div().id(`md-split-${i}`).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
        .hover((s) => s.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.choose(f, true, cx); })
        .child(drawIcon("split").size(14)));
    const note = this.error ?? (this.files === null ? "Reading the terminal…"
      : !this.files.length ? "No Markdown files in this terminal's recent output. Type a path."
      : !list.length ? "No match. Enter tries it as a path." : null);
    return v_flex().id("md-picker").size_full().bg(t.popover).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => {
        const n = list.length;
        if (e.key === "escape") { closeOverlay(this.overlay); return; }
        if (e.key === "down" && n) this.at = (this.at + 1) % n;
        else if (e.key === "up" && n) this.at = (this.at + n - 1) % n;
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().h(46).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border)
        .child(drawIcon("file").size(16).text_color(t.accent))
        .child(div().flex_1().min_w(0).h_full().flex().items_center().child(Input.new(this.input).w_full().text_size(14).text_color(t.foreground))))
      .child(v_flex().id("md-list").h(330).flex_none().overflow_y_scrollbar().p(6).gap(1)
        .children(list.map(row))
        .when(Boolean(note), (e) => e.child(div().px(12).py(16).text_size(12).text_color(this.error ? t.ansi1 : t.dim).child(note))))
      .child(h_flex().h(30).flex_none().px(14).gap(14).items_center().border_t(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(this.tabs ? "↵ new tab" : "↵ split beside").child(`${mac() ? "⌘" : "ctrl "}↵ ${this.tabs ? "split beside" : "new tab"}`).child("↑↓ choose").child("esc close"));
  }
}

// Where Obsidian lists its vaults: macOS, then Linux.
const VAULT_LISTS = ["Library/Application Support/obsidian/obsidian.json", ".config/obsidian/obsidian.json"];

class Viewer {
  constructor(file, on, cx) {
    this.file = file; this.on = on; this.history = [];
    // Live preview (the note drawn, a clicked block edited in place) or Source (the whole file in
    // one editor), remembered per copy. "source" = "1" is upstream's way of remembering Source.
    this.source = localStorage.getItem("mode") === "source" || localStorage.getItem("source") === "1";
    this.gen = 0; this.rev = 0; this.typing = 0; this.parts = []; this.pictures = {};
    this.press = null; this.handled = false; this.linked = false;
    pruneOld();
    this.load(cx);
    this.listen(cx);
    cx.timer.every(on ? 3000 : 15000, (cx) => this.reload(cx)); // a remote file can't be watched; a local one is, this is the backstop
  }

  // open.sh (the Markdown Router on macOS, while Herdr is in front) asks a viewer that's showing to
  // take the file: it writes data/markdown-viewer/request.json and runs `markdown-viewer.show`.
  // The one that takes it answers in data/markdown-viewer/ack; with no answer, open.sh splits a new one.
  listen(cx) {
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c !== "show") continue;
        try {
          const folder = DATA();
          const req = JSON.parse(await fs.readFile(`${folder}/request.json`, "utf8"));
          if (!req?.file || req.id === this.answered) continue;
          this.answered = req.id;
          await fs.writeFile(`${folder}/ack`, req.id);
          if (req.file !== this.file || this.on) this.go(req.file, null, cx);
          cx.notify();
        } catch {}
      }
    });
  }

  // Shows another file here. Unsaved typing is written to the file it was typed in first.
  go(file, on, cx, { back = false } = {}) {
    this.flush();
    if (!back) this.history.push({ file: this.file, on: this.on });
    this.file = file; this.on = on;
    this.load(cx);
    cx.notify();
  }

  load(cx) {
    const gen = ++this.gen, file = this.file;
    this.text = null; this.error = null; this.editor?.release(); this.editor = null; this.embeds = {};
    this.doc = { lead: "", blocks: [] }; this.active = null;
    this.status = null; this.conflict = null; this.gone = false;
    this.saving = null; this.again = false; this.typing++;
    this.parts.forEach((p) => p.code?.editor?.release()); this.parts = [];
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(file, { on: this.on });
        if (gen !== this.gen) return;
        if (text === null) this.error = GONE;
        else this.set(text, cx);
      } catch (e) { if (gen === this.gen) this.error = String(e?.message ?? e); }
      cx.notify();
      if (!this.on && gen === this.gen) this.watch(gen, cx);
    });
  }

  // `text` is what the file holds now (as read, or as just written). It doesn't change what's in an
  // editor already made: absorb() and takeTheirs() do that. In live preview the blocks are the
  // editor, so they're drawn from it, not from `text`.
  set(text, cx) {
    this.text = text; this.rev++;
    this.editor ??= this.newEditor(text);
    if (!this.editor?.live) this.doc = Doc.split(text);
    this.rebuild(cx);
  }

  // Source: a code editor (read-only for another machine's file). Live preview: the blocks, or no
  // editor at all for another machine's file.
  newEditor(text) {
    if (this.source) return this.makeEditor(text);
    if (this.on) return null;
    this.doc = Doc.split(text);
    return this.makeLive();
  }

  // Each block drawn on its own (code, pictures and text cut out of it), so a click knows its block.
  // Source shows none of it, so it has none.
  rebuild(cx) {
    const before = this.parts;
    if (this.source) { this.parts = []; this.keepOrMakeCode(before); return; }
    this.parts = this.doc.blocks.flatMap((b, i) => blocks(obsidian(b.text, { pictures: this.embeds, frontMatter: b.kind === "front" }), this.file)
      .map((p) => ({ ...p, block: i })));
    this.keepOrMakeCode(before);
    this.checkPictures(cx);
    this.findEmbeds(cx);
  }

  // Live preview: the blocks, joined, are the text being edited. The one clicked shows its
  // Markdown in a text box; the rest stay drawn.
  makeLive() {
    return {
      live: true,
      value: () => Doc.join(this.doc),
      set_value: (text) => this.adopt(text),
      release: () => { const a = this.active; this.active = null; a?.ta.release(); },
    };
  }

  // The text changed under the blocks (a merge, Take theirs): split it again, and keep editing the
  // block that was being edited if it's still there.
  adopt(text) {
    const doc = Doc.split(text), a = this.active;
    if (a) {
      a.i = Doc.nearest(doc, a.ta.value(), a.i);
      if (a.i < 0) { this.active = null; a.ta.release(); }
    }
    this.doc = doc;
  }

  // Clicks. A press records its target (a block, the block being edited, a control, the space
  // below the last block); one nothing claimed was on empty space. The release, anywhere in the
  // note, acts on it, so one block closes in the frame the next opens. A drag, a Cmd+click or a
  // click on a link does nothing (the link's handler runs in the same release, so this waits a tick).
  pressed(what) { this.press = what; this.handled = true; this.linked = false; }

  pressedNote() {
    if (!this.handled) this.pressed({ empty: true });
    this.handled = false;
  }

  released(e, cx) {
    const down = this.press;
    this.press = null;
    if (!down || down.inside || down.control || e?.modifiers?.platform || e?.modifiers?.control) return;
    if (down.empty) { this.finishEdit(cx); return; }
    if (down.add) { this.appendBlock(cx); return; }
    if (Math.abs(e.position.x - down.e.position.x) + Math.abs(e.position.y - down.e.position.y) > 4) return;
    cx.timer.after(1, (cx) => { if (!this.linked) this.clickBlock(down.i, down.b, down.e, cx); });
  }

  // The cursor goes where the press was, as near as caret.js can tell.
  clickBlock(i, b, e, cx) {
    const text = b.text;
    if (!this.editor?.live || this.conflict !== null || this.active?.i === i) return;
    const p = e?.local_position, size = e?.bounds;
    const caret = p && size ? caretAt(text, b.kind, p.x, p.y, size.width, size.height) : text.length;
    this.finishEdit(cx);
    // Leaving another block may have split the blocks again: find this one by its text.
    const k = Doc.nearest(this.doc, text, i);
    if (k >= 0) this.startEdit(k, cx, caret);
  }

  // Edits block `i` (none is being edited), the cursor at offset `caret` of its text. `added`: the
  // gap the block before had, when this block was just added (put back if it's left empty).
  startEdit(i, cx, caret, added = null) {
    const text = this.doc.blocks[i]?.text;
    if (text === undefined) return;
    const ta = TextareaState.new({ value: text });
    ta.set_auto_grow(1, 400); ta.set_soft_wrap(true);
    ta.on("change", (_e, cx) => { if (this.active?.ta === ta) this.blockTyped(cx); });
    this.active = { i, ta, original: text, added, before: Doc.join(this.doc) };
    ta.focus();
    const at = Math.min(caret, text.length);
    ta.set_selected_range({ start: at, end: at });
    cx.notify();
  }

  // A blank line, a new list item or a line after a heading makes more blocks: typing goes on in
  // the one holding the cursor, at the same place.
  blockTyped(cx) {
    const a = this.active, value = a.ta.value(), caret = a.ta.selected_range().end;
    const first = a.i, last = Doc.replace(this.doc, a.i, value);
    if (last !== first) {
      // Where each new block starts in what was typed, to find the one with the cursor.
      let from = 0, k = first, offset = 0;
      for (let n = first; n <= last; n++) {
        const at = value.indexOf(this.doc.blocks[n].text, from);
        if (at < 0) break;
        if (at <= caret) { k = n; offset = caret - at; }
        from = at + this.doc.blocks[n].text.length;
      }
      this.active = null; a.ta.release();
      this.rebuild(cx);
      this.startEdit(k, cx, offset);
    }
    this.typed(cx);
  }

  // Leaving a block draws it again; one left empty goes away. Trailing newlines typed at its end
  // are dropped (the gap after it already ends the block). Left as it was, the file isn't touched.
  finishEdit(cx) {
    const a = this.active;
    if (!a) return;
    this.active = null;
    const value = a.ta.value();
    a.ta.release();
    if (value !== a.original) Doc.replace(this.doc, a.i, value.replace(/(\r?\n)+$/, ""));
    if (!this.doc.blocks[a.i]?.text.trim()) {
      Doc.remove(this.doc, a.i);
      if (a.added !== null && a.i > 0) this.doc.blocks[a.i - 1].gap = a.added;
    }
    const text = Doc.join(this.doc);
    this.doc = Doc.split(text);
    // Left as it was: what's drawn is still right, so nothing is drawn again but the block.
    if (text !== a.before) { this.rebuild(cx); this.typed(cx); }
    cx.notify();
  }

  // Below the last block, or in an empty file: a new block.
  appendBlock(cx) {
    if (!this.editor?.live || this.conflict !== null) return;
    this.finishEdit(cx);
    const gap = this.doc.blocks[this.doc.blocks.length - 1]?.gap ?? "";
    const i = Doc.append(this.doc);
    this.rebuild(cx);
    this.startEdit(i, cx, 0, gap);
  }

  // Source (one editor for the whole file) or live preview; what was typed carries over.
  toggleSource(cx) {
    this.finishEdit(cx);
    const value = this.editor?.value() ?? this.text;
    this.editor?.release(); this.editor = null;
    this.source = !this.source;
    try { localStorage.setItem("mode", this.source ? "source" : "live"); localStorage.removeItem("source"); } catch {}
    if (value !== null) { this.editor = this.newEditor(value); this.set(this.text, cx); this.typed(cx); }
    cx.notify();
  }

  // Editing. The editor always holds this.text (the file as last read or written) plus what was
  // typed since. A change on disk is merged into it by lines (merge.js), so an agent writing to the
  // file while you type lands in the editor too; only edits to the same lines stop and ask.
  writable() { return !this.on && Boolean(this.editor) && this.conflict === null && !this.gone; }
  dirty() { return Boolean(this.editor) && this.editor.value() !== this.text; }

  typed(cx) {
    if (!this.writable() || !this.dirty()) return;
    this.status = "Unsaved";
    const n = ++this.typing;
    cx.timer.after(SAVE_MS, (cx) => { if (n === this.typing) this.save(cx); });
    cx.notify();
  }

  save(cx) {
    if (!this.writable()) return;
    if (this.saving !== null) { this.again = true; return; }
    const value = this.editor.value(), expected = this.text, gen = this.gen, file = this.file;
    if (value === expected) { this.status = "Saved"; cx.notify(); return; }
    this.saving = value; this.status = "Saving…"; cx.notify();
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(file, value, expected);
        if (gen !== this.gen) return;
        this.set(value, cx); this.status = this.dirty() ? "Unsaved" : "Saved";
      } catch {
        // Changed on disk since it was read: merge that in, then save again. Gone: ask.
        const disk = await readTextFile(file).catch(() => undefined);
        if (gen !== this.gen) return;
        if (disk === null) { this.gone = true; this.status = null; }
        else if (typeof disk === "string" && disk !== expected) { this.absorb(disk, cx); this.again = this.conflict === null; }
        // Unchanged on disk means the write itself failed (permissions, a full disk): stop retrying.
        else { this.status = "Couldn't save"; this.typing++; }
      } finally {
        if (gen === this.gen) { this.saving = null; if (this.again) { this.again = false; this.save(cx); } }
        cx.notify();
      }
    });
  }

  // The file now holds `disk`. Without unsaved typing, the editor just shows it; with some, both
  // are merged, or the conflict bar asks which to keep.
  absorb(disk, cx) {
    if (!this.editor) { this.set(disk, cx); return; }
    const mine = this.editor.value(), merged = merge3(this.text, mine, disk);
    if (merged === null) { this.conflict = disk; this.status = null; return; }
    this.set(disk, cx);
    if (merged !== mine) { this.editor.set_value(merged); this.rebuild(cx); }
    if (merged !== disk) this.typed(cx);
  }

  keepMine(cx) {
    const disk = this.conflict;
    this.conflict = null; this.set(disk, cx); this.save(cx);
  }

  takeTheirs(cx) {
    const disk = this.conflict;
    this.conflict = null; this.set(disk, cx); this.editor?.set_value(disk); this.rebuild(cx); this.status = null; cx.notify();
  }

  // The file was deleted or moved while there was typing to save: write it back, or let it go.
  saveAgain(cx) {
    const value = this.editor.value(), gen = this.gen;
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(this.file, value, null);
        if (gen !== this.gen) return;
        this.gone = false; this.set(value, cx); this.status = this.dirty() ? "Unsaved" : "Saved";
        this.typed(cx);
      } catch (e) { this.status = "Couldn't save"; }
      cx.notify();
    });
  }

  discard(cx) {
    this.gone = false; this.editor?.release(); this.editor = null; this.active = null;
    this.error = GONE; cx.notify();
  }

  // Unsaved typing is written before the viewer shows another file or closes. There's no merge
  // then: if the file changed meanwhile, the write is refused and the file keeps the other change.
  // While a save runs, the file will hold what it's writing.
  async flush() {
    if (!this.writable() || !this.dirty()) return;
    const expected = this.saving ?? this.text;
    await writeTextFile(this.file, this.editor.value(), expected).catch(() => null);
  }

  // One read-only code editor per block, made here because that can't happen while drawing. A block
  // that didn't change keeps its editor, so reloading doesn't lose a selection.
  keepOrMakeCode(before) {
    const spare = new Map();
    for (const { code } of before) {
      if (!code?.editor) continue;
      const key = `${code.language}\n${code.text}`;
      spare.set(key, [...(spare.get(key) ?? []), code.editor]);
    }
    for (const { code } of this.parts) {
      if (!code) continue;
      code.editor = spare.get(`${code.language}\n${code.text}`)?.pop() ?? this.makeCode(code);
    }
    for (const editors of spare.values()) for (const editor of editors) editor.release();
  }

  makeCode({ language, text }) {
    const t = theme(), name = language.toLowerCase();
    return EditorState.new({ language: LANGUAGES[name] ?? name, value: text, readonly: true, soft_wrap: false, folding: false,
      line_numbers: false, font_family: settings().font_family, font_size: CODE.font,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, boolean: t.ansi1, operator: t.muted, punctuation: t.muted } });
  }

  copy(code, cx) {
    cx.write_to_clipboard(code.text);
    this.copied = code;
    cx.notify();
    cx.timer.after(1500, (cx) => { if (this.copied === code) { this.copied = null; cx.notify(); } });
  }

  // A soft block with its language and a copy button in the corner.
  codeBlock(key, code, t) {
    const height = code.text.split("\n").length * CODE.line + 2 * CODE.top, copied = this.copied === code;
    return div().id(key).relative().w_full().h(height).flex_none().rounded(10).bg(t.raised).overflow_hidden()
      .child(div().size_full().px(CODE.left).py(CODE.top).child(Editor.new(code.editor).size_full()))
      .child(h_flex().absolute().top(7).right(7).gap(4).items_center()
        .when(Boolean(code.language), (e) => e.child(div().h(22).px(8).flex().items_center().rounded(6).bg(t.background).text_size(11).text_color(t.muted).child(code.language)))
        .child(h_flex().id(`${key}-copy`).h(22).px(6).gap(4).items_center().rounded(6).bg(t.background).cursor_pointer().text_size(11)
          .text_color(copied ? t.foreground : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_mouse_down("left", () => this.pressed({ control: true }))
          .on_click((_e, cx) => { cx.stop_propagation(); this.copy(code, cx); })
          .child(drawIcon(copied ? "check" : "copy").size(13).flex_none())
          .when(copied, (e) => e.child("Copied"))));
  }

  // Local images load by themselves, and are checked again in case they changed. A file on another
  // machine isn't here to copy from, so its images stay as a note.
  checkPictures(cx) {
    if (this.on || this.checking) return;
    const gen = this.gen, local = this.parts.flatMap((p) => p.images ?? []).filter((i) => !i.web);
    if (!local.length) return;
    this.checking = true;
    cx.spawn(async (cx) => {
      try {
        for (const { src } of local) {
          const found = await loadLocal(src).catch(() => ({ state: "failed", why: "could not be read" }));
          if (gen !== this.gen) return;
          if (JSON.stringify(found) !== JSON.stringify(this.pictures[src])) { this.pictures[src] = found; cx.notify(); }
        }
      } finally { this.checking = false; }
    });
  }

  // The vault holding this file, from Obsidian's list, or null (a file outside every vault, or on
  // another machine). Asked once per file.
  async vault() {
    if (this.on) return null;
    if (this.vaultFor?.file === this.file) return this.vaultFor.vault;
    let vault = null;
    for (const list of VAULT_LISTS) {
      const json = await readTextFile(`${home()}/${list}`).catch(() => null);
      if (json && (vault = vaultOf(this.file, json))) break;
    }
    this.vaultFor = { file: this.file, vault };
    return vault;
  }

  // The file a wikilink names, as Obsidian finds it: beside this note, from the vault's root, else
  // the shallowest file of that name anywhere in the vault (case doesn't matter). Null if none.
  async findLinked(target) {
    const vault = await this.vault();
    const [hit] = await existing(wikiCandidates(target, this.file, vault), null, this.on).catch(() => []);
    if (hit || !vault) return hit ?? null;
    const name = fileName(target), pattern = base(name).replace(/[*?[\]\\]/g, "\\$&");
    const r = await exec("find", [vault, "-type", "f", "-iname", pattern, "-not", "-path", "*/.obsidian/*", "-not", "-path", "*/.trash/*"]).catch(() => null);
    const tail = `/${name}`.toLowerCase();
    return closest((r?.stdout ?? "").split("\n").filter((p) => p.toLowerCase().endsWith(tail)));
  }

  // Pictures a note embeds by name (![[diagram.png]]) can be anywhere in the vault: each is looked
  // up once, and the note is drawn again with the ones found.
  findEmbeds(cx) {
    const gen = this.gen, names = embeddedPictures(this.text ?? "").filter((n) => !(n in this.embeds));
    if (!names.length) return;
    for (const n of names) this.embeds[n] = null;
    cx.spawn(async (cx) => {
      let found = false;
      for (const n of names) {
        const path = await this.findLinked(n).catch(() => null);
        if (gen !== this.gen) return;
        if (path) { this.embeds[n] = path; found = true; }
      }
      if (found && this.text !== null) { this.rebuild(cx); cx.notify(); }
    });
  }

  // A [[wikilink]]: a note opens here (Back returns); another file is shown in its folder.
  followWiki({ target }, cx) {
    if (!target) return; // [[#Heading]]: this note
    cx.spawn(async (cx) => {
      const path = await this.findLinked(target).catch(() => null);
      if (!path) { notify({ title: `No note named ${target}`, level: "warning" }); return; }
      this.show(path, cx);
    });
  }

  // A web image downloads only here, after a click.
  fetchWeb(url, cx) {
    if (this.pictures[url]?.state === "loading") return;
    this.pictures[url] = { state: "loading" };
    cx.notify();
    cx.spawn(async (cx) => {
      this.pictures[url] = await loadWeb(url).catch(() => ({ state: "failed", why: "could not be downloaded" }));
      cx.notify();
    });
  }

  // As GitHub sizes one: its width attribute, else its own, never wider than the column.
  picture(key, item, t) {
    const found = this.pictures[item.src];
    const room = Math.max(160, Math.min(860, this.width ?? 860) - 56);
    if (found?.state === "ready") {
      const w = Math.min(item.width ?? found.width, room), h = Math.max(1, Math.round(found.height * w / found.width));
      return image(found.path).w(w).h(h).flex_none().rounded(6);
    }
    const host = item.web ? item.src.replace(/^https?:\/\//i, "").split("/")[0] : item.src.slice(item.src.lastIndexOf("/") + 1);
    const label = item.alt || host;
    const note = item.web
      ? (found?.state === "loading" ? "Loading…" : found?.state === "failed" ? `${host}: ${found.why}. Click to retry` : item.alt ? `${host}: click to load` : "Click to load")
      : this.on ? `On ${this.on}` : found?.state === "failed" ? `${host}: ${found.why}` : "Loading…";
    return h_flex().id(key).h(30).px(10).gap(8).flex_none().min_w(0).items_center().rounded(6).border_1().border_color(t.border).bg(t.raised)
      .text_size(12).text_color(t.muted).overflow_hidden().max_w(room)
      .when(Boolean(item.web), (e) => e.cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_mouse_down("left", () => this.pressed({ control: true }))
        .on_click((_e, cx) => this.fetchWeb(item.src, cx)))
      .child(drawIcon("image").size(14).flex_none())
      .child(div().min_w(0).truncate().child(label))
      .child(div().flex_none().text_color(t.dim).child(note));
  }

  makeEditor(value) {
    const t = theme();
    const editor = EditorState.new({ language: "markdown", value, readonly: Boolean(this.on), soft_wrap: true, folding: false,
      line_numbers: false, font_family: settings().font_family, font_size: 14,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6, punctuation: t.muted } });
    editor.on("change", (_e, cx) => this.typed(cx));
    return editor;
  }

  reload(cx) {
    const gen = this.gen, rev = this.rev, file = this.file;
    cx.spawn(async (cx) => {
      const text = await readTextFile(file, { on: this.on }).catch(() => undefined);
      // A read that started before the last save or load may hold what that replaced.
      if (gen !== this.gen || rev !== this.rev || text === undefined || this.saving !== null) return;
      if (text === this.text) {
        if (this.conflict !== null) { this.conflict = null; this.typed(cx); cx.notify(); }
        this.checkPictures(cx);
        return;
      }
      if (text === null) { if (this.dirty()) this.gone = true; else this.error = GONE; }
      else { this.error = null; this.gone = false; this.absorb(text, cx); }
      cx.notify();
    });
  }

  watch(gen, cx) {
    const folder = dir(this.file);
    cx.spawn(async (cx) => {
      while (gen === this.gen) {
        try { await watchFolder(folder); } catch { return; }
        if (gen === this.gen) this.reload(cx);
      }
    });
  }

  // Links: another .md file opens here (Back returns); web links go to the browser;
  // any other local file is only shown in its folder, never opened (a link could point at
  // something that runs).
  link(url, cx) {
    this.linked = true;
    const wiki = wikiTarget(url);
    if (wiki) { this.followWiki(wiki, cx); return; }
    if (/^(https?|mailto):/i.test(url)) { openLink(url); return; }
    if (/^[a-z][\w+.-]*:/i.test(url) && !url.startsWith("file:")) return;
    let path = url.replace(/^file:\/\//, "").split("#")[0];
    try { path = decodeURIComponent(path); } catch {}
    if (!path) return;
    this.show(absolute(path, dir(this.file), home()), cx);
  }

  // A Markdown file opens here (Back returns); another file is only shown in its folder.
  show(path, cx) {
    if (MARKDOWN.test(path)) this.go(path, this.on, cx);
    else if (!this.on) reveal(path);
  }

  back(cx) {
    const prev = this.history.pop();
    if (prev) this.go(prev.file, prev.on, cx, { back: true });
  }

  // The blocks, drawn, and the one being edited as its Markdown.
  blockViews(t) {
    const byBlock = [];
    this.parts.forEach((part, n) => (byBlock[part.block] ??= []).push([part, n]));
    return this.doc.blocks.map((b, i) => {
      // A block that draws nothing (a comment) takes no room. List items sit closer together.
      const prev = this.doc.blocks[i - 1], drawn = byBlock[i]?.length || this.active?.i === i;
      const top = !prev || !drawn ? 0 : prev.kind === "item" && b.kind === "item" ? 4 : 12;
      const key = `md-b-${this.gen}-${i}`;
      if (this.active?.i === i) {
        const level = b.kind === "heading" ? /^ {0,3}(#{1,6})/.exec(b.text)?.[1].length ?? 0 : 0;
        const size = FONT * (HEADING_SCALE[level - 1] ?? 1);
        return div().id(key).mt(top).w_full()
          .on_key_down((e, cx) => { if (e.key === "escape") { cx.stop_propagation(); this.finishEdit(cx); } })
          .on_mouse_down("left", () => this.pressed({ inside: true }))
          .child(Textarea.new(this.active.ta).w_full().text_size(size).p(0).border_0().bg(t.background));
      }
      return v_flex().id(key).mt(top).w_full().gap(12)
        .on_mouse_down("left", (e) => this.pressed({ i, b, e }))
        .children((byBlock[i] ?? []).map(([part, n]) => part.code
          ? this.codeBlock(`md-code-${this.gen}-${n}`, part.code, t)
          : part.images
          ? h_flex().w_full().flex_wrap().gap(8).items_center().children(part.images.map((item, k) => this.picture(`md-image-${this.gen}-${n}-${k}`, item, t)))
          : TextView.markdown(`md-${this.gen}-${n}`, part.text).selectable(true).on_link_click((url, cx) => this.link(url, cx))));
    });
  }

  render(cx) {
    const t = theme(), stop = (_e, cx) => cx.stop_propagation();
    const button = (id, icon, title, action) => h_flex().id(id).h(26).px(8).gap(5).flex_none().items_center().rounded(6).text_size(12)
      .bg(t.background).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop).on_click(action)
      .child(drawIcon(icon).size(14)).when(Boolean(title), (e) => e.child(title));
    // A bar under the header that pauses saving until one of its buttons is pressed.
    const bar = (message, ...buttons) => h_flex().flex_none().px(12).py(8).gap(8).items_center().bg(t.raised)
      .border_b(1).border_color(t.border).text_size(12)
      .child(div().flex_1().min_w(0).text_color(t.ansi3).child(message)).children(buttons);
    const live = Boolean(this.editor?.live), add = () => this.pressed({ add: true });
    const content = this.error ? div().p(20).text_color(t.ansi1).child(this.error)
      : this.text === null ? div().p(20).text_color(t.dim).child("Loading…")
      : this.source
        ? div().flex_1().min_h(0).px(18).py(10).when(Boolean(this.editor), (e) => e.child(Editor.new(this.editor).size_full()))
        : div().id("md-scroll").flex_1().min_h(0).overflow_y_scrollbar()
            // Blocks see a press first; one that reaches here alone was on empty space.
            .on_mouse_down("left", () => this.pressedNote())
            .on_mouse_up("left", (e, cx) => this.released(e, cx))
            .child(h_flex().w_full().justify_center()
              .child(v_flex().flex_1().min_w(0).max_w(860).overflow_hidden().px(28).py(24).text_size(14)
                .child(this.doc.blocks.length
                  ? v_flex().w_full().children(this.blockViews(t))
                  : div().id("md-empty").text_color(t.dim).when(live, (e) => e.cursor_pointer().on_mouse_down("left", add))
                      .child(live ? "This file is empty. Click to write." : "This file is empty."))
                .when(live && this.doc.blocks.length > 0, (e) => e.child(div().id("md-add").w_full().h(80).flex_none().on_mouse_down("left", add)))));
    return v_flex().id("md-viewer").size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .child(h_flex().h(40).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .when(this.history.length > 0, (e) => e.child(button("md-back", "back", "Back", (_e, cx) => this.back(cx))))
        .child(drawIcon("file").size(14).flex_none().text_color(t.accent))
        .child(div().flex_none().text_size(13).font_semibold().child(base(this.file)))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child((this.on ? `${this.on}:` : "") + pretty(dir(this.file))))
        .when(Boolean(this.status), (e) => e.child(div().flex_none().text_size(11).text_color(this.status === "Couldn't save" ? t.ansi1 : t.dim).child(this.status)))
        // Editor state can't be created while drawing, so toggleSource makes it.
        .child(button("md-mode", this.source ? "eye" : "code", this.source ? "Preview" : "Source", (_e, cx) => this.toggleSource(cx)))
        .when(!this.on, (e) => e
          .child(button("md-reveal", "folder", null, () => { reveal(this.file); }))
          .child(button("md-external", "external", null, () => { openElsewhere(this.file); }))))
      .when(this.conflict !== null, (e) => e.child(bar("The file changed on disk in the lines you're editing. Saving is paused.",
        button("md-keep-mine", "check", "Keep mine", (_e, cx) => this.keepMine(cx)),
        button("md-take-theirs", "file", "Take theirs", (_e, cx) => this.takeTheirs(cx)))))
      .when(this.gone, (e) => e.child(bar("The file was deleted or moved while you were typing. Saving is paused.",
        button("md-save-again", "check", "Save again", (_e, cx) => this.saveAgain(cx)),
        button("md-discard", "file", "Discard", (_e, cx) => this.discard(cx)))))
      .child(content);
  }
}
