# Markdown Viewer

When a coding agent mentions a Markdown file, cmd-click the path in the conversation and read it rendered, right beside the conversation, instead of switching to another app. On macOS, a background app routes those clicks to the viewer. The viewer reloads the file as it changes and follows links to other Markdown files. A picker lists the `.md` paths on the focused terminal's screen, and is how you open files on Linux.

![Markdown Viewer](preview.png)

## What you see

**The picker**, a 620×440 popup at the top of the window, 40 px down, on `popover`:

- A 46 px row with a file icon in `accent` and a text input: "Filter, or type a path…".
- A 330 px scrolling list. Each row is 44 px with radius 7: a file icon, the file name at 13 px semibold, its folder at 11 px `dim` with home shown as `~`, and a split button on the right. The current row is on `selected`.
- A 30 px footer at 11 px `dim`: "↵ split beside", "⌘↵ new tab" (the other way round with `"click": "tab"`) ("ctrl ↵" off macOS), "↑↓ choose", "esc close".
- With nothing to list: "No Markdown files in this terminal's recent output. Type a path."

**The viewer**, a tab or a pane on `background`:

- A 40 px header with a `border` line below: Back when there's history, a file icon in `accent`, the file name at 13 px semibold, its folder at 11 px `dim` (prefixed with the machine for a remote file), and 26 px buttons for Source or Preview, show in folder, and open elsewhere. The last two are hidden for remote files.
- Code blocks on `raised`, radius 10, 14/12 px padding, 13 px mono with no line numbers, 21 px per line and no blank first line. In the top-right corner, 7 px in: the language as written, at 11 px on a `background` chip, and a copy button.
- Images between the text, at their own size or `width` attribute, never wider than the column, radius 6. Images not shown yet are 30 px `raised` chips with an icon, the alt text and a note.
- The file rendered at 14 px, centered to at most 860 px, with 28/24 px padding. Source shows it in an editor with Markdown highlighting (read-only for remote files). Front matter shows as a two-column "Property | Value" table at the top.
- Notes: "Loading…", "This file is empty." (in live preview: "This file is empty. Click to write."), "This file isn't there (anymore)."

## How it behaves

