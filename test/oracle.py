#!/home/prometheus/work/venv-bench/bin/python
"""Record what Obsidian's own Toggle bold / Toggle italic do on each case in test/cases.json (real Obsidian, headless).
Case notation: | = cursor, [ ] = selection (anchor [, head ]); several | = several cursors. Output: test/oracle.json"""
import json, pathlib, sys, tempfile
sys.path.insert(0, str(pathlib.Path.home() / "prometheus/tools/obsidian"))
from rig import Obsidian
HERE = pathlib.Path(__file__).parent
cases = json.loads((HERE / "cases.json").read_text())
cmds = sys.argv[1:] or ["editor:toggle-bold", "editor:toggle-italics"]
JS = """async ([cases, cmds]) => {
  const parse = s => { const sel = []; let out = '', line = 0, ch = 0, a = null;
    for (const c of s) { if (c === '|') sel.push({anchor: {line, ch}, head: {line, ch}});
      else if (c === '[') a = {line, ch}; else if (c === ']') sel.push({anchor: a, head: {line, ch}});
      else { out += c; if (c === '\\n') { line++; ch = 0; } else ch++; } }
    return [out, sel]; };
  const show = (ed) => { const text = ed.getValue(); const lines = text.split('\\n'); const marks = [];
    for (const s of ed.listSelections()) { const o = p => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.ch;
      const [x, y] = [o(s.anchor), o(s.head)]; if (x === y) marks.push([x, '|']); else { marks.push([x, '[']); marks.push([y, ']']); } }
    marks.sort((p, q) => q[0] - p[0] || (p[1] === '[' ? 1 : -1)); let t = text; for (const [i, m] of marks) t = t.slice(0, i) + m + t.slice(i); return t; };
  const leaf = app.workspace.getLeaf(false); const f = app.vault.getAbstractFileByPath('Oracle.md') || await app.vault.create('Oracle.md', '');
  await leaf.openFile(f); await new Promise(r => setTimeout(r, 500)); const ed = leaf.view.editor; ed.focus();
  const out = {};
  for (const cmd of cmds) { out[cmd] = {};
    for (const c of cases) { const [text, sel] = parse(c); ed.setValue(text); ed.setSelections(sel);
      app.commands.executeCommandById(cmd); out[cmd][c] = show(ed);
      app.commands.executeCommandById(cmd); out[cmd][c + ' (twice)'] = show(ed); } }
  return out; }"""
vault = tempfile.mkdtemp(prefix="oracle-")
with Obsidian(vault) as w:
    res = w.evaluate(JS, [cases, cmds])
(HERE / "oracle.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))
for cmd, r in res.items():
    print("==", cmd)
    for k, v in r.items(): print(f"  {k!r:28} -> {v!r}")
