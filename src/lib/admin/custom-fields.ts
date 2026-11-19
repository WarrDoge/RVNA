/**
 * The configurable custom field types, as the administration screens name and
 * describe them. The server derives the same list from `fields.custom_key`.
 */
export type FieldTypeId =
	| "text"
	| "paragraph"
	| "number"
	| "date"
	| "datetime"
	| "select"
	| "multiselect"
	| "cascading"
	| "user"
	| "multiuser"
	| "labels"
	| "url";

export type FieldTypeInfo = {
	id: FieldTypeId;
	/** Jira's name for the type, so the page reads like the one users know. */
	label: string;
	description: string;
	options: boolean;
};

export const FIELD_TYPES: FieldTypeInfo[] = [
	{
		id: "text",
		label: "Text Field (single line)",
		description: "A short line of text, up to 255 characters.",
		options: false,
	},
	{
		id: "paragraph",
		label: "Text Field (multi-line)",
		description: "Plain text over several lines, up to 32 000 characters.",
		options: false,
	},
	{
		id: "number",
		label: "Number Field",
		description: "A numeric value, for example 3 or 4.5.",
		options: false,
	},
	{
		id: "date",
		label: "Date Picker",
		description: "A calendar day without a time.",
		options: false,
	},
	{
		id: "datetime",
		label: "Date Time Picker",
		description: "A calendar day with the time of day.",
		options: false,
	},
	{
		id: "select",
		label: "Select List (single choice)",
		description: "One value from a list you maintain.",
		options: true,
	},
	{
		id: "multiselect",
		label: "Select List (multiple choices)",
		description: "Any number of values from a list you maintain.",
		options: true,
	},
	{
		id: "cascading",
		label: "Select List (cascading)",
		description: "A parent value and, under it, a child value.",
		options: true,
	},
	{
		id: "user",
		label: "User Picker (single user)",
		description: "One active user of this instance.",
		options: false,
	},
	{
		id: "multiuser",
		label: "User Picker (multiple users)",
		description: "Any number of active users.",
		options: false,
	},
	{
		id: "labels",
		label: "Labels",
		description: "Free-form labels, the same ones issues already use.",
		options: false,
	},
	{
		id: "url",
		label: "URL Field",
		description: "A web address, shown as a link.",
		options: false,
	},
];

const typeById = new Map(FIELD_TYPES.map((type) => [type.id, type]));

export function fieldTypeInfo(type: string | null): FieldTypeInfo | null {
	return type === null ? null : (typeById.get(type as FieldTypeId) ?? null);
}

/** Jira's label for an admin type; imported system fields have no admin type. */
export function fieldTypeLabel(type: string | null): string {
	return fieldTypeInfo(type)?.label ?? "System field";
}

export function isOptionType(type: string | null) {
	return fieldTypeInfo(type)?.options ?? false;
}

export type FieldContextRef = {
	id: string;
	project: { id: string; key: string; name: string } | null;
	issueType: { id: string; name: string } | null;
};

export type AdminField = {
	id: string;
	name: string;
	description: string | null;
	type: FieldTypeId | null;
	configurable: boolean;
	required: boolean;
	contexts: FieldContextRef[];
	issueCount: number;
};

/** A parent option; the server sends child options without their own children. */
export type FieldOptionChild = {
	id: string;
	value: string;
	disabled: boolean;
};

export type FieldOption = FieldOptionChild & {
	children: FieldOptionChild[];
};

export type AdminFieldDetail = AdminField & { options: FieldOption[] };

export type IssueTypeOption = { id: string; name: string };

export type ProjectOption = { id: string; name: string };

/** "Global", "2 projects", "3 issue types", or both. */
export function contextSummary(contexts: FieldContextRef[]): string {
	if (contexts.length === 0) return "None";
	if (contexts.some((context) => !context.project && !context.issueType)) {
		return "Global";
	}
	const projects = new Set(
		contexts.map((context) => context.project?.id).filter(Boolean),
	);
	const issueTypes = new Set(
		contexts.map((context) => context.issueType?.id).filter(Boolean),
	);
	const parts: string[] = [];
	if (projects.size > 0) {
		parts.push(`${projects.size} project${projects.size === 1 ? "" : "s"}`);
	}
	if (issueTypes.size > 0) {
		parts.push(
			`${issueTypes.size} issue type${issueTypes.size === 1 ? "" : "s"}`,
		);
	}
	return parts.join(", ");
}
