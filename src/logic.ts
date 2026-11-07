// Pure toggle logic on plain text: no Obsidian here, so it runs under node --test.
// Offsets are character offsets into the whole document.

export type Style = "bold" | "italic";
export interface Markers { bold: "**" | "__"; italic: "*" | "_" }
export interface Sel { anchor: number; head: number }
export interface Change { from: number; to: number; insert: string }

const WORD = /[\p{L}\p{N}\p{M}_]/u;
const isMark = (c: string | undefined) => c === "*" || c === "_";

/** Runs of one marker char (e.g. "**" or "_"), with where they sit in the document. */
interface Group { char: string; from: number; to: number }

/** Marker groups to the left of `pos`, innermost first, not crossing `limit`. */
function groupsLeft(doc: string, pos: number, limit: number): Group[] {
	const out: Group[] = [];
	let i = pos;
	while (i > limit && isMark(doc[i - 1])) {
		const c = doc[i - 1];
		let j = i;
		while (j > limit && doc[j - 1] === c) j--;
		out.push({ char: c, from: j, to: i });
		i = j;
	}
	return out;
}

/** Marker groups to the right of `pos`, innermost first, not crossing `limit`. */
function groupsRight(doc: string, pos: number, limit: number): Group[] {
	const out: Group[] = [];
	let i = pos;
	while (i < limit && isMark(doc[i])) {
		const c = doc[i];
		let j = i;
		while (j < limit && doc[j] === c) j++;
		out.push({ char: c, from: i, to: j });
		i = j;
	}
	return out;
}

function pairUp(left: Group[], right: Group[]): [Group, Group][] {
	const out: [Group, Group][] = [];
	for (let k = 0; k < Math.min(left.length, right.length); k++) {
		const [l, r] = [left[k], right[k]];
		if (l.char !== r.char || l.to - l.from !== r.to - r.from || l.to > r.from) break;
		out.push([l, r]);
	}
	return out;
}

/**
 * Emphasis layers that wrap [a, b], innermost first. Markers just inside the range count too ("[**word**]" selected
 * with its markers), so try measuring from the bare text first, then from the range as given, and keep the reading
 * that finds `style` ("*[**hello** world]*": the inner ** close inside, the outer * wraps it all).
 */
function layers(doc: string, a: number, b: number, lineStart: number, lineEnd: number, style: Style): [Group, Group][] {
	const a2 = a + groupsRight(doc, a, b).reduce((n, g) => n + g.to - g.from, 0);
	const b2 = Math.max(a2, b - groupsLeft(doc, b, a2).reduce((n, g) => n + g.to - g.from, 0));
	const bare = pairUp(groupsLeft(doc, a2, lineStart), groupsRight(doc, b2, lineEnd));
	if (bare.some(([l]) => has(l.to - l.from, style)) || (a2 === a && b2 === b)) return bare;
	const given = pairUp(groupsLeft(doc, a, lineStart), groupsRight(doc, b, lineEnd));
	return given.some(([l]) => has(l.to - l.from, style)) ? given : bare;
}

const has = (n: number, style: Style) => (style === "bold" ? n >= 2 : n % 2 === 1);

/** The word the cursor is in or touching, without marker underscores at its ends. null if there is none. */
export function wordAt(doc: string, pos: number): [number, number] | null {
	let a = pos, b = pos;
	while (a > 0 && WORD.test(doc[a - 1]) && doc[a - 1] !== "\n") a--;
	while (b < doc.length && WORD.test(doc[b])) b++;
	while (a < b && doc[a] === "_") a++;
	while (b > a && doc[b - 1] === "_") b--;
	return a < b ? [a, b] : null;
}

interface Range { a: number; b: number; lineStart: number; lineEnd: number }

function lineBounds(doc: string, pos: number): [number, number] {
	const s = doc.lastIndexOf("\n", pos - 1) + 1;
	const e = doc.indexOf("\n", pos);
	return [s, e < 0 ? doc.length : e];
}

/** Text ranges one selection acts on: the word at a cursor, or each line's part of a selection, trimmed of spaces. */
function ranges(doc: string, s: Sel): Range[] {
	const from = Math.min(s.anchor, s.head), to = Math.max(s.anchor, s.head);
	if (from === to) {
		const [ls, le] = lineBounds(doc, from);
		const w = wordAt(doc, from);
		return [{ a: w ? w[0] : from, b: w ? w[1] : from, lineStart: ls, lineEnd: le }];
	}
	const out: Range[] = [];
	let p = from;
	while (p <= to) {
		const [ls, le] = lineBounds(doc, p);
		let a = Math.max(p, ls), b = Math.min(to, le);
		while (a < b && /\s/.test(doc[a])) a++;
		while (b > a && /\s/.test(doc[b - 1])) b--;
		if (a < b) out.push({ a, b, lineStart: ls, lineEnd: le });
		p = le + 1;
	}
	if (!out.length) { const [ls, le] = lineBounds(doc, from); out.push({ a: from, b: from, lineStart: ls, lineEnd: le }); }
	return out;
}

