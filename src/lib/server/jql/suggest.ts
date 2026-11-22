import { sql } from "drizzle-orm";
import { builtinFieldId } from "../../shared/jql/fields.ts";
import { isVisibleCustomField } from "../custom-fields.ts";
import {
	type PermissionUser,
	visibleProjectIds,
	visibleUsernames,
} from "../permissions.ts";
import { type JqlCatalog, loadCatalog } from "./catalog.ts";
import { withStatementTimeout } from "./timeout.ts";

export const DEFAULT_SUGGEST_LIMIT = 20;

function startsWith(value: string, prefix: string) {
	return value.toLowerCase().startsWith(prefix.toLowerCase());
}

function unique(values: string[]) {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (value === "" || seen.has(value)) continue;
		seen.add(value);
		result.push(value);
	}
	return result;
}

async function issueKeys(prefix: string, limit: number, visible: string[]) {
	const pattern = `${prefix.replace(/[!%_\\]/g, (character) => `!${character}`)}%`;
	const filter =
		visible.length === 0
			? sql`and false`
			: sql`and project_id = any(${sql.param(visible)}::uuid[])`;
	const result = await withStatementTimeout(async (tx) =>
		tx.execute(
			sql`select key from issues where key ilike ${pattern} escape '!' ${filter} order by key limit ${limit}`,
		),
	);
	return (result.rows as { key: string }[]).map((row) => row.key);
}

function customValues(
	catalog: JqlCatalog,
	sourceId: string,
	prefix: string,
	limit: number,
	usernames: Set<string>,
) {
	const field = catalog.customFields.find((item) => item.sourceId === sourceId);
	if (!field || !isVisibleCustomField(field)) return [];
	const options = catalog.fieldOptions
		.filter((option) => option.fieldId === field.id)
		.map((option) => option.value);
	const matching = options.filter((value) => startsWith(value, prefix));
	if (matching.length > 0 || !field.customKey?.endsWith(":multiuserpicker")) {
		return unique(matching).slice(0, limit);
	}
	return catalog.users
		.filter(
			(user) =>
				startsWith(user.username, prefix) && usernames.has(user.username),
		)
		.map((user) => user.username)
		.slice(0, limit);
}

async function suggestValues(
	fieldName: string,
	prefix: string,
	limit: number,
	viewer: PermissionUser,
): Promise<string[]> {
	const builtin = builtinFieldId(fieldName);
	let catalog: JqlCatalog | null = null;
	const getCatalog = async () => {
		catalog ??= await loadCatalog();
		return catalog;
	};

	if (!builtin) {
		const loaded = await getCatalog();
		const customId = /^cf\[(\d+)\]$/.exec(fieldName.trim());
		const custom = customId
			? loaded.customFields.find(
					(item) => item.sourceId === `customfield_${customId[1]}`,
				)
			: loaded.customFields.find(
					(item) => item.name.toLowerCase() === fieldName.trim().toLowerCase(),
				);
		if (!custom) return [];
		return customValues(
			loaded,
			custom.sourceId,
			prefix,
			limit,
			await visibleUsernames(viewer),
		);
	}

	const values = (items: { name: string }[]) =>
		unique(
			items
				.map((item) => item.name)
				.filter((value) => startsWith(value, prefix)),
		).slice(0, limit);

	switch (builtin) {
		case "statusCategory":
			return ["To Do", "In Progress", "Done"].filter((value) =>
				startsWith(value, prefix),
			);
		case "project": {
			const loaded = await getCatalog();
			const visibleSet = new Set(await visibleProjectIds(viewer));
			return unique(
				loaded.projects
					.filter((project) => visibleSet.has(project.id))
					.flatMap((project) => [project.key, project.name]),
			)
				.filter((value) => startsWith(value, prefix))
				.slice(0, limit);
		}
		case "issuetype":
			return values((await getCatalog()).issueTypes);
		case "status":
			return values((await getCatalog()).statuses);
		case "priority":
			return values((await getCatalog()).priorities);
		case "resolution":
			return unique([
				...(await getCatalog()).resolutions.map((item) => item.name),
				"Unresolved",
			])
				.filter((value) => startsWith(value, prefix))
				.slice(0, limit);
		case "assignee":
		case "reporter":
		case "creator":
		case "watcher": {
			const usernames = await visibleUsernames(viewer);
			return (await getCatalog()).users
				.filter(
					(user) =>
						usernames.has(user.username) &&
						(startsWith(user.username, prefix) ||
							startsWith(user.displayName, prefix)),
				)
				.map((user) => user.username)
				.slice(0, limit);
		}
		case "labels": {
			const visible = await visibleProjectIds(viewer);
			if (visible.length === 0) return [];
			const pattern = `${prefix.replace(/[!%_\\]/g, (character) => `!${character}`)}%`;
			const rows = await withStatementTimeout(async (tx) =>
				tx.execute(sql`
					select distinct il.label
					from issue_labels il
					join issues i on i.id = il.issue_id
					where i.project_id = any(${sql.param(visible)}::uuid[])
						and il.label ilike ${pattern} escape '!'
					order by il.label
					limit ${limit}
				`),
			);
			return unique((rows.rows as { label: string }[]).map((row) => row.label));
		}
		case "component": {
			const loaded = await getCatalog();
			const visibleSet = new Set(await visibleProjectIds(viewer));
			return values(
				loaded.components.filter((item) => visibleSet.has(item.projectId)),
			);
		}
		case "fixVersion":
		case "affectedVersion": {
			const loaded = await getCatalog();
			const visibleSet = new Set(await visibleProjectIds(viewer));
			return values(
				loaded.versions.filter((item) => visibleSet.has(item.projectId)),
			);
		}
		case "sprint": {
			const loaded = await getCatalog();
			const visibleSet = new Set(await visibleProjectIds(viewer));
			return values(
				loaded.sprints.filter((item) => visibleSet.has(item.projectId)),
			);
		}
		case "epicLink":
		case "parent":
		case "key":
			return issueKeys(prefix, limit, await visibleProjectIds(viewer));
		default:
			return [];
	}
}

function clampLimit(limit: number, fallback = DEFAULT_SUGGEST_LIMIT) {
	const value = Number.isFinite(limit) ? Math.trunc(limit) : fallback;
	return Math.min(50, Math.max(1, value));
}

export async function suggest(
	actor: PermissionUser,
	input: { field: string; prefix: string; limit: number },
) {
	const values = await suggestValues(
		input.field,
		input.prefix,
		clampLimit(input.limit),
		actor,
	);
	return { values };
}
