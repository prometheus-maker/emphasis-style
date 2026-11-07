// Expected results with the plugin's default markers (_italic_, **bold**), from the unit-tested logic: e2e.py checks
// that the real editor produces exactly these through Obsidian's own Toggle bold / Toggle italic commands.
import { readFileSync, writeFileSync } from "node:fs";
import { run } from "./logic.test.mjs";
const cases = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url)));
const M = { bold: "**", italic: "_" }, out = {};
for (const [cmd, style] of [["editor:toggle-bold", "bold"], ["editor:toggle-italics", "italic"]]) {
	out[cmd] = {};
	for (const c of cases) { const once = run(c, style, M); out[cmd][c] = once; out[cmd][c + " (twice)"] = run(once, style, M); }
}
writeFileSync(new URL("./expected.json", import.meta.url), JSON.stringify(out, null, 1));