- **Agent status:** it shows none; working, blocked, done and idle agents look the same.
- **The picker opens** with the last list it found for that terminal (kept for 50 terminals, shared by every copy), then rebuilds it. First the paths in the terminal's last 400 lines, lowest first. Then, for a terminal with Revive's `revive.session` and `revive.cwd` labels, the Markdown paths in the last 4 MB of that Claude Code transcript, `~/.claude/projects/<cwd, characters other than letters, digits and - as ->/<session>.jsonl`, newest first: the agent's messages, its tools' `file_path` or `path`, and paths in its shell commands, a relative one resolved from its entry's `cwd`. Then the last list for the same session. It keeps the files that exist where the terminal runs, in that order, and shows the list even with one match.
- **Keys in the picker:** Enter opens a split beside the terminal (a tab named after the file with `"click": "tab"`), cmd-Enter the other, up and down move, Esc closes, typing filters. If nothing matches, Enter tries the text as a path.
- **Mouse in the picker:** a click opens it as Enter does, a cmd- or ctrl-click the other way, and the split button always opens a split. Rows change color on hover.
- **Reloading:** local files are watched, with a check every 15 s as a backstop. Remote files are checked every 3 s.
- **Copy:** puts the block's exact text on the clipboard. The button shows a check and "Copied" for 1.5 s.
- **Long code lines** scroll sideways inside the block; they don't wrap.
- **Local images** (relative, absolute, `~/`, `file://`) show by themselves, and update if the image changes. A missing or unusable one shows a chip saying why.
- **Web images** stay a chip reading "click to load" until clicked, then download once. Nothing is fetched just because a file was opened. A failed download can be clicked again.
- **Images in remote files** stay a chip naming the machine.
- **Images side by side:** ones with only space between them, such as badges, share a wrapping row.
- **Links:** `.md`, `.markdown` and `.mdx` links open in place, with Back. http, https and mailto links open in the system's handler. Other local files are shown in their folder, never opened.
- **Obsidian syntax** (`obsidian.js`, outside code): `[[Note]]`, `[[Note|alias]]` and `[[Note#Heading]]` are links reading `Note`, `alias` and `Note › Heading`. A click looks for `Note.md` beside the file, then from the root of its vault (the deepest in Obsidian's `obsidian.json`), then anywhere in the vault, case-insensitively, shallowest first, skipping `.obsidian` and `.trash`. A note opens in place, another file is shown in its folder, and no match posts "No note named …". `![[picture.png|300]]` draws the picture, found the same way, at that width. `![[Note]]` is a link after ↳. A callout or GitHub alert (`> [!type] Title`) starts with a bold line: the type's symbol and the title, or the type. `==text==` is bold. `%%comments%%`, `^block-ids` and lines holding only a block id are hidden.
- **Live preview** (`doc.js`, `caret.js`), local files only: each heading, paragraph, list item, quote, table, fenced block, comment and the front matter is a block, drawn on its own, list items 4 px apart and other blocks 12 px. Releasing a click on a block turns it into a borderless text box with its Markdown at the block's text size, the cursor where `caret.js` estimates the click landed (Herdr can't say which character is under the pointer). It closes in the frame the next one opens, or on Esc or a click on empty space. A click on a link, a drag or a Cmd+click doesn't edit. A blank line, a new list item or a line after a heading splits the block, and typing goes on in the part with the cursor. A block left empty is removed. A file left untouched isn't rewritten: `split` and `join` keep every character.
- **Source or live preview** is remembered per copy of the mod. Live preview is the default.
- **Saving** (`merge.js`): 0.8 s after the last keystroke, with `writeTextFile(file, text, expected)`, so a write never replaces a change it hasn't seen. The header shows Unsaved, Saving…, Saved or Couldn't save. A change on disk is merged into the editor by lines: both sides' changes apply unless they touch the same lines. A clash shows a `raised` bar, "The file changed on disk in the lines you're editing. Saving is paused.", with Keep mine and Take theirs. A file deleted or moved while there's typing to save shows "The file was deleted or moved while you were typing. Saving is paused.", with Save again (writes it back) and Discard. Unsaved typing is written before the viewer opens another file or closes. A read that started before the last save is ignored.
- **Open elsewhere:** with the router installed, the app it took over from; otherwise the default app.
- **Cmd-click on macOS, with the router as the default for `.md`:** with Herdr in front, the file goes to the viewer showing in this tab, or a new split on the right; with `{ "click": "tab" }` in `~/.config/herdr-app/markdown-viewer.json`, a new tab named after the file. With anything else in front, it goes to the app the router took over from, or TextEdit if none is known.

## Built from

