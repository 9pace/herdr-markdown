#!/bin/sh
# macOS only: opens a Markdown file for the Markdown Router (router/), the default app for .md files.
# $1: the file; $2: the app that was in front (path or name).
# Herdr in front (a cmd-click on a path in a terminal): the viewer already showing takes it, else a
# split on the right; with "click": "tab" in ~/.config/herdr-app/markdown-viewer.json, a new tab.
# Anywhere else (Finder, …): the app that was the default before the router.
# `herdr-app do` exits 1 (printing {"error": …}) when the window refuses a command.
f="$1"; front="$2"
HERDR="$HOME/.local/bin/herdr-app"; DATA="$HOME/.config/herdr-app/data/markdown-viewer"
SETTINGS="$HOME/.config/herdr-app/markdown-viewer.json"
elsewhere() {
  id=$(cat "$DATA/fallback" 2>/dev/null)
  exec open -b "${id:-com.apple.TextEdit}" "$f"
}
case "$front" in *Herdr.app*|herdr-app) ;; *) elsewhere ;; esac
[ -x "$HERDR" ] || elsewhere
mkdir -p "$DATA"
json() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; } # a JSON string's inside
esc=$(json "$f")
click=$(sed -n 's/.*"click"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p' "$SETTINGS" 2>/dev/null | head -n 1)
if [ "$click" = "tab" ]; then
  name=$(json "$(basename "$f")")
  "$HERDR" do tab.new "{\"mod\":\"markdown-viewer\",\"name\":\"$name\",\"props\":{\"file\":\"$esc\"}}" >/dev/null || elsewhere
  exit 0
fi
id="$$-$(date +%s)"
printf '{"id":"%s","file":"%s"}\n' "$id" "$esc" > "$DATA/request.json"
# A viewer showing in this tab takes it and answers in $DATA/ack.
"$HERDR" do markdown-viewer.show >/dev/null 2>&1
i=0
while [ $i -lt 8 ]; do
  [ "$(cat "$DATA/ack" 2>/dev/null)" = "$id" ] && exit 0
  sleep 0.05; i=$((i+1))
done
"$HERDR" do pane.split --direction right --mod markdown-viewer --props "{\"file\":\"$esc\"}" >/dev/null || elsewhere
exit 0
