import { endOfDay, startOfDay } from "#lib/dates.ts";
import { listIssueTypes, listPriorities } from "#lib/server/admin/config.ts";
import { getAuditFilterOptions, listAudit } from "#lib/server/admin/system.ts";
import { adminLoad } from "#lib/server/http-svelte.ts";
import type { PageServerLoad } from "./$types";

const pageSize = 50;

function text(value: unknown) {
	return typeof value === "string" ? value : "";
}

function day(value: unknown) {
	const raw = text(value);
	return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function readFilters(url: URL) {
	const read = (key: string) => url.searchParams.get(key) ?? "";
	return {
		actor: read("actor"),
		action: read("action"),
		entityType: read("entityType"),
		from: day(read("from")),
		to: day(read("to")),
		query: read("query"),
	};
}

function changeFields(changes: unknown) {
	if (typeof changes !== "object" || changes === null) return [];
	const record = changes as { from?: unknown; to?: unknown };
	const from =
		typeof record.from === "object" && record.from !== null
			? (record.from as Record<string, unknown>)
			: {};
	const to =
		typeof record.to === "object" && record.to !== null
			? (record.to as Record<string, unknown>)
			: {};
	return [...new Set([...Object.keys(from), ...Object.keys(to)])];
}

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-audit");
	const filters = readFilters(event.url);
	const offset = Math.max(
		0,
		Number.parseInt(event.url.searchParams.get("offset") ?? "", 10) || 0,
	);
	const fromIso = filters.from ? startOfDay(filters.from) : "";
	const toIso = filters.to ? endOfDay(filters.to) : "";
	const [audit, filterOptions] = await Promise.all([
		listAudit(actor, {
			...filters,
			from: fromIso || undefined,
			to: toIso || undefined,
			offset,
			limit: pageSize,
		}),
		getAuditFilterOptions(actor),
	]);

	const showsSettingsIds = audit.entries.some((entry) =>
		changeFields(entry.changes).some(
			(field) =>
				field === "defaultIssueTypeId" || field === "defaultPriorityId",
		),
	);
	const names: Record<string, string> = {};
	if (showsSettingsIds) {
		const [issueTypes, priorities] = await Promise.all([
			listIssueTypes(actor),
			listPriorities(actor),
		]);
		for (const issueType of issueTypes) names[issueType.id] = issueType.name;
		for (const priority of priorities) names[priority.id] = priority.name;
	}

	return { filters, offset, audit, filterOptions, names, fromIso, toIso };
}) satisfies PageServerLoad;
