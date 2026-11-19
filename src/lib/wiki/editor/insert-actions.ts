import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
	type MacroDef,
	macroDef,
	newMacroAttrs,
} from "#lib/editor/wiki/macros.ts";

export type InsertActions = {
	openLink: () => void;
	openMacroBrowser: () => void;
	insertMacro: (def: MacroDef) => void;
	pickFiles: (kind: "image" | "file") => void;
	openDate: () => void;
	openEmoji: () => void;
};

/** Layouts live at the top level of the page: the section goes after the block holding the cursor. */
function insertLayout(editor: Editor, columns: 2 | 3) {
	const cell = { type: "layoutCell", content: [{ type: "paragraph" }] };
	const json = {
		type: "layoutSection",
		attrs: { type: columns === 2 ? "two_equal" : "three_equal" },
		content: Array.from({ length: columns }, () => cell),
	};
	editor
		.chain()
		.focus()
		.command(({ tr, state }) => {
			const { $from } = tr.selection;
			const node = state.schema.nodeFromJSON(json);
			let at = $from.pos;
			let end = at;
			if ($from.depth > 0) {
				const top = $from.node(1);
				const empty = top.type.name === "paragraph" && top.content.size === 0;
				at = empty ? $from.before(1) : $from.after(1);
				end = $from.after(1);
				if (!empty) end = at;
			}
			tr.replaceWith(at, end, node);
			tr.setSelection(TextSelection.create(tr.doc, at + 3));
			return true;
		})
		.run();
}

/** Inserts the macro at the selection and returns its position, or null when it could not be placed. */
export function insertMacroNode(editor: Editor, def: MacroDef): number | null {
	const attrs = newMacroAttrs(def);
	const type = def.inline ? "inlineMacro" : "macro";
	const content =
		!def.inline && def.body === "rich" ? [{ type: "paragraph" }] : undefined;
	if (!editor.chain().focus().insertContent({ type, attrs, content }).run()) {
		return null;
	}
	let found: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (found !== null) return false;
		if (node.type.name === type && node.attrs.macroId === attrs.macroId) {
			found = pos;
			return false;
		}
		return node.isBlock || node.childCount > 0;
	});
	return found;
}

export function runInsert(editor: Editor, id: string, actions: InsertActions) {
	if (id.startsWith("macro:")) {
		const def = macroDef(id.slice("macro:".length));
		if (def) actions.insertMacro(def);
		return;
	}
	switch (id) {
		case "image":
		case "file":
			actions.pickFiles(id);
			break;
		case "link":
			actions.openLink();
			break;
		case "table":
			editor
				.chain()
				.focus()
				.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
				.run();
			break;
		case "hr":
			editor.chain().focus().setHorizontalRule().run();
			break;
		case "task-list":
			editor.chain().focus().toggleTaskList().run();
			break;
		case "date":
			actions.openDate();
			break;
		case "emoji":
			actions.openEmoji();
			break;
		case "mention":
			editor.chain().focus().insertContent("@").run();
			break;
		case "layout-2":
			insertLayout(editor, 2);
			break;
		case "layout-3":
			insertLayout(editor, 3);
			break;
		case "macros":
			actions.openMacroBrowser();
			break;
	}
}
