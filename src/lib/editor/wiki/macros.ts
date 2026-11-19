import type { MacroParam } from "../../shared/wiki/index.ts";

export type FieldType =
	| "text"
	| "select"
	| "checkbox"
	| "textarea"
	| "colour"
	| "attachment";

export type MacroField = {
	/** parameter name as stored in `params`; "" is the unnamed default parameter */
	name: string;
	label: string;
	type: FieldType;
	/** value assumed when the parameter is absent; checkboxes use "true" / "false" */
	default: string;
	options?: { value: string; label: string }[];
	help?: string;
	placeholder?: string;
};

export type MacroCategory =
	| "Formatting"
	| "Navigation"
	| "Content"
	| "Media"
	| "Development";

export type MacroDef = {
	name: string;
	label: string;
	category: MacroCategory;
	description: string;
	/** inserted as an `inlineMacro` instead of a block `macro` */
	inline?: boolean;
	body: "rich" | "plain" | "none";
	fields: MacroField[];
};

const text = (
	name: string,
	label: string,
	extra: Partial<MacroField> = {},
): MacroField => ({ name, label, type: "text", default: "", ...extra });

const flag = (
	name: string,
	label: string,
	def: "true" | "false" = "false",
	help?: string,
): MacroField => ({ name, label, type: "checkbox", default: def, help });

const colour = (name: string, label: string): MacroField => ({
	name,
	label,
	type: "colour",
	default: "",
});

const select = (
	name: string,
	label: string,
	options: [string, string][],
	def = options[0]?.[0] ?? "",
): MacroField => ({
	name,
	label,
	type: "select",
	default: def,
	options: options.map(([value, optionLabel]) => ({
		value,
		label: optionLabel,
	})),
});

const levels = (): [string, string][] =>
	[1, 2, 3, 4, 5, 6].map((level) => [String(level), String(level)]);

export const codeLanguages: [string, string][] = [
	["none", "None"],
	["bash", "Bash"],
	["c", "C"],
	["cpp", "C++"],
	["go", "Go"],
	["java", "Java"],
	["javascript", "JavaScript"],
	["json", "JSON"],
	["python", "Python"],
	["rust", "Rust"],
	["sql", "SQL"],
	["typescript", "TypeScript"],
	["xml", "XML"],
	["yaml", "YAML"],
];

const calloutFields = (): MacroField[] => [
	text("title", "Title"),
	flag("icon", "Show icon", "true"),
];