/**
 * Toggle bold or italic on every selection, inserting the user's markers and removing either syntax.
 * Returns non-overlapping changes in document order and the new selections (in the new document).
 */
export function toggle(doc: string, sels: Sel[], style: Style, m: Markers): { changes: Change[]; sels: Sel[] } {
	const mark = m[style];
	const order = sels.map((s, i) => ({ s, i, at: Math.min(s.anchor, s.head) })).sort((x, y) => x.at - y.at);
	const changes: Change[] = [];
	const result: Sel[] = sels.map((s) => ({ ...s }));
	let delta = 0, lastEnd = -1;
	for (const { s, i } of order) {
		const rs = ranges(doc, s).filter((r) => r.a >= lastEnd);
		if (!rs.length) { result[i] = { anchor: s.anchor + delta, head: s.head + delta }; continue; }
		const found = rs.map((r) => layers(doc, r.a, r.b, r.lineStart, r.lineEnd, style).find(([l]) => has(l.to - l.from, style)));
		const remove = found.every((f) => f);  // all ranges already styled -> take it off, else put it on everywhere
		const local: Change[] = [];
		const shift: { at: number; d: number; side: "L" | "R" }[] = [];
		rs.forEach((r, k) => {
			const f = found[k];
			if (remove && f) {
				const [l, rr] = f;
				const cut = style === "bold" ? 2 : 1;
				// from the outer end of each run, so "*[**x**]*" loses the outer * and keeps its bold
				local.push({ from: l.from, to: l.from + cut, insert: "" }, { from: rr.to - cut, to: rr.to, insert: "" });
				shift.push({ at: l.from + cut, d: -cut, side: "L" }, { at: rr.to, d: -cut, side: "L" });
			} else if (!remove && !f) {
				// outside any layers already there, so "_x_" + bold gives "**_x_**"
				const ls = layers(doc, r.a, r.b, r.lineStart, r.lineEnd, style);
				const outerL = ls.length ? ls[ls.length - 1][0].from : r.a;
				const outerR = ls.length ? ls[ls.length - 1][1].to : r.b;
				if (r.a === r.b) { local.push({ from: r.a, to: r.a, insert: mark + mark }); return; }
				local.push({ from: outerL, to: outerL, insert: mark }, { from: outerR, to: outerR, insert: mark });
				shift.push({ at: outerL, d: mark.length, side: "L" }, { at: outerR, d: mark.length, side: "R" });
				// a selection that is partly styled already: drop the inner markers so the result is one clean span
				const inner = s.anchor !== s.head ? stripInner(doc.slice(r.a, r.b), style) : null;
				if (inner !== null && inner !== doc.slice(r.a, r.b)) {
					local.push({ from: r.a, to: r.b, insert: inner });
					shift.push({ at: r.b, d: inner.length - (r.b - r.a), side: "L" });
				}
			}
		});
		local.sort((x, y) => x.from - y.from);
		// map a position inside this selection: left-side edits at or before it move it, right-side ones only if before it
		const span = rs[0].a === rs[0].b && local.length ? null : [rs[0].a, rs[rs.length - 1].b];
		const map = (p: number) => {
			if (span) p = Math.min(Math.max(p, span[0]), span[1]);  // keep the selection on the text, not the markers
			let q = p + delta;
			for (const e of shift) if (e.side === "L" ? e.at <= p : e.at < p) q += e.d;
			return q;
		};
		if (rs[0].a === rs[0].b && local.length && !remove) {
			const c = rs[0].a + delta + mark.length;  // empty pair: cursor between the markers
			result[i] = { anchor: c, head: c };
		} else if (rs[0].a === rs[0].b && remove) {
			const c = map(rs[0].a);
			result[i] = { anchor: c, head: c };
		} else {
			result[i] = { anchor: map(s.anchor), head: map(s.head) };
		}
		for (const c of local) { changes.push(c); delta += c.insert.length - (c.to - c.from); }
		lastEnd = Math.max(...rs.map((r) => r.b), ...local.map((c) => c.to));
	}
	return { changes, sels: result };
}

/** Remove emphasis of one style inside a piece of text ("**a** b" -> "a b" for bold). */
export function stripInner(text: string, style: Style): string {
	// no lookbehind: Obsidian on iOS before 16.4 can't run it
	if (style === "bold") return text.replace(/(\*\*|__)(\S(?:.*?\S)?)\1/g, "$2");
	// _x_ only between non-word characters, so snake_case_names stay as they are
	return text.replace(/(^|[^*])\*([^\s*](?:.*?[^\s*])?)\*(?!\*)/g, "$1$2")
		.replace(/(^|[^\p{L}\p{N}_])_([^\s_](?:.*?[^\s_])?)_(?![\p{L}\p{N}_])/gu, "$1$2");
}

/** Apply changes (document order, non-overlapping) to a string: used by tests and as a reference. */
export function applyChanges(doc: string, changes: Change[]): string {
	let out = "", p = 0;
	for (const c of changes) { out += doc.slice(p, c.from) + c.insert; p = c.to; }
	return out + doc.slice(p);
}
