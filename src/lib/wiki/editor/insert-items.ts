import { macroCatalog } from "#lib/editor/wiki/macros.ts";
import { classicEmoticons, emojiPalette } from "#lib/shared/wiki/emoticons.ts";

export type InsertGroup = "Insert" | "Layout" | "Macros";

export type InsertItem = {
	id: string;
	label: string;
	group: InsertGroup;
	keywords: string;
};

export const insertItems: InsertItem[] = [
	{
		id: "image",
		label: "Image",
		group: "Insert",
		keywords: "picture photo upload",
	},
	{ id: "file", label: "File", group: "Insert", keywords: "attachment upload" },
	{ id: "link", label: "Link", group: "Insert", keywords: "url page" },
	{ id: "table", label: "Table", group: "Insert", keywords: "grid" },
	{
		id: "hr",
		label: "Horizontal rule",
		group: "Insert",
		keywords: "divider line",
	},
	{
		id: "task-list",
		label: "Task list",
		group: "Insert",
		keywords: "todo checkbox",
	},
	{ id: "date", label: "Date", group: "Insert", keywords: "calendar today" },
	{ id: "emoji", label: "Emoji", group: "Insert", keywords: "emoticon smile" },
	{
		id: "mention",
		label: "Mention",
		group: "Insert",
		keywords: "user person at",
	},
	{
		id: "layout-2",
		label: "2 columns",
		group: "Layout",
		keywords: "layout section",
	},
	{
		id: "layout-3",
		label: "3 columns",
		group: "Layout",
		keywords: "layout section",
	},
	...macroCatalog.map(
		(def): InsertItem => ({
			id: `macro:${def.name}`,
			label: def.label,
			group: "Macros",
			keywords: `${def.name} ${def.description} macro`,
		}),
	),
	{
		id: "macros",
		label: "Other macros...",
		group: "Macros",
		keywords: "browser all",
	},
];

export function filterInsertItems(query: string): InsertItem[] {
	const needle = query.trim().toLowerCase();
	if (needle === "") return insertItems;
	const rank = (item: InsertItem) => {
		const label = item.label.toLowerCase();
		if (label.startsWith(needle)) return 0;
		if (label.includes(needle)) return 1;
		return item.keywords.includes(needle) ? 2 : 3;
	};
	return insertItems
		.filter((item) => rank(item) < 3)
		.sort((a, b) => rank(a) - rank(b));
}

export type EmojiChoice = {
	name: string;
	char: string;
	attrs: {
		name: string;
		emojiId: string | null;
		emojiShortname: string | null;
		emojiFallback: string | null;
	};
};

export const emojiChoices: EmojiChoice[] = [
	...Object.entries(classicEmoticons).map(
		([name, char]): EmojiChoice => ({
			name,
			char,
			attrs: { name, emojiId: null, emojiShortname: null, emojiFallback: null },
		}),
	),
	...emojiPalette.map(
		(entry): EmojiChoice => ({
			name: entry.name,
			char: entry.char,
			attrs: {
				name: entry.name,
				emojiId: entry.id,
				emojiShortname: `:${entry.name.replace(/ /g, "_")}:`,
				emojiFallback: entry.char,
			},
		}),
	),
];

export function filterEmoji(query: string, limit = 8): EmojiChoice[] {
	const needle = query.trim().toLowerCase().replace(/[_-]/g, " ");
	const hits = emojiChoices.filter((choice) => choice.name.includes(needle));
	hits.sort(
		(a, b) =>
			Number(b.name.startsWith(needle)) - Number(a.name.startsWith(needle)),
	);
	return hits.slice(0, limit);
}
