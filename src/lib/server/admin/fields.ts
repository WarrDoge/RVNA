import { randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { CurrentUser } from "../auth.ts";
import {
	adminFieldTypeSchema,
	adminTypeForField,
	customKeyForAdminType,
	customValueText,
	type LoadedField,
	type LoadedOption,
	loadOptionRows,
	lockStoredValues,
	optionFieldTypes,
	optionTree,
	optionUsage,
	storedTypeForAdminType,
	toLoadedField,
} from "../custom-fields.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import { requireAdminActor } from "../permissions.ts";
import {
	fieldContexts,
	fieldOptions,
	fields,
	issues,
	issueTypes,
	projects,
} from "../schema.ts";
import { audit } from "./audit.ts";

type FieldRow = typeof fields.$inferSelect;

/** Advisory lock key that serializes `customfield_<n>` allocation. */
const fieldNumberLockKey = 7_418_529_631;

const fieldParams = z.object({ id: z.uuid() });
const optionParams = z.object({ id: z.uuid(), optionId: z.uuid() });

function objectOf(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function optionMatches(object: Record<string, unknown>, option: LoadedOption) {
	const id = typeof object.id === "string" ? object.id : null;
	if (id !== null) return id === option.id;
	const text = typeof object.value === "string" ? object.value : null;
	return text !== null && text.toLowerCase() === option.value.toLowerCase();
}

async function loadFieldRow(id: string) {
	const [row] = await db
		.select()
		.from(fields)
		.where(eq(fields.id, id))
		.limit(1);
	return row ?? null;
}

async function loadLoadedField(id: string) {
	const row = await loadFieldRow(id);
	if (!row) return null;
	const type = adminTypeForField(row);
	if (!type) return null;
	const options = (await loadOptionRows([row.id])).get(row.id) ?? [];
	return toLoadedField(row, type, options);
}

async function nameTaken(name: string, exceptId?: string) {
	const [row] = await db
		.select({ id: fields.id, name: fields.name })
		.from(fields)
		.where(sql`lower(${fields.name}) = lower(${name})`)
		.limit(1);
	if (!row) return null;
	return row.id === exceptId ? null : row;
}

async function contextMap(fieldIds: string[]) {
	const result = new Map<
		string,
		{
			id: string;
			project: { id: string; key: string; name: string } | null;
			issueType: { id: string; name: string } | null;
		}[]
	>();
	if (fieldIds.length === 0) return result;
	const rows = await db
		.select({
			id: fieldContexts.id,
			fieldId: fieldContexts.fieldId,
			projectId: fieldContexts.projectId,
			projectKey: projects.key,
			projectName: projects.name,
			issueTypeId: fieldContexts.issueTypeId,
			issueTypeName: issueTypes.name,
		})
		.from(fieldContexts)
		.leftJoin(projects, eq(projects.id, fieldContexts.projectId))
		.leftJoin(issueTypes, eq(issueTypes.id, fieldContexts.issueTypeId))
		.where(inArray(fieldContexts.fieldId, fieldIds))
		.orderBy(asc(projects.name), asc(issueTypes.name));
	for (const row of rows) {
		const list = result.get(row.fieldId) ?? [];
		list.push({
			id: row.id,
			project:
				row.projectId && row.projectKey && row.projectName
					? {
							id: row.projectId,
							key: row.projectKey,
							name: row.projectName,
						}
					: null,
			issueType:
				row.issueTypeId && row.issueTypeName
					? { id: row.issueTypeId, name: row.issueTypeName }
					: null,
		});
		result.set(row.fieldId, list);
	}
	return result;
}

async function optionCountMap(fieldIds: string[]) {
	const result = new Map<string, number>();
	if (fieldIds.length === 0) return result;
	const rows = await db
		.select({
			fieldId: fieldOptions.fieldId,
			count: sql<number>`count(*)::int`,
		})
		.from(fieldOptions)
		.where(inArray(fieldOptions.fieldId, fieldIds))
		.groupBy(fieldOptions.fieldId);
	for (const row of rows) result.set(row.fieldId, row.count);
	return result;
}

/** How many issues store a value for each field, keyed by `fields.source_id`. */
async function storedValueCounts() {
	const result = await db.execute(sql`
		select keys.key as key, count(*)::int as count
		from ${issues}, jsonb_object_keys(${issues.custom}) as keys(key)
		where jsonb_typeof(${issues.custom} -> keys.key) <> 'null'
		group by keys.key
	`);
	const counts = new Map<string, number>();
	for (const row of result.rows as { key: string; count: number }[]) {
		counts.set(row.key, Number(row.count));
	}
	return counts;
}

async function summaries(rows: FieldRow[]) {
	const ids = rows.map((row) => row.id);
	const [contexts, optionCounts, storedCounts] = await Promise.all([
		contextMap(ids),
		optionCountMap(ids),
		storedValueCounts(),
	]);
	return rows.map((row) => {
		const type = adminTypeForField(row);
		return {
			id: row.id,
			name: row.name,
			description: row.description,
			type,
			configurable: type !== null,
			required: row.required,
			optionCount: optionCounts.get(row.id) ?? 0,
			issueCount: storedCounts.get(row.sourceId) ?? 0,
			contexts: contexts.get(row.id) ?? [],
		};
	});
}

async function detail(row: FieldRow) {
	const [summary] = await summaries([row]);
	const options = (await loadOptionRows([row.id])).get(row.id) ?? [];
	return {
		...summary,
		sourceId: row.sourceId,
		options: optionTree(options, true),
	};
}

function siblingOptions(field: LoadedField, parentOptionId: string | null) {
	return field.options.filter(
		(option) => option.parentOptionId === parentOptionId,
	);
}

function optionChildren(field: LoadedField, optionId: string) {
	return field.options.filter((option) => option.parentOptionId === optionId);
}

function optionWithChildren(field: LoadedField, option: LoadedOption) {
	return {
		id: option.id,
		value: option.value,
		disabled: option.disabled,
		children: optionChildren(field, option.id)
			.sort((a, b) => a.sequence - b.sequence || a.value.localeCompare(b.value))
			.map((child) => ({
				id: child.id,
				value: child.value,
				disabled: child.disabled,
			})),
	};
}

function contextLabel(context: {
	project: { name: string } | null;
	issueType: { name: string } | null;
}) {
	if (context.project && context.issueType) {
		return `${context.project.name} / ${context.issueType.name}`;
	}
	if (context.project) return `${context.project.name} (all issue types)`;
	if (context.issueType) return `all projects / ${context.issueType.name}`;
	return "all projects and issue types";
}

/** Rewrites an option reference inside any stored value of the field. */
function replaceOptionRefs(
	value: unknown,
	option: LoadedOption,
	replacement: { id: string; value: string },
): { value: unknown; changed: boolean } {
	if (Array.isArray(value)) {
		let changed = false;
		const items = value.map((item) => {
			const result = replaceOptionRefs(item, option, replacement);
			changed = changed || result.changed;
			return result.value;
		});
		return { value: changed ? items : value, changed };
	}
	const object = objectOf(value);
	if (!object) return { value, changed: false };
	let changed = false;
	const next: Record<string, unknown> = { ...object };
	if (optionMatches(object, option)) {
		next.value = replacement.value;
		next.id = replacement.id;
		changed = true;
	}
	if (next.child !== undefined && next.child !== null) {
		const child = replaceOptionRefs(next.child, option, replacement);
		if (child.changed) {
			next.child = child.value;
			changed = true;
		}
	}
	return { value: changed ? next : value, changed };
}

function planOptionRemoval(
	field: LoadedField,
	value: unknown,
	option: LoadedOption,
	target: LoadedOption | null,
): { value: unknown; missing: string[] } {
	if (field.type === "cascading") {
		const object = objectOf(value);
		if (object && optionMatches(object, option)) {
			if (!target) return { value, missing: [] };
			const child = objectOf(object.child);
			if (!child) {
				return { value: { value: target.value, id: target.id }, missing: [] };
			}
			const childValue =
				typeof child.value === "string" ? child.value : String(child.value);
			const childTarget = field.options.find(
				(candidate) =>
					candidate.parentOptionId === target.id &&
					candidate.value.toLowerCase() === childValue.toLowerCase(),
			);
			if (!childTarget) {
				return { value, missing: [`${option.value} / ${childValue}`] };
			}
			return {
				value: {
					value: target.value,
					id: target.id,
					child: { value: childTarget.value, id: childTarget.id },
				},
				missing: [],
			};
		}
		if (object?.child) {
			const child = objectOf(object.child);
			if (child && optionMatches(child, option)) {
				if (!target) return { value, missing: [] };
				return {
					value: { ...object, child: { value: target.value, id: target.id } },
					missing: [],
				};
			}
		}
		return { value, missing: [] };
	}
	if (field.type === "multiselect") {
		if (!Array.isArray(value)) return { value, missing: [] };
		const items = value.map((item) => {
			const object = objectOf(item);
			if (!object || !optionMatches(object, option) || !target) return item;
			return { value: target.value, id: target.id };
		});
		return { value: items, missing: [] };
	}
	const object = objectOf(value);
	if (object && optionMatches(object, option) && target) {
		return { value: { value: target.value, id: target.id }, missing: [] };
	}
	return { value, missing: [] };
}

/** Converts a stored value of `from` into the shape `to` accepts. */
function convertFieldValue(
	from: LoadedField,
	to: LoadedField,
	value: unknown,
): { value: unknown; missing: string[] } {
	const enabled = (field: LoadedField) =>
		field.options.filter((option) => !option.disabled);
	const findEnabled = (field: LoadedField, text: string) =>
		enabled(field).find(
			(option) => option.value.toLowerCase() === text.toLowerCase(),
		) ?? null;

	if (from.type === "select") {
		const text = customValueText(value);
		const target = findEnabled(to, text);
		if (!target) return { value: null, missing: [text] };
		return { value: { value: target.value, id: target.id }, missing: [] };
	}
	if (from.type === "multiselect") {
		if (!Array.isArray(value)) return { value: null, missing: [] };
		const missing: string[] = [];
		const items: { value: string; id: string }[] = [];
		for (const item of value) {
			const text = customValueText(item);
			const target = findEnabled(to, text);
			if (!target) {
				missing.push(text);
				continue;
			}
			items.push({ value: target.value, id: target.id });
		}
		return { value: items.length === 0 ? null : items, missing };
	}
	if (from.type === "cascading") {
		const object = objectOf(value);
		if (!object) return { value: null, missing: [] };
		const parentText = customValueText({ value: object.value });
		const parent = findEnabled(to, parentText);
		if (!parent) return { value: null, missing: [parentText] };
		const child = objectOf(object.child);
		if (!child) {
			return { value: { value: parent.value, id: parent.id }, missing: [] };
		}
		const childText = customValueText({ value: child.value });
		const childTarget = enabled(to).find(
			(option) =>
				option.parentOptionId === parent.id &&
				option.value.toLowerCase() === childText.toLowerCase(),
		);
		if (!childTarget) {
			return { value: null, missing: [`${parentText} / ${childText}`] };
		}
		return {
			value: {
				value: parent.value,
				id: parent.id,
				child: { value: childTarget.value, id: childTarget.id },
			},
			missing: [],
		};
	}
	return { value, missing: [] };
}

const createFieldBody = z.object({
	name: z.string().trim().min(1).max(255),
	description: z.string().trim().max(1000).nullable().optional(),
	type: adminFieldTypeSchema,
	required: z.boolean().optional(),
});

const updateFieldBody = z.object({
	name: z.string().trim().min(1).max(255).optional(),
	description: z.string().trim().max(1000).nullable().optional(),
	required: z.boolean().optional(),
});

const migrateQuery = z.object({ migrateTo: z.uuid().optional() });

const createOptionBody = z.object({
	value: z.string().trim().min(1).max(255),
	parentOptionId: z.uuid().optional(),
});

const updateOptionBody = z.object({
	value: z.string().trim().min(1).max(255).optional(),
	disabled: z.boolean().optional(),
});

const reorderOptionsBody = z.object({
	parentOptionId: z.uuid().nullable().optional(),
	ids: z.array(z.uuid()),
});

const contextsBody = z.object({
	contexts: z.array(
		z.object({
			projectId: z.uuid().nullable().optional(),
			issueTypeId: z.uuid().nullable().optional(),
		}),
	),
});

export type CreateFieldInput = z.infer<typeof createFieldBody>;
export type UpdateFieldInput = z.infer<typeof updateFieldBody>;
export type CreateOptionInput = z.infer<typeof createOptionBody>;
export type UpdateOptionInput = z.infer<typeof updateOptionBody>;
export type ReorderOptionsInput = z.infer<typeof reorderOptionsBody>;
export type ContextsInput = z.infer<typeof contextsBody>;

export {
	contextsBody,
	createFieldBody,
	createOptionBody,
	fieldParams,
	migrateQuery,
	optionParams,
	reorderOptionsBody,
	updateFieldBody,
	updateOptionBody,
};

export async function listCustomFields(_actor: CurrentUser) {
	requireAdminActor(_actor);
	const rows = await db.select().from(fields).orderBy(asc(fields.name));
	return summaries(rows);
}

export async function createCustomField(
	actor: CurrentUser,
	body: CreateFieldInput,
) {
	requireAdminActor(actor);
	const taken = await nameTaken(body.name);
	if (taken) {
		throw new HttpError(409, `A field named "${taken.name}" already exists`);
	}

	const created = await db.transaction(async (tx) => {
		await tx.execute(
			sql`select pg_advisory_xact_lock(${fieldNumberLockKey}::bigint)`,
		);
		const result = await tx.execute(sql`
			select greatest(
				10299,
				coalesce(max(substring(source_id from 13)::bigint), 0)
			) as max
			from fields
			where source_id ~ '^customfield_[0-9]+$'
		`);
		const max = Number((result.rows[0] as { max: string }).max);
		const [row] = await tx
			.insert(fields)
			.values({
				sourceId: `customfield_${max + 1}`,
				name: body.name,
				description: body.description ?? null,
				type: storedTypeForAdminType(body.type),
				customKey: customKeyForAdminType(body.type),
				required: body.required ?? false,
			})
			.returning();
		await audit(tx, actor, {
			action: "field.create",
			entityType: "field",
			entityId: row.id,
			summary: `Created custom field "${row.name}"`,
			changes: {
				from: null,
				to: {
					name: row.name,
					type: body.type,
					required: row.required,
				},
			},
		});
		return row;
	});

	return detail(created);
}

export async function getCustomField(_actor: CurrentUser, id: string) {
	requireAdminActor(_actor);
	const row = await loadFieldRow(id);
	if (!row) throw new HttpError(404, "Field not found");
	return detail(row);
}

export async function updateCustomField(
	actor: CurrentUser,
	id: string,
	body: UpdateFieldInput,
) {
	requireAdminActor(actor);
	const row = await loadFieldRow(id);
	if (!row) throw new HttpError(404, "Field not found");
	if (!adminTypeForField(row)) {
		throw new HttpError(
			409,
			`"${row.name}" is a system field and cannot be changed`,
		);
	}

	const taken = body.name ? await nameTaken(body.name, row.id) : null;
	if (taken) {
		throw new HttpError(409, `A field named "${taken.name}" already exists`);
	}

	const next = {
		name: body.name ?? row.name,
		description:
			body.description === undefined ? row.description : body.description,
		required: body.required ?? row.required,
	};
	const from: Record<string, unknown> = {};
	const to: Record<string, unknown> = {};
	if (next.name !== row.name) {
		from.name = row.name;
		to.name = next.name;
	}
	if (next.description !== row.description) {
		from.description = row.description;
		to.description = next.description;
	}
	if (next.required !== row.required) {
		from.required = row.required;
		to.required = next.required;
	}

	await db.transaction(async (tx) => {
		await tx
			.update(fields)
			.set({ ...next, updatedAt: new Date() })
			.where(eq(fields.id, row.id));
		await audit(tx, actor, {
			action: "field.update",
			entityType: "field",
			entityId: row.id,
			summary: `Updated custom field "${next.name}"`,
			changes: Object.keys(to).length === 0 ? null : { from, to },
		});
	});

	return detail({ ...row, ...next });
}

export async function deleteCustomField(
	actor: CurrentUser,
	id: string,
	query: z.infer<typeof migrateQuery>,
): Promise<void> {
	requireAdminActor(actor);
	const row = await loadFieldRow(id);
	if (!row) throw new HttpError(404, "Field not found");
	const type = adminTypeForField(row);
	const count = (await storedValueCounts()).get(row.sourceId) ?? 0;

	if (!type) {
		throw new HttpError(
			409,
			`"${row.name}" is a system field and cannot be deleted`,
			{ details: { count, canMigrate: false } },
		);
	}

	const migrateTo = query.migrateTo;
	if (count > 0 && !migrateTo) {
		const others = await db.select().from(fields);
		const canMigrate = others.some(
			(other) => other.id !== row.id && adminTypeForField(other) === type,
		);
		throw new HttpError(
			409,
			`"${row.name}" is used by ${count} issue${count === 1 ? "" : "s"}`,
			{ details: { count, canMigrate } },
		);
	}

	if (count === 0 || !migrateTo) {
		await db.transaction(async (tx) => {
			await tx.delete(fields).where(eq(fields.id, row.id));
			await audit(tx, actor, {
				action: "field.delete",
				entityType: "field",
				entityId: row.id,
				summary: `Deleted custom field "${row.name}"`,
				changes: {
					from: { name: row.name, type, issueCount: count },
					to: null,
				},
			});
		});
		return;
	}

	if (migrateTo === row.id) {
		throw new HttpError(400, "A field cannot be migrated to itself");
	}
	const targetRow = await loadFieldRow(migrateTo);
	if (!targetRow) throw new HttpError(404, "Target field not found");
	const targetType = adminTypeForField(targetRow);
	if (targetType !== type) {
		throw new HttpError(400, `The target field must be a ${type} field`);
	}
	const from = await loadLoadedField(row.id);
	const to = await loadLoadedField(targetRow.id);
	if (!from || !to) throw new HttpError(404, "Field not found");

	const result = await db.transaction(async (tx) => {
		const stored = await lockStoredValues(tx, from);
		const plan = stored.map((issue) => ({
			id: issue.id,
			...convertFieldValue(from, to, issue.custom[from.sourceId]),
		}));
		const missing = [...new Set(plan.flatMap((step) => step.missing))];
		if (missing.length > 0) return { ok: false as const, missing };

		for (const step of plan) {
			const issue = stored.find((item) => item.id === step.id);
			if (!issue) continue;
			const custom: Record<string, unknown> = { ...issue.custom };
			delete custom[from.sourceId];
			if (step.value !== null) custom[to.sourceId] = step.value;
			await tx.update(issues).set({ custom }).where(eq(issues.id, step.id));
		}

		await tx.delete(fields).where(eq(fields.id, row.id));
		await audit(tx, actor, {
			action: "field.migrate",
			entityType: "field",
			entityId: row.id,
			summary: `Moved ${plan.length} issue value${plan.length === 1 ? "" : "s"} from "${row.name}" to "${targetRow.name}"`,
			changes: {
				from: { field: row.name, count: plan.length },
				to: { field: targetRow.name },
			},
		});
		await audit(tx, actor, {
			action: "field.delete",
			entityType: "field",
			entityId: row.id,
			summary: `Deleted custom field "${row.name}"`,
			changes: {
				from: { name: row.name, type, issueCount: plan.length },
				to: null,
			},
		});
		return { ok: true as const, moved: plan.length };
	});

	if (!result.ok) {
		throw new HttpError(
			400,
			`The target field has no option ${result.missing.map((value) => `"${value}"`).join(", ")}`,
		);
	}
}

export async function createCustomFieldOption(
	actor: CurrentUser,
	id: string,
	body: CreateOptionInput,
) {
	requireAdminActor(actor);
	const row = await loadFieldRow(id);
	if (!row) throw new HttpError(404, "Field not found");
	const type = adminTypeForField(row);
	if (!type) {
		throw new HttpError(
			409,
			`"${row.name}" is a system field and cannot be changed`,
		);
	}
	if (!optionFieldTypes.has(type)) {
		throw new HttpError(409, `A ${type} field has no options`);
	}
	const field = await loadLoadedField(row.id);
	if (!field) throw new HttpError(404, "Field not found");

	const parentOptionId = body.parentOptionId ?? null;
	if (parentOptionId) {
		if (type !== "cascading") {
			throw new HttpError(
				400,
				"Only cascading select fields have child options",
			);
		}
		const parent = field.options.find((option) => option.id === parentOptionId);
		if (!parent) throw new HttpError(400, "Unknown parent option");
		if (parent.parentOptionId !== null) {
			throw new HttpError(400, "A child option cannot have children");
		}
	}

	const value = body.value;
	const siblings = siblingOptions(field, parentOptionId);
	if (
		siblings.some(
			(option) => option.value.toLowerCase() === value.toLowerCase(),
		)
	) {
		throw new HttpError(409, `The option "${value}" already exists`);
	}
	const sequence =
		siblings.reduce((max, option) => Math.max(max, option.sequence), -1) + 1;

	const created = await db.transaction(async (tx) => {
		const [option] = await tx
			.insert(fieldOptions)
			.values({
				sourceId: `local:${randomUUID()}`,
				fieldId: row.id,
				value,
				parentOptionId,
				sequence,
			})
			.returning();
		await audit(tx, actor, {
			action: "field.option.create",
			entityType: "field",
			entityId: row.id,
			summary: `Added option "${value}" to "${row.name}"`,
			changes: { from: null, to: { value } },
		});
		return option;
	});

	return {
		id: created.id,
		value: created.value,
		disabled: created.disabled,
		children: [],
	};
}

export async function updateCustomFieldOption(
	actor: CurrentUser,
	id: string,
	optionId: string,
	body: UpdateOptionInput,
) {
	requireAdminActor(actor);
	const field = await loadLoadedField(id);
	if (!field) {
		const row = await loadFieldRow(id);
		if (!row) throw new HttpError(404, "Field not found");
		throw new HttpError(
			409,
			`"${row.name}" is a system field and cannot be changed`,
		);
	}
	const option = field.options.find((item) => item.id === optionId);
	if (!option) throw new HttpError(404, "Option not found");

	const value = body.value ?? option.value;
	const disabled = body.disabled ?? option.disabled;
	if (value !== option.value) {
		const siblings = siblingOptions(field, option.parentOptionId).filter(
			(item) => item.id !== option.id,
		);
		if (
			siblings.some((item) => item.value.toLowerCase() === value.toLowerCase())
		) {
			throw new HttpError(409, `The option "${value}" already exists`);
		}
	}

	const renamed = value !== option.value;
	await db.transaction(async (tx) => {
		await tx
			.update(fieldOptions)
			.set({ value, disabled, updatedAt: new Date() })
			.where(eq(fieldOptions.id, option.id));
		if (renamed) {
			const stored = await lockStoredValues(tx, field);
			for (const issue of stored) {
				const replaced = replaceOptionRefs(
					issue.custom[field.sourceId],
					option,
					{ id: option.id, value },
				);
				if (!replaced.changed) continue;
				const custom = {
					...issue.custom,
					[field.sourceId]: replaced.value,
				};
				await tx.update(issues).set({ custom }).where(eq(issues.id, issue.id));
			}
		}
		await audit(tx, actor, {
			action: "field.option.update",
			entityType: "field",
			entityId: field.id,
			summary: renamed
				? `Renamed option "${option.value}" to "${value}" in "${field.name}"`
				: `Updated option "${value}" in "${field.name}"`,
			changes: {
				from: { value: option.value, disabled: option.disabled },
				to: { value, disabled },
			},
		});
	});

	return {
		id: option.id,
		value,
		disabled,
		children: optionChildren(field, option.id).map((child) => ({
			id: child.id,
			value: child.value,
			disabled: child.disabled,
		})),
	};
}

export async function deleteCustomFieldOption(
	actor: CurrentUser,
	id: string,
	optionId: string,
	query: z.infer<typeof migrateQuery>,
): Promise<void> {
	requireAdminActor(actor);
	const field = await loadLoadedField(id);
	if (!field) {
		const row = await loadFieldRow(id);
		if (!row) throw new HttpError(404, "Field not found");
		throw new HttpError(
			409,
			`"${row.name}" is a system field and cannot be changed`,
			{ details: { count: 0, canMigrate: false } },
		);
	}
	const option = field.options.find((item) => item.id === optionId);
	if (!option) throw new HttpError(404, "Option not found");

	const children = optionChildren(field, option.id);
	const optionIds = new Set([option.id, ...children.map((item) => item.id)]);
	const optionValues = new Set(
		[option.value, ...children.map((item) => item.value)].map((value) =>
			value.toLowerCase(),
		),
	);
	const siblings = siblingOptions(field, option.parentOptionId).filter(
		(item) => item.id !== option.id,
	);

	let target: LoadedOption | null = null;
	const migrateTo = query.migrateTo;
	if (migrateTo) {
		if (migrateTo === option.id) {
			throw new HttpError(400, "An option cannot be migrated to itself");
		}
		target =
			siblings.find((item) => item.id === migrateTo) ??
			field.options.find((item) => item.id === migrateTo) ??
			null;
		if (!target) throw new HttpError(404, "Target option not found");
		if (target.parentOptionId !== option.parentOptionId) {
			throw new HttpError(400, "The target option must be at the same level");
		}
	}

	const result = await db.transaction(async (tx) => {
		const stored = await lockStoredValues(tx, field);
		const using = stored.filter((issue) =>
			optionUsage(issue.custom[field.sourceId], optionIds, optionValues),
		);
		if (using.length > 0 && !target) {
			return {
				ok: false as const,
				reason: "count" as const,
				count: using.length,
			};
		}
		const plan = using.map((issue) => ({
			id: issue.id,
			...planOptionRemoval(field, issue.custom[field.sourceId], option, target),
		}));
		const missing = [...new Set(plan.flatMap((step) => step.missing))];
		if (missing.length > 0) {
			return { ok: false as const, reason: "missing" as const, missing };
		}

		for (const step of plan) {
			const issue = using.find((item) => item.id === step.id);
			if (!issue) continue;
			const custom = {
				...issue.custom,
				[field.sourceId]: step.value,
			};
			await tx.update(issues).set({ custom }).where(eq(issues.id, step.id));
		}

		await tx.delete(fieldOptions).where(eq(fieldOptions.id, option.id));
		await audit(tx, actor, {
			action: "field.option.delete",
			entityType: "field",
			entityId: field.id,
			summary: `Deleted option "${option.value}" from "${field.name}"`,
			changes: {
				from: { value: option.value, count: using.length },
				to: target ? { value: target.value } : null,
			},
		});
		return { ok: true as const };
	});

	if (!result.ok) {
		if (result.reason === "count") {
			throw new HttpError(
				409,
				`The option "${option.value}" is used by ${result.count} issue${result.count === 1 ? "" : "s"}`,
				{
					details: {
						count: result.count,
						canMigrate: siblings.length > 0,
					},
				},
			);
		}
		throw new HttpError(
			400,
			`The target option has no child ${result.missing.map((value) => `"${value}"`).join(", ")}`,
		);
	}
}

export async function reorderCustomFieldOptions(
	actor: CurrentUser,
	id: string,
	body: ReorderOptionsInput,
) {
	requireAdminActor(actor);
	const field = await loadLoadedField(id);
	if (!field) {
		const row = await loadFieldRow(id);
		if (!row) throw new HttpError(404, "Field not found");
		throw new HttpError(
			409,
			`"${row.name}" is a system field and cannot be changed`,
		);
	}
	const parentOptionId = body.parentOptionId ?? null;
	if (parentOptionId) {
		const parent = field.options.find((option) => option.id === parentOptionId);
		if (!parent) throw new HttpError(400, "Unknown parent option");
	}
	const siblings = siblingOptions(field, parentOptionId);
	const ids = body.ids;
	const unique = new Set(ids);
	if (
		ids.length !== siblings.length ||
		unique.size !== siblings.length ||
		siblings.some((option) => !unique.has(option.id))
	) {
		throw new HttpError(
			400,
			"The ids must list exactly the options of this parent",
		);
	}

	await db.transaction(async (tx) => {
		for (const [sequence, id] of ids.entries()) {
			await tx
				.update(fieldOptions)
				.set({ sequence, updatedAt: new Date() })
				.where(eq(fieldOptions.id, id));
		}
		await audit(tx, actor, {
			action: "field.option.reorder",
			entityType: "field",
			entityId: field.id,
			summary: `Reordered options of "${field.name}"`,
			changes: {
				from: {
					order: siblings
						.sort((a, b) => a.sequence - b.sequence)
						.map((option) => option.value),
				},
				to: {
					order: ids.map(
						(id) => field.options.find((option) => option.id === id)?.value,
					),
				},
			},
		});
	});

	const order = new Map(ids.map((id, index) => [id, index]));
	return siblingOptions(field, parentOptionId)
		.sort(
			(a, b) =>
				(order.get(a.id) ?? a.sequence) - (order.get(b.id) ?? b.sequence),
		)
		.map((option) => optionWithChildren(field, option));
}

export async function setCustomFieldContexts(
	actor: CurrentUser,
	id: string,
	body: ContextsInput,
) {
	requireAdminActor(actor);
	const row = await loadFieldRow(id);
	if (!row) throw new HttpError(404, "Field not found");
	const type = adminTypeForField(row);
	if (!type) {
		throw new HttpError(
			409,
			`"${row.name}" is a system field and cannot be changed`,
		);
	}

	const pairs = new Map<
		string,
		{ projectId: string | null; issueTypeId: string | null }
	>();
	for (const context of body.contexts) {
		const projectId = context.projectId ?? null;
		const issueTypeId = context.issueTypeId ?? null;
		pairs.set(`${projectId}|${issueTypeId}`, { projectId, issueTypeId });
	}
	const projectIds = [
		...new Set(
			[...pairs.values()]
				.map((pair) => pair.projectId)
				.filter((id): id is string => id !== null),
		),
	];
	const issueTypeIds = [
		...new Set(
			[...pairs.values()]
				.map((pair) => pair.issueTypeId)
				.filter((id): id is string => id !== null),
		),
	];

	const projectRows =
		projectIds.length === 0
			? []
			: await db
					.select({ id: projects.id, name: projects.name })
					.from(projects)
					.where(inArray(projects.id, projectIds));
	const projectNames = new Map(
		projectRows.map((project) => [project.id, project.name]),
	);
	for (const id of projectIds) {
		if (!projectNames.has(id)) throw new HttpError(400, "Unknown project");
	}
	const typeRows =
		issueTypeIds.length === 0
			? []
			: await db
					.select({ id: issueTypes.id, name: issueTypes.name })
					.from(issueTypes)
					.where(inArray(issueTypes.id, issueTypeIds));
	const typeNames = new Map(
		typeRows.map((issueType) => [issueType.id, issueType.name]),
	);
	for (const id of issueTypeIds) {
		if (!typeNames.has(id)) throw new HttpError(400, "Unknown issue type");
	}

	const labels = [...pairs.values()].map((pair) => {
		const project = pair.projectId
			? { name: projectNames.get(pair.projectId) as string }
			: null;
		const issueType = pair.issueTypeId
			? { name: typeNames.get(pair.issueTypeId) as string }
			: null;
		return contextLabel({ project, issueType });
	});
	const previous = (await contextMap([row.id])).get(row.id) ?? [];

	await db.transaction(async (tx) => {
		await tx.delete(fieldContexts).where(eq(fieldContexts.fieldId, row.id));
		if (pairs.size > 0) {
			await tx.insert(fieldContexts).values(
				[...pairs.values()].map((pair) => ({
					fieldId: row.id,
					projectId: pair.projectId,
					issueTypeId: pair.issueTypeId,
				})),
			);
		}
		await audit(tx, actor, {
			action: "field.contexts.update",
			entityType: "field",
			entityId: row.id,
			summary: `Set contexts of "${row.name}": ${labels.length === 0 ? "none" : labels.join(", ")}`,
			changes: {
				from: { contexts: previous.map(contextLabel) },
				to: { contexts: labels },
			},
		});
	});

	return (await contextMap([row.id])).get(row.id) ?? [];
}
