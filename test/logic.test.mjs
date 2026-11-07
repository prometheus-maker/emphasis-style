// Spec: Obsidian's own Toggle bold / Toggle italic, recorded in real Obsidian 1.15 (test/oracle.py -> oracle.json).
// With asterisk markers this plugin must do exactly what the core commands do, except in the listed cases where the
// core result is a bug. With underscore markers it must insert underscores and still remove either syntax.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyChanges, toggle } from "../build/logic.mjs";

const oracle = JSON.parse(readFileSync(new URL("./oracle.json", import.meta.url)));
const STAR = { bold: "**", italic: "*" }, UNDER = { bold: "**", italic: "_" }, ALLU = { bold: "__", italic: "_" };

export function parse(s) {
	const sels = []; let doc = "", a = null;
	for (const c of s) {
		if (c === "|") sels.push({ anchor: doc.length, head: doc.length });
		else if (c === "[") a = doc.length;
		else if (c === "]") sels.push({ anchor: a, head: doc.length });
		else doc += c;
	}
	return [doc, sels];
}

export function show(doc, sels) {
	const marks = [];
	for (const s of sels) {
		if (s.anchor === s.head) marks.push([s.anchor, "|"]);
		else { marks.push([s.anchor, "["]); marks.push([s.head, "]"]); }
	}
	marks.sort((p, q) => q[0] - p[0] || (p[1] === "[" ? 1 : -1));
	let t = doc;
	for (const [i, m] of marks) t = t.slice(0, i) + m + t.slice(i);
	return t;
}

export function run(text, style, markers) {
	const [doc, sels] = parse(text);
	const r = toggle(doc, sels, style, markers);
	return show(applyChanges(doc, r.changes), r.sels);
}

// Core results I deliberately do differently (core bug -> my result), asterisk markers.
const DIFFERENT = {
	"editor:toggle-bold": {
		"hello | (twice)": "hello |",  // core stacks a second empty pair: "hello **|****"
		"| (twice)": "|",
		"**|**": "|",  // cursor in an empty bold pair: take it off (core adds another pair)
		"**|** (twice)": "**|**",
		"*|* (twice)": "*|*",
		"[a\nb] (twice)": "[a\nb]",  // core leaves "[a]\n**b**"
		"x |y (twice)": "x |y",  // core can't toggle back when the cursor is at the word start
		"__|__": "|", "__|__ (twice)": "**|**",
		// core puts bold inside "_x_" for a selection but outside for a cursor; always outside here
		"hello _[world]_": "hello **_[world]_**",
		"_|_": "_**|**_", "_|_ (twice)": "_|_",  // an empty pair: new markers go where the cursor is
	},
	"editor:toggle-italics": {
		"hello | (twice)": "hello |",
		"| (twice)": "|",
		"*|*": "|", "*|* (twice)": "*|*",
		"**|** (twice)": "**|**",
		"[a\nb] (twice)": "[a\nb]",
		"x |y (twice)": "x |y",
		"_|_": "|", "_|_ (twice)": "*|*",
		"__|__": "__*|*__", "__|__ (twice)": "__|__",
		"hello __[world]__": "hello *__[world]__*",
		"__wor|ld__ (twice)": "__wor|ld__",  // core leaves "_wor|ld_"
		// core puts italic markers inside an existing bold selection and then can't remove them
		"hello [**world**]": "hello *[**world**]*", "hello [**world**] (twice)": "hello [**world**]",
		"[**hello** world] (twice)": "[**hello** world]",
	},
};
const STYLE = { "editor:toggle-bold": "bold", "editor:toggle-italics": "italic" };

for (const [cmd, cases] of Object.entries(oracle)) {
	test(`asterisk markers match core ${cmd}`, () => {
		const fails = [];
		for (const [key, want0] of Object.entries(cases)) {
			const twice = key.endsWith(" (twice)");
			const input = twice ? key.slice(0, -8) : key;
			let got = run(input, STYLE[cmd], STAR);
			if (twice) got = run(got, STYLE[cmd], STAR);
			const want = DIFFERENT[cmd][key] ?? want0;
			if (got !== want) fails.push(`${JSON.stringify(key)}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
		}
		assert.deepEqual(fails, []);
	});
}

test("underscore italic: inserts _ and removes either syntax", () => {
	assert.equal(run("hello wor|ld", "italic", UNDER), "hello _wor|ld_");
	assert.equal(run("hello _wor|ld_", "italic", UNDER), "hello wor|ld");
	assert.equal(run("hello *wor|ld*", "italic", UNDER), "hello wor|ld");
	assert.equal(run("hello [world]", "italic", UNDER), "hello _[world]_");
	assert.equal(run("hello _[world]_", "italic", UNDER), "hello [world]");
	assert.equal(run("hello [_world_]", "italic", UNDER), "hello [world]");
	assert.equal(run("|", "italic", UNDER), "_|_");
	assert.equal(run("_|_", "italic", UNDER), "|");
	assert.equal(run("snake_ca|se_word", "italic", UNDER), "_snake_ca|se_word_");
	assert.equal(run("_snake_ca|se_word_", "italic", UNDER), "snake_ca|se_word");
	assert.equal(run("a|b c|d", "italic", UNDER), "_a|b_ _c|d_");
	assert.equal(run("[one\ntwo]", "italic", UNDER), "_[one_\n_two]_");
	assert.equal(run("**bold wor|d**", "italic", UNDER), "**bold _wor|d_**");
});

test("bold over italic and back, both syntaxes", () => {
	assert.equal(run("_wor|d_", "bold", UNDER), "**_wor|d_**");
	assert.equal(run("**_wor|d_**", "bold", UNDER), "_wor|d_");
	assert.equal(run("**_wor|d_**", "italic", UNDER), "**wor|d**");
	assert.equal(run("_**wor|d**_", "bold", UNDER), "_wor|d_");
	assert.equal(run("***wor|d***", "italic", UNDER), "**wor|d**");
	assert.equal(run("___wor|d___", "bold", ALLU), "_wor|d_");
	assert.equal(run("wor|d", "bold", ALLU), "__wor|d__");
	assert.equal(run("__wor|d__", "bold", ALLU), "wor|d");
	assert.equal(run("__wor|d__", "bold", STAR), "wor|d");
	assert.equal(run("[hello world ]", "bold", ALLU), "__[hello world ]__".replace(" ]__", "]__ "));
});

test("selection of text that is half styled gets styled whole", () => {
	assert.equal(run("[**hello** world]", "bold", STAR), "**[hello world]**");
	assert.equal(run("[a\n_b_]", "italic", UNDER), "_[a_\n_b_]");
	assert.equal(run("[_a_\n_b_]", "italic", UNDER), "[a\nb]");
});

test("one undo step: a cursor toggle is at most two changes, in document order", () => {
	const [doc, sels] = parse("x wor|d y wor|d");
	const r = toggle(doc, sels, "italic", UNDER);
	assert.equal(r.changes.length, 4);
	for (let i = 1; i < r.changes.length; i++) assert.ok(r.changes[i].from >= r.changes[i - 1].to);
});
