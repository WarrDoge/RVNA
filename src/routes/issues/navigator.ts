import type { CustomFieldColumn } from "#lib/api-types.ts";
import {
	customSourceId,
	isCustomColumn,
	systemField,
	visibleColumns,
} from "#lib/shared/fields.ts";
import { parseJql } from "#lib/shared/jql/index.ts";

export const DEFAULT_JQL = "ORDER BY key DESC";
export const PAGE_SIZE = 50;

/** Columns a saved filter or preference may keep: visible fields only. */
export function normalizeNavigatorColumns(
	columns: unknown,
	customFields: CustomFieldColumn[],
) {
	return visibleColumns(columns, customFields);
}

/** The query the "Viewed recently" shortcut loads from the server. */
export function recentJql(keys: string[]) {
	return keys.length > 0
		? `key in (${keys.join(", ")}) ORDER BY created DESC`
		: "key = NONE";
}

/** A link to the current search, keeping the query, selection, view and page. */
export function shareUrl(
	origin: string,
	input: {
		filterId?: string | null;
		jql: string;
		selectedIssue?: string | null;
		view: "list" | "detail";
		startAt: number;
	},
) {
	const params = new URLSearchParams();
	if (input.filterId) params.set("filter", input.filterId);
	else params.set("jql", input.jql);
	if (input.selectedIssue) params.set("selectedIssue", input.selectedIssue);
	if (input.view === "detail") params.set("view", "detail");
	if (input.startAt > 0) params.set("startAt", String(input.startAt));
	return `${origin}/issues/?${params.toString()}`;
}

export interface StandardFilter {
	name: string;
	jql?: string;
	recent?: boolean;
}

export const STANDARD_FILTERS: StandardFilter[] = [
	{
		name: "My open issues",
		jql: "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
	},
	{
		name: "Reported by me",
		jql: "reporter = currentUser() ORDER BY created DESC",
	},
	{ name: "All issues", jql: "ORDER BY key DESC" },
	{
		name: "Open issues",
		jql: "resolution = Unresolved ORDER BY priority DESC",
	},
	{
		name: "Done issues",
		jql: "resolution != Unresolved ORDER BY updated DESC",
	},
	{ name: "Viewed recently", recent: true },
	{ name: "Created recently", jql: "created >= -7d ORDER BY created DESC" },
	{ name: "Resolved recently", jql: "resolved >= -7d ORDER BY resolved DESC" },
	{ name: "Updated recently", jql: "updated >= -7d ORDER BY updated DESC" },
];

/** Drops a trailing ORDER BY so a new sort can be appended. */
export function stripOrderBy(jql: string) {
	let depth = 0;
	let quoted = false;
	for (let index = 0; index < jql.length; index++) {
		const character = jql[index];
		if (quoted) {
			if (character === "\\") index++;
			else if (character === '"') quoted = false;
			continue;
		}
		if (character === '"') {
			quoted = true;
			continue;
		}
		if (character === "(") depth++;
		if (character === ")") depth--;
		if (depth === 0 && /^order\s+by\b/i.test(jql.slice(index))) {
			const before = index === 0 ? "" : (jql[index - 1] as string);
			if (index === 0 || /[\s)]/.test(before))
				return jql.slice(0, index).trimEnd();
		}
	}
	return jql.trimEnd();
}

export function withOrderBy(
	jql: string,
	field: string,
	direction: "asc" | "desc",
) {
	const where = stripOrderBy(jql);
	return `${where === "" ? "" : `${where} `}ORDER BY ${field} ${direction.toUpperCase()}`;
}

export function sortState(jql: string) {
	try {
		return parseJql(jql).orderBy;
	} catch {
		return [];
	}
}

export function columnName(column: string, customFields: CustomFieldColumn[]) {
	if (isCustomColumn(column)) {
		return (
			customFields.find((field) => field.id === column)?.name ??
			customSourceId(column)
		);
	}
	return systemField(column)?.name ?? column;
}

export function columnHeader(
	column: string,
	customFields: CustomFieldColumn[],
) {
	if (isCustomColumn(column)) return columnName(column, customFields);
	return systemField(column)?.header ?? systemField(column)?.name ?? column;
}

export function columnJql(column: string, customFields: CustomFieldColumn[]) {
	if (isCustomColumn(column)) {
		return customFields.find((field) => field.id === column)?.jql ?? "";
	}
	return systemField(column)?.jql ?? "";
}

export function columnWidth(column: string) {
	switch (column) {
		case "type":
			return 32;
		case "key":
			return 90;
		case "assignee":
		case "reporter":
		case "creator":
			return 140;
		case "priority":
			return 32;
		case "status":
			return 110;
		case "resolution":
			return 110;
		case "created":
		case "updated":
		case "resolved":
			return 120;
		default:
			return undefined;
	}
}

export function formatSeconds(seconds: number | null) {
	if (seconds === null) return "";
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
	if (hours > 0) return `${hours}h`;
	if (minutes > 0) return `${minutes}m`;
	return `${seconds}s`;
}

export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : "Something went wrong";
}