export const macroCatalog: MacroDef[] = [
	{
		name: "info",
		label: "Info",
		category: "Formatting",
		description: "A blue information panel",
		body: "rich",
		fields: calloutFields(),
	},
	{
		name: "note",
		label: "Note",
		category: "Formatting",
		description: "A yellow note panel",
		body: "rich",
		fields: calloutFields(),
	},
	{
		name: "warning",
		label: "Warning",
		category: "Formatting",
		description: "A red warning panel",
		body: "rich",
		fields: calloutFields(),
	},
	{
		name: "tip",
		label: "Tip",
		category: "Formatting",
		description: "A green tip panel",
		body: "rich",
		fields: calloutFields(),
	},
	{
		name: "panel",
		label: "Panel",
		category: "Formatting",
		description: "A custom coloured panel",
		body: "rich",
		fields: [
			text("title", "Title"),
			select("borderStyle", "Border style", [
				["solid", "Solid"],
				["dashed", "Dashed"],
				["dotted", "Dotted"],
				["double", "Double"],
			]),
			colour("borderColor", "Border colour"),
			text("borderWidth", "Border width (px)", { placeholder: "1" }),
			colour("bgColor", "Background colour"),
			colour("titleBGColor", "Title background colour"),
			colour("titleColor", "Title text colour"),
		],
	},
	{
		name: "code",
		label: "Code Block",
		category: "Formatting",
		description: "Formatted source code",
		body: "plain",
		fields: [
			text("title", "Title"),
			select("language", "Language", codeLanguages, "none"),
			flag("linenumbers", "Show line numbers"),
			flag("collapse", "Collapse by default"),
			select("theme", "Theme", [
				["Confluence", "Classic"],
				["Default", "Default"],
				["Django", "Django"],
				["Emacs", "Emacs"],
				["FadeToGrey", "FadeToGrey"],
				["Midnight", "Midnight"],
				["RDark", "RDark"],
				["Eclipse", "Eclipse"],
			]),
		],
	},
	{
		name: "expand",
		label: "Expand",
		category: "Formatting",
		description: "Content that can be collapsed",
		body: "rich",
		fields: [
			text("title", "Title", { placeholder: "Click here to expand..." }),
		],
	},
	{
		name: "toc",
		label: "Table of Contents",
		category: "Navigation",
		description: "Links to the headings of this page",
		body: "none",
		fields: [
			select("type", "Type", [
				["list", "List"],
				["flat", "Flat"],
			]),
			flag("outline", "Numbered outline"),
			select("minLevel", "Minimum heading level", levels(), "1"),
			select("maxLevel", "Maximum heading level", levels(), "6"),
			text("include", "Include headings", {
				help: "A regular expression; only matching headings are listed",
			}),
			text("exclude", "Exclude headings", {
				help: "A regular expression; matching headings are left out",
			}),
		],
	},
	{
		name: "children",
		label: "Children Display",
		category: "Navigation",
		description: "Lists the child pages",
		body: "none",
		fields: [
			text("page", "Parent page", { help: "Empty means this page" }),
			text("depth", "Depth", { placeholder: "all levels" }),
			text("first", "Number of pages to show"),
			select("sort", "Sort by", [
				["", "Page order"],
				["title", "Title"],
				["creation", "Creation date"],
				["modified", "Modification date"],
			]),
			select("style", "Heading style", [
				["", "None"],
				["h1", "H1"],
				["h2", "H2"],
				["h3", "H3"],
				["h4", "H4"],
				["h5", "H5"],
				["h6", "H6"],
			]),
			select("excerptType", "Excerpt", [
				["none", "None"],
				["simple", "Simple"],
				["rich content", "Rich content"],
			]),
			flag("all", "Show all descendants"),
		],
	},
	{
		name: "anchor",
		label: "Anchor",
		category: "Navigation",
		description: "A named place on the page to link to",
		inline: true,
		body: "none",
		fields: [text("", "Anchor name")],
	},
	{
		name: "recently-updated",
		label: "Recently Updated",
		category: "Content",
		description: "Lists recently changed content",
		body: "none",
		fields: [
			text("spaces", "Spaces", { help: "Space keys, comma separated" }),
			text("labels", "Labels"),
			text("author", "Authors"),
			text("types", "Content types", { placeholder: "page, blogpost" }),
			text("max", "Maximum items", { placeholder: "15" }),
			select("theme", "Theme", [
				["concise", "Concise"],
				["social", "Social"],
				["sidebar", "Sidebar"],
			]),
			flag("hideHeading", "Hide heading"),
			flag("showProfilePic", "Show profile pictures"),
			text("width", "Width", { placeholder: "100%" }),
		],
	},
	{
		name: "contributors",
		label: "Contributors",
		category: "Content",
		description: "Lists the people who worked on the page",
		body: "none",
		fields: [
			select("mode", "Mode", [
				["list", "List"],
				["inline", "Inline"],
			]),
			select("order", "Order by", [
				["update", "Last update"],
				["name", "Name"],
				["edits", "Number of edits"],
			]),
			text("limit", "Limit"),
			select("scope", "Scope", [
				["", "This page"],
				["descendants", "Descendants"],
				["children", "Children"],
			]),
			flag("showAnonymous", "Show anonymous"),
			flag("showCount", "Show counts"),
			flag("showLastTime", "Show last contribution time"),
			text("page", "Page"),
			select("include", "Include", [
				["", "Authors and comments"],
				["authors", "Authors"],
				["comments", "Comments"],
			]),
		],
	},
	{
		name: "contentbylabel",
		label: "Content by Label",
		category: "Content",
		description: "Lists content that has the given labels",
		body: "none",
		fields: [
			text("labels", "Labels", { help: "Comma separated" }),
			text("spaces", "Spaces", { help: "Space keys, comma separated" }),
			text("type", "Content types", { placeholder: "page, blogpost" }),
			select("sort", "Sort by", [
				["", "Title"],
				["created", "Creation date"],
				["modified", "Modification date"],
			]),
			flag("reverse", "Reverse sort"),
			text("max", "Maximum items", { placeholder: "15" }),
			flag("showLabels", "Show labels"),
			flag("showSpace", "Show space"),
			select("excerpt", "Excerpt", [
				["none", "None"],
				["simple", "Simple"],
				["rich content", "Rich content"],
			]),
			text("title", "Title"),
		],
	},
	{
		name: "attachments",
		label: "Attachments",
		category: "Content",
		description: "Lists the attachments of a page",
		body: "none",
		fields: [
			text("patterns", "File name patterns", { placeholder: ".*\\.pdf" }),
			flag("old", "Show previous versions"),
			flag("upload", "Show upload form"),
			select("sort", "Sort by", [
				["", "Name"],
				["date", "Date"],
				["size", "Size"],
			]),
			text("page", "Page"),
		],
	},
	{
		name: "details",
		label: "Page Properties",
		category: "Content",
		description: "A table of key-value properties for reports",
		body: "rich",
		fields: [text("id", "ID"), flag("hidden", "Hide on this page")],
	},
	{
		name: "detailssummary",
		label: "Page Properties Report",
		category: "Content",
		description: "A report on the properties of other pages",
		body: "none",
		fields: [
			text("cql", "Content criteria (CQL)"),
			text("headings", "Headings"),
			text("firstcolumn", "First column heading"),
			text("sort", "Sort by"),
			flag("reverse", "Reverse sort"),
			text("label", "Label"),
			text("max", "Maximum pages"),
		],
	},
	{
		name: "view-file",
		label: "View File",
		category: "Media",
		description: "Shows an attached file",
		body: "none",
		fields: [
			{
				name: "name",
				label: "File",
				type: "attachment",
				default: "",
			},
			text("height", "Height", { placeholder: "250" }),
			text("width", "Width"),
		],
	},
	{
		name: "widget",
		label: "Widget Connector",
		category: "Media",
		description: "Embeds a video, document or other web content",
		body: "none",
		fields: [
			text("url", "URL", {
				placeholder: "https://www.youtube.com/watch?v=...",
			}),
		],
	},
	{
		name: "jira",
		label: "Issue list",
		category: "Development",
		description: "Issues by key or query",
		inline: true,
		body: "none",
		fields: [
			text("key", "Issue key", { placeholder: "ABC-123" }),
			{
				name: "jqlQuery",
				label: "JQL query",
				type: "textarea",
				default: "",
				placeholder: "project = ABC AND status = Open",
			},
			text("columns", "Columns", {
				help: "Comma separated, used by JQL queries",
				placeholder:
					"key,summary,type,created,updated,due,assignee,reporter,priority,status,resolution",
			}),
			text("maximumIssues", "Maximum issues", { placeholder: "20" }),
			flag("count", "Show the count only"),
			text("server", "Server"),
		],
	},
];

