#!/home/prometheus/work/venv-bench/bin/python
"""End-to-end test in real Obsidian (headless, tools/obsidian/rig.py): Obsidian's own Toggle bold / Toggle italic,
real Ctrl+B / Ctrl+I key presses, undo, settings, and turning the plugin off. Usage: e2e.py [SHOT]"""
import json, pathlib, sys, tempfile
sys.path.insert(0, str(pathlib.Path.home() / "prometheus/tools/obsidian"))
from rig import Obsidian
HERE = pathlib.Path(__file__).parent
expected = json.loads((HERE / "expected.json").read_text())
results = []

def check(name, ok, detail=""):
    results.append(ok); print(("PASS " if ok else "FAIL ") + name, detail, flush=True)

HELP = """window.__es = {
  parse(s) { const sel = []; let out = '', line = 0, ch = 0, a = null;
    for (const c of s) { if (c === '|') sel.push({anchor: {line, ch}, head: {line, ch}});
      else if (c === '[') a = {line, ch}; else if (c === ']') sel.push({anchor: a, head: {line, ch}});
      else { out += c; if (c === '\\n') { line++; ch = 0; } else ch++; } }
    return [out, sel]; },
  show(ed) { const text = ed.getValue(); const lines = text.split('\\n'); const marks = [];
    for (const s of ed.listSelections()) { const o = p => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.ch;
      const [x, y] = [o(s.anchor), o(s.head)]; if (x === y) marks.push([x, '|']); else { marks.push([x, '[']); marks.push([y, ']']); } }
    marks.sort((p, q) => q[0] - p[0] || (p[1] === '[' ? 1 : -1)); let t = text; for (const [i, m] of marks) t = t.slice(0, i) + m + t.slice(i); return t; },
  ed() { return app.workspace.activeLeaf.view.editor; },
  set(c) { const [t, s] = this.parse(c); const ed = this.ed(); ed.setValue(t); ed.setSelections(s); ed.focus(); },
};"""

vault = pathlib.Path(tempfile.mkdtemp(prefix="es-"))
(vault / "Note.md").write_text("")
with Obsidian(vault, plugins=[HERE.parent]) as w:
    w.evaluate(HELP)
    w.evaluate("async () => { await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('Note.md')); }")
    w.wait_for_timeout(800)
    check("plugin loaded", w.evaluate("!!app.plugins.plugins['emphasis-style']"))

    # 1. every recorded case through Obsidian's own commands (what Ctrl+B / Ctrl+I, the Format menu and toolbar call)
    bad = w.evaluate("""(exp) => { const bad = [];
      for (const [cmd, cases] of Object.entries(exp)) for (const [k, want] of Object.entries(cases)) {
        const twice = k.endsWith(' (twice)'); __es.set(twice ? k.slice(0, -8) : k);
        app.commands.executeCommandById(cmd); if (twice) app.commands.executeCommandById(cmd);
        const got = __es.show(__es.ed()); if (got !== want) bad.push([cmd, k, got, want]); }
      return bad; }""", expected)
    n = sum(len(v) for v in expected.values())
    check(f"core commands give the plugin's result on all {n} cases", not bad, str(bad[:4]))

    # 2. real key presses
    def keys(case, combo):
        w.evaluate("(c) => __es.set(c)", case); w.keyboard.press(combo); w.wait_for_timeout(150)
        return w.evaluate("__es.show(__es.ed())")
    got = keys("hello wor|ld", "Control+i"); check("Ctrl+I inserts _underscores_", got == "hello _wor|ld_", got)
    got = keys("hello wor|ld", "Control+b"); check("Ctrl+B inserts **asterisks**", got == "hello **wor|ld**", got)
    got = keys("hello *wor|ld*", "Control+i"); check("Ctrl+I removes *asterisk* italic", got == "hello wor|ld", got)

    # 3. one undo step restores the text
    w.evaluate("(c) => __es.set(c)", "a|b c|d"); w.keyboard.press("Control+i"); w.wait_for_timeout(150)
    w.keyboard.press("Control+z"); w.wait_for_timeout(150)
    got = w.evaluate("__es.ed().getValue()"); check("one Ctrl+Z undoes a multi-cursor toggle", got == "ab cd", got)

    # 4. settings: markers, and the take-over switch
    w.evaluate("() => { const p = app.plugins.plugins['emphasis-style']; p.settings.italic = '*'; p.settings.bold = '__'; }")
    got = keys("wor|d", "Control+i"); check("italic marker setting *", got == "*wor|d*", got)
    got = keys("wor|d", "Control+b"); check("bold marker setting __", got == "__wor|d__", got)
    w.evaluate("() => { const p = app.plugins.plugins['emphasis-style']; p.settings.italic = '_'; p.settings.bold = '**'; p.settings.takeOver = false; }")
    got = keys("wor|d", "Control+i"); check("take-over off: Ctrl+I is Obsidian's own again", got == "*wor|d*", got)
    w.evaluate("(c) => __es.set(c)", "wor|d"); w.evaluate("app.commands.executeCommandById('emphasis-style:toggle-italic')")
    got = w.evaluate("__es.show(__es.ed())"); check("plugin command still uses _ when take-over is off", got == "_wor|d_", got)
    w.evaluate("() => { app.plugins.plugins['emphasis-style'].settings.takeOver = true; }")

    # 5. settings tab renders
    # (headless, the settings modal opens in a hidden helper window, so render the tab itself)
    tab = w.evaluate("""() => { const t = app.setting.pluginTabs.find(t => t.id === 'emphasis-style'); t.display();
      return [t.containerEl.innerText, [...t.containerEl.querySelectorAll('select:not(.is-measuring)')].map(s => s.value).join('|')]; }""")
    check("settings tab shows the three options", all(s in tab[0] for s in ("Italic marker", "Bold marker", "built-in bold")) and tab[1] == "_|**",
          tab[0][:100].replace("\n", " | ") + " / " + tab[1])

    # 6. turning the plugin off gives Obsidian's own behaviour back
    w.evaluate("async () => { await app.plugins.disablePlugin('emphasis-style'); }"); w.wait_for_timeout(300)
    got = keys("wor|d", "Control+i"); check("plugin off: Ctrl+I back to Obsidian's *", got == "*wor|d*", got)
    w.evaluate("async () => { await app.plugins.enablePlugin('emphasis-style'); }"); w.wait_for_timeout(500)
    w.evaluate("async () => { await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath('Note.md')); }"); w.wait_for_timeout(300)
    got = keys("wor|d", "Control+i"); check("plugin back on: Ctrl+I gives _ again", got == "_wor|d_", got)

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
