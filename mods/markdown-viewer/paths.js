// Which candidate paths exist, where the terminal runs.
import { exec, home } from "herdr";
import * as fs from "fs/promises";
import { absolute } from "./markdown.js";

// The candidates that exist, as absolute paths (relative ones from `cwd`, ~ is home), in order,
// each once. Locally, paths under home are checked with `fs.exists`, which is much faster than a
// shell (it also accepts a folder, rare with a .md name); the rest share one `sh`.
export async function existing(candidates, cwd, on) {
  if (!candidates.length) return [];
  if (on) return existingByShell(candidates, cwd, on);
  const h = home();
  const paths = [...new Set(candidates.slice(0, 300).map((c) => absolute(c, cwd, h)))];
  const outside = paths.filter((p) => !p.startsWith(h + "/"));
  const shellFound = new Set(outside.length ? await existingByShell(outside, "/", null).catch(() => []) : []);
  const found = await Promise.all(paths.map((p) => p.startsWith(h + "/") ? fs.exists(p).catch(() => false) : shellFound.has(p)));
  return paths.filter((_p, n) => found[n]);
}

// Paths as given (absolute ones come back unchanged), relative ones from `cwd`, checked by `sh`.
async function existingByShell(candidates, cwd, on) {
  const script = 'cd "$1" 2>/dev/null; shift; for p; do case $p in "~/"*) p="$HOME/${p#??}";; esac; ' +
    'case $p in /*) [ -f "$p" ] && printf "%s\\n" "$p";; *) [ -f "$p" ] && printf "%s/%s\\n" "$(cd "$(dirname "$p")" && pwd)" "$(basename "$p")";; esac; done';
  const r = await exec("sh", ["-c", script, "sh", cwd || "/", ...candidates.slice(0, 80)], { on });
  return [...new Set(r.stdout.split("\n").filter(Boolean))];
}
