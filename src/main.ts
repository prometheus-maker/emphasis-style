import { App, Editor, MarkdownView, Plugin, PluginSettingTab, Setting } from "obsidian";
import { Markers, Style, toggle } from "./logic";

interface Settings extends Markers { takeOver: boolean }
const DEFAULTS: Settings = { italic: "_", bold: "**", takeOver: true };

type Toggle = (this: Editor, type: string) => void;

export default class EmphasisStyle extends Plugin {
	settings: Settings = { ...DEFAULTS };
	private patched: { owner: object; original: Toggle } | null = null;

	async onload() {
		const saved = (await this.loadData()) as Partial<Settings> | null;
		this.settings = { ...DEFAULTS, ...saved };
		this.addCommand({ id: "toggle-bold", name: "Toggle bold (your marker)", icon: "bold", editorCallback: (e) => this.run(e, "bold") });
		this.addCommand({ id: "toggle-italic", name: "Toggle italic (your marker)", icon: "italic", editorCallback: (e) => this.run(e, "italic") });
		this.addSettingTab(new EmphasisSettings(this.app, this));
		// Ctrl/Cmd+B, Ctrl/Cmd+I, the Format menu and the mobile toolbar all call editor.toggleMarkdownFormatting.
		// The Editor class is only reachable through a live editor, so patch it as soon as one exists.
		this.app.workspace.onLayoutReady(() => this.patch());
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.patch()));
	}

	onunload() {
		if (this.patched) (this.patched.owner as { toggleMarkdownFormatting: Toggle }).toggleMarkdownFormatting = this.patched.original;
		this.patched = null;
	}

	run(editor: Editor, style: Style) {
		const doc = editor.getValue();
		const sels = editor.listSelections().map((s) => ({ anchor: editor.posToOffset(s.anchor), head: editor.posToOffset(s.head) }));
		const r = toggle(doc, sels, style, this.settings);
		if (!r.changes.length) return;
		// one transaction = one undo step; selections are given in the new document
		const after = applyOffsets(doc, r.changes);
		editor.transaction({
			changes: r.changes.map((c) => ({ from: editor.offsetToPos(c.from), to: editor.offsetToPos(c.to), text: c.insert })),
			selections: r.sels.map((s) => ({ from: toPos(after, s.anchor), to: toPos(after, s.head) })),
		});
	}

	private patch() {
		if (this.patched) return;
		const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
		if (!editor) return;
		let owner: object | null = editor;
		while (owner && !Object.prototype.hasOwnProperty.call(owner, "toggleMarkdownFormatting")) owner = Object.getPrototypeOf(owner);
		if (!owner) return;
		const original = (owner as { toggleMarkdownFormatting: Toggle }).toggleMarkdownFormatting;
		const plugin = this;
		(owner as { toggleMarkdownFormatting: Toggle }).toggleMarkdownFormatting = function (this: Editor, type: string) {
			if (plugin.settings.takeOver && (type === "bold" || type === "italic")) return plugin.run(this, type);
			return original.call(this, type);
		};
		this.patched = { owner, original };
	}

	async save() { await this.saveData(this.settings); }
}

/** Line/ch of an offset in a text (the editor's own offsetToPos only knows the current document). */
function toPos(text: string, offset: number) {
	const before = text.slice(0, offset);
	const line = before.split("\n").length - 1;
	return { line, ch: offset - (before.lastIndexOf("\n") + 1) };
}

function applyOffsets(doc: string, changes: { from: number; to: number; insert: string }[]) {
	let out = "", p = 0;
	for (const c of changes) { out += doc.slice(p, c.from) + c.insert; p = c.to; }
	return out + doc.slice(p);
}

class EmphasisSettings extends PluginSettingTab {
	constructor(app: App, private plugin: EmphasisStyle) { super(app, plugin); }

	display() {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		new Setting(containerEl).setName("Italic marker").setDesc("What Toggle italic inserts. Both kinds are recognised when removing.")
			.addDropdown((d) => d.addOptions({ "_": "_underscore_", "*": "*asterisk*" }).setValue(s.italic)
				.onChange(async (v) => { s.italic = v as Settings["italic"]; await this.plugin.save(); }));
		new Setting(containerEl).setName("Bold marker").setDesc("What Toggle bold inserts. Both kinds are recognised when removing.")
			.addDropdown((d) => d.addOptions({ "**": "**asterisks**", "__": "__underscores__" }).setValue(s.bold)
				.onChange(async (v) => { s.bold = v as Settings["bold"]; await this.plugin.save(); }));
		new Setting(containerEl).setName("Use for the built-in bold and italic")
			.setDesc("Ctrl/Cmd+B, Ctrl/Cmd+I, the Format menu and the mobile toolbar use your markers. Turn off to use only this plugin's own commands.")
			.addToggle((t) => t.setValue(s.takeOver).onChange(async (v) => { s.takeOver = v; await this.plugin.save(); }));
	}
}
