import type { Node as PmNode } from "@tiptap/pm/model";
import type { MacroParam } from "#lib/shared/wiki/index.ts";
import { getParam, type MacroDef, type TocEntry } from "./macros.ts";

export const calloutGlyph: Record<string, string> = {
	info: "i",
	note: "!",
	warning: "×",
	tip: "✓",
};

export const previewGlyph: Record<string, string> = {
	toc: "☰",
	children: "⎇",
	"recently-updated": "↻",
	contributors: "☺",
	contentbylabel: "#",
	attachments: "⎙",
	detailssummary: "▤",
	"view-file": "▣",
	widget: "▶",
	jira: "J",
	anchor: "⚓",
};

/** "Label: value" for every field that differs from its default. */
export function summary(
	def: MacroDef | undefined,
	params: MacroParam[],
): string[] {
	if (!def) return [];
	const lines: string[] = [];
	for (const field of def.fields) {
		const value = getParam(params, field.name);
		if (value === undefined || value === field.default || value === "")
			continue;
		if (field.type === "checkbox") {
			if (value === "true") lines.push(field.label);
			continue;
		}
		const option = field.options?.find((item) => item.value === value);
		lines.push(`${field.label}: ${option?.label ?? value}`);
	}
	return lines;
}

export function jiraText(params: MacroParam[]) {
	return (
		getParam(params, "key") ||
		getParam(params, "jqlQuery") ||
		"No issue or query yet"
	);
}

export function headingsOf(doc: PmNode): TocEntry[] {
	const headings: TocEntry[] = [];
	doc.descendants((node) => {
		if (node.type.name === "heading") {
			headings.push({
				level: Number(node.attrs.level) || 1,
				text: node.textContent,
			});
		}
	});
	return headings;
}