- **`mods/markdown-viewer`:** `main.js` (picker and viewer), `paths.js` (which candidate paths exist), `markdown.js` (fences and paths), `obsidian.js` (Obsidian syntax to Markdown, finding a wikilink's file), `doc.js` (a file as blocks), `caret.js` (where a click lands in a block's Markdown), `merge.js` (three-way merge by lines), `mentions.js` (Markdown paths in terminal text and in a Claude Code transcript). Those six import nothing from Herdr. Also `icons.js`, `pictures.js` (cutting images and code out of the text, loading images), `mod.json`. Each code block is a read-only `EditorState` with `line_numbers: false`, drawn with `Editor.new`. `props: {file, on?}` makes a viewer; no `file` makes the picker.
- **Opening the picker:** a key bound to `mod.open:markdown-viewer`.
- **Opening a viewer:** `pane.split {direction: "right", pane, mod, props}` or `tab.new {mod, props, name}`.
- **Herdr functions:** `focused`, `panes`, `hc`, `exec`, `run`, `theme`, `settings`, `props`, `closeOverlay`, `home`, `appHome`, `readTextFile`, `writeTextFile`, `watchFolder`, `nextCommand`, `window`, `notify`, plus `fs/promises` and `localStorage`.
- **Programs:** `hc read`, `sh` where the terminal runs. `open` on macOS, `xdg-open` elsewhere. `cksum`, `cp`, `find` for local images and wikilinks, `curl` for web images, `tail` for a transcript the mod can't read whole.
- **Files written:** copies of images in `data/markdown-viewer/images`, readable only by the user, removed after 30 days untouched.
- **`open.sh` (macOS):** writes `data/markdown-viewer/request.json` and runs `markdown-viewer.show`. A shown viewer takes the file and writes `data/markdown-viewer/ack`. With no answer in about 0.4 s, it runs `pane.split`.
- **`router/` (macOS):** `main.swift` and `build.sh` build `~/Applications/Markdown Router.app`, a background-only default handler for `net.daringfireball.markdown`. `--make-default` saves the current default's bundle id in `data/markdown-viewer/fallback`. `--restore` gives Markdown back to it.

## Watch out

- `TextView` draws no images and ignores `text_color`, so images are cut out of the text and `image()` draws copies from the data folder. Text can't be selected across an image.
- The code editor's language names are its own: `cs`, not `csharp`. It has none for TypeScript, JSX, Swift or TOML, and an unknown name shows plain text without an error. Its indent guides can't be turned off, and it scrolls past its last line, with no option or way for a mod to stop it. Drawing colored text instead would avoid that, but text with colors can't be selected: `TextView.html` drops colors.
- A code block's height is set from its line count, because an editor doesn't size itself to its content. A block indented inside a list stays in the Markdown view, with that view's look.
- Only files with an image's extension and header are copied, so `![](~/.ssh/id_rsa)` copies nothing. Reference-style images (`![alt][ref]`) aren't handled.
- Herdr draws images only from real folders, so `svg("mods/...")` comes up blank when the mod's folder is a link to a git clone. `icons.js` writes the icons to `data/markdown-viewer/icons` and draws them from there.
- `<mod>.<command>` reaches only shown copies, which is why `open.sh` needs the acknowledgement.
- `window()` can be null, including during `herdr-app check`, so guard it in `render`.
- `EditorState.new` can't run during `render`, and `herdr-app check` won't catch it unless that path draws at load. Create it in the click handler or when the text loads.
- The running Herdr app on macOS may report no bundle id, so `open.sh` matches its path or the name `herdr-app`.
- Claude Code exposes only its visible screen to `hc read`, which is why the transcript is read too. Files in the home folder are checked with `fs.exists` (a shell per open was slow); others, and remote terminals, with `sh`.
- With the router as the default, plain `open file` comes straight back to Herdr. Open elsewhere has to name the saved app.
- Tested on macOS only. The Linux paths haven't been run. Windows isn't supported: it uses `sh` and `/` paths.

## Done when

- `herdr-app check` passes for `markdown-viewer`.
- With `.md` paths on the terminal's screen, the key lists them newest first, and only those that exist.
- The list shows even with one match. Enter opens a split, cmd-Enter a tab, and typing a path that exists opens it.
- Editing the open file updates the viewer without a click.
- A link to another `.md` file opens in place, and Back returns.
- Source and live preview switch and stay as chosen. A click on a paragraph edits it with the cursor near the click, and a click on another block switches without a frame where neither is open.
- With the router: cmd-click on a path opens it in a split, a second opens in that same viewer, and opening a `.md` from Finder goes to the previous default app.
- `--restore` gives `.md` files back to the previous default app.
- With `{ "click": "tab" }`, cmd-click on a path opens a new tab named after the file.
- In a vault note, a `[[wikilink]]` to a note in another folder opens it, a callout shows its title line, and front matter shows as a table.
- `npm test` passes.
