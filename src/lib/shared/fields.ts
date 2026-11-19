/**
 * Columns the issue navigator can show, for the list, the CSV export and the
 * column picker. `id` is stored in a filter's `columns`; `jql` is the field name
 * used to sort and to build basic-mode queries.
 */
export type FieldKind =
	| "type"
	| "key"
	| "summary"
	| "assignee"
	| "reporter"
	| "priority"
	| "status"
	| "resolution"
	| "datetime"
	| "date"
	| "labels"
	| "list"
	| "issue"
	| "text"
	| "number"
	| "duration";

export interface FieldDefinition {
	id: string;
	name: string;
	jql: string;
	kind: FieldKind;
	/** Column header when Jira abbreviates it. */
	header?: string;
}

export const SYSTEM_FIELDS: FieldDefinition[] = [
	{ id: "type", name: "Type", jql: "issuetype", kind: "type", header: "T" },
	{ id: "key", name: "Key", jql: "key", kind: "key" },
	{ id: "summary", name: "Summary", jql: "summary", kind: "summary" },
	{ id: "assignee", name: "Assignee", jql: "assignee", kind: "assignee" },
	{ id: "reporter", name: "Reporter", jql: "reporter", kind: "reporter" },
	{
		id: "priority",
		name: "Priority",
		jql: "priority",
		kind: "priority",
		header: "P",
	},
	{ id: "status", name: "Status", jql: "status", kind: "status" },
	{
		id: "resolution",
		name: "Resolution",
		jql: "resolution",
		kind: "resolution",
	},
	{ id: "created", name: "Created", jql: "created", kind: "datetime" },
	{ id: "updated", name: "Updated", jql: "updated", kind: "datetime" },
	{ id: "resolved", name: "Resolved", jql: "resolved", kind: "datetime" },
	{ id: "dueDate", name: "Due date", jql: "dueDate", kind: "date" },
	{ id: "labels", name: "Labels", jql: "labels", kind: "labels" },
	{ id: "components", name: "Components", jql: "component", kind: "list" },
	{ id: "fixVersions", name: "Fix versions", jql: "fixVersion", kind: "list" },
	{
		id: "affectsVersions",
		name: "Affects versions",
		jql: "affectedVersion",
		kind: "list",
	},
	{ id: "epic", name: "Epic Link", jql: "epicLink", kind: "issue" },
	{ id: "parent", name: "Parent", jql: "parent", kind: "issue" },
	{ id: "sprint", name: "Sprint", jql: "sprint", kind: "list" },
	{
		id: "storyPoints",
		name: "Story Points",
		jql: "storyPoints",
		kind: "number",
	},
	{ id: "timeSpent", name: "Time Spent", jql: "timespent", kind: "duration" },
	{
		id: "originalEstimate",
		name: "Original estimate",
		jql: "originalEstimate",
		kind: "duration",
	},
	{
		id: "remainingEstimate",
		name: "Remaining Estimate",
		jql: "remainingEstimate",
		kind: "duration",
	},
	{ id: "creator", name: "Creator", jql: "creator", kind: "reporter" },
	{ id: "project", name: "Project", jql: "project", kind: "text" },
];

export const DEFAULT_COLUMNS = [
	"type",
	"key",
	"summary",
	"assignee",
	"reporter",
	"priority",
	"status",
	"resolution",
	"created",
	"updated",
];

export function systemField(id: string) {
	return SYSTEM_FIELDS.find((field) => field.id === id) ?? null;
}

export interface CustomFieldColumn {
	id: string;
	name: string;
	jql: string;
	kind: FieldKind;
}

/** `customfield_10010` becomes `cf[10010]`, which the parser resolves by id. */
export function customFieldJql(sourceId: string, name: string) {
	const match = /^customfield_(\d+)$/.exec(sourceId);
	return match ? `cf[${match[1]}]` : `"${name.replace(/"/g, '\\"')}"`;
}

export function customFieldId(sourceId: string) {
	return `cf:${sourceId}`;
}

export function isCustomColumn(id: string) {
	return id.startsWith("cf:");
}

export function customSourceId(id: string) {
	return id.slice(3);
}

/** Deduplicates stored column ids and falls back to Jira's default columns. */
export function normalizeColumns(columns: unknown): string[] {
	if (!Array.isArray(columns)) return [...DEFAULT_COLUMNS];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of columns) {
		if (typeof value !== "string" || value === "") continue;
		if (seen.has(value)) continue;
		seen.add(value);
		result.push(value);
	}
	return result.length > 0 ? result : [...DEFAULT_COLUMNS];
}

/**
 * Stored columns restricted to the fields this viewer can see. A custom field
 * that was hidden or removed since the filter was saved must not make the
 * navigator fail, so it is dropped and an empty result falls back to defaults.
 */
export function visibleColumns(
	columns: unknown,
	customFields: { id: string }[],
): string[] {
	const visible = new Set([
		...SYSTEM_FIELDS.map((field) => field.id),
		...customFields.map((field) => field.id),
	]);
	const result = normalizeColumns(columns).filter((id) => visible.has(id));
	return result.length > 0 ? result : [...DEFAULT_COLUMNS];
}