const macroByName = new Map(macroCatalog.map((def) => [def.name, def]));

export function macroDef(name: string): MacroDef | undefined {
	return macroByName.get(name);
}

export const macroCategories: MacroCategory[] = [
	"Formatting",
	"Navigation",
	"Content",
	"Media",
	"Development",
];

export function getParam(
	params: MacroParam[] | null | undefined,
	name: string,
): string | undefined {
	return params?.find((param) => param.name === name)?.value;
}

export function fieldValue(
	params: MacroParam[] | null | undefined,
	field: MacroField,
): string {
	return getParam(params, field.name) ?? field.default;
}

/**
 * Writes dialog values into `params`: unknown parameters and the order of existing ones are
 * kept, untouched values are left alone, a cleared value drops the parameter, and a value
 * equal to the default is only added when the parameter already exists.
 */
export function applyFieldValues(
	params: MacroParam[] | null | undefined,
	fields: MacroField[],
	values: Record<string, string>,
): MacroParam[] {
	const next = (params ?? []).map((param) => ({ ...param }));
	for (const field of fields) {
		const value = values[field.name] ?? field.default;
		const index = next.findIndex((param) => param.name === field.name);
		if (index >= 0) {
			if (next[index].value === value) continue;
			if (value === "") next.splice(index, 1);
			else next[index] = { name: field.name, value };
		} else if (value !== "" && value !== field.default) {
			next.push({ name: field.name, value });
		}
	}
	return next;
}

export function newMacroId(): string {
	const crypto = globalThis.crypto;
	if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
		const random = Math.floor(Math.random() * 16);
		return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
	});
}

export function newMacroAttrs(def: MacroDef) {
	return {
		name: def.name,
		params: [] as MacroParam[],
		bodyType: def.body === "none" ? null : def.body,
		body: def.body === "plain" ? "" : null,
		macroId: newMacroId(),
		schemaVersion: "1",
	};
}

export type TocEntry = { level: number; text: string };

const tocPatternLimit = 200;
const nestedQuantifier = /\([^)]*(?:[+*{]|\|)[^)]*\)[+*{]/;
const backReference = /\\[1-9]/;

/** A user-supplied toc filter, or null when it could backtrack catastrophically. */
function tocPattern(source: string): RegExp | null {
	if (source.length > tocPatternLimit) return null;
	if (nestedQuantifier.test(source) || backReference.test(source)) return null;
	try {
		return new RegExp(source);
	} catch {
		return null;
	}
}

/** Headings a `toc` macro lists, after its level and include/exclude filters. */
export function filterToc(
	headings: TocEntry[],
	params: MacroParam[] | null | undefined,
): TocEntry[] {
	const min = Number(getParam(params, "minLevel")) || 1;
	const max = Number(getParam(params, "maxLevel")) || 6;
	const pattern = (name: string) => {
		const source = getParam(params, name);
		return source ? tocPattern(source) : null;
	};
	const include = pattern("include");
	const exclude = pattern("exclude");
	return headings.filter(
		(heading) =>
			heading.level >= min &&
			heading.level <= max &&
			(!include || include.test(heading.text)) &&
			!exclude?.test(heading.text),
	);
}
