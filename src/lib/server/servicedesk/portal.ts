import { randomUUID } from "node:crypto";
import { and, asc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import type { CurrentUser } from "../auth.ts";
import {
	adminTypeForField,
	type CustomFieldUser,
	type LoadedField,
	loadOptionRows,
	toLoadedField,
	validateCustomValue,
} from "../custom-fields.ts";
import { db } from "../db.ts";
import { htmlToText, sanitizeBodyHtml } from "../html.ts";
import {
	attachments,
	comments,
	components,
	fieldOptions,
	fields,
	issueComponents,
	issues,
	issueTypes,
	priorities,
	projectIssueTypes,
	projects,
	requestTypeFields,
	requestTypeGroupMembers,
	requestTypeGroups,
	requestTypes,
	statuses,
	users,
} from "../schema.ts";
import { initialStatusFor, workflowForIssueType } from "../workflows.ts";
import { canViewRequest, type Desk, participatingIssueIds } from "./access.ts";
import { applyCreateAutomation } from "./automation.ts";
import { recomputeIssueSla } from "./recompute.ts";
import { customText } from "./values.ts";

export interface PortalRequestType {
	id: string;
	name: string;
	description: string | null;
	helpText: string | null;
	iconName: string | null;
}

export interface PortalGroup {
	id: string;
	name: string;
	requestTypes: PortalRequestType[];
}

export type FieldKind =
	| "text"
	| "rich"
	| "date"
	| "datetime"
	| "option"
	| "components"
	| "priority"
	| "attachment"
	| "array";

export interface FormOption {
	id: string;
	label: string;
}

export type ArrayKind = "multiselect" | "multiuser" | "labels" | "text";

export interface FormField {
	fieldId: string;
	label: string;
	description: string | null;
	required: boolean;
	sequence: number;
	hidden: boolean;
	kind: FieldKind;
	/** Which `array` shape the field has; page-only, the REST schema strips it. */
	arrayKind?: ArrayKind;
	options: FormOption[];
}

export interface FormResponse {
	requestType: PortalRequestType & { portalId: string; projectKey: string };
	fields: FormField[];
}

export async function portalGroups(desk: Desk): Promise<PortalGroup[]> {
	const [groupRows, memberRows] = await Promise.all([
		db
			.select()
			.from(requestTypeGroups)
			.where(eq(requestTypeGroups.deskId, desk.id))
			.orderBy(asc(requestTypeGroups.sequence), asc(requestTypeGroups.name)),
		db
			.select({
				groupId: requestTypeGroupMembers.groupId,
				memberSequence: requestTypeGroupMembers.sequence,
				id: requestTypes.id,
				name: requestTypes.name,
				description: requestTypes.description,
				helpText: requestTypes.helpText,
				iconName: requestTypes.iconName,
				sequence: requestTypes.sequence,
			})
			.from(requestTypeGroupMembers)
			.innerJoin(
				requestTypes,
				eq(requestTypes.id, requestTypeGroupMembers.requestTypeId),
			)
			.where(eq(requestTypes.deskId, desk.id))
			.orderBy(
				asc(requestTypeGroupMembers.sequence),
				asc(requestTypes.sequence),
			),
	]);

	return groupRows.map((group) => ({
		id: group.id,
		name: group.name,
		requestTypes: memberRows
			.filter((member) => member.groupId === group.id)
			.sort(
				(left, right) =>
					left.memberSequence - right.memberSequence ||
					left.sequence - right.sequence,
			)
			.map((member) => ({
				id: member.id,
				name: member.name,
				description: member.description,
				helpText: member.helpText,
				iconName: member.iconName,
			})),
	}));
}

async function loadRequestType(desk: Desk, requestTypeId: string) {
	const [row] = await db
		.select()
		.from(requestTypes)
		.where(
			and(eq(requestTypes.deskId, desk.id), eq(requestTypes.id, requestTypeId)),
		)
		.limit(1);
	return row ?? null;
}

const builtinFieldIds = new Set([
	"summary",
	"description",
	"attachment",
	"duedate",
	"priority",
	"components",
]);

function arrayKindFor(field: {
	sourceId: string;
	customKey: string | null;
	type: string | null;
}): ArrayKind {
	const type = adminTypeForField(field);
	if (type === "multiselect" || type === "multiuser" || type === "labels") {
		return type;
	}
	return "text";
}

function fieldKind(fieldId: string, type: string | null): FieldKind {
	if (fieldId === "summary") return "text";
	if (fieldId === "description") return "rich";
	if (fieldId === "attachment") return "attachment";
	if (fieldId === "duedate") return "date";
	if (fieldId === "priority") return "priority";
	if (fieldId === "components") return "components";
	if (type === "datetime") return "datetime";
	if (type === "option") return "option";
	if (type === "array") return "array";
	return "text";
}

export async function requestTypeForm(
	desk: Desk,
	requestTypeId: string,
): Promise<FormResponse | null> {
	const requestType = await loadRequestType(desk, requestTypeId);
	if (!requestType) return null;

	const rows = await db
		.select()
		.from(requestTypeFields)
		.where(eq(requestTypeFields.requestTypeId, requestType.id))
		.orderBy(asc(requestTypeFields.sequence));

	const customIds = rows
		.map((row) => row.fieldId)
		.filter((id) => !builtinFieldIds.has(id));
	const [fieldRows, optionRows, componentRows, priorityRows] =
		await Promise.all([
			customIds.length === 0
				? []
				: db
						.select({
							id: fields.id,
							sourceId: fields.sourceId,
							name: fields.name,
							customKey: fields.customKey,
							type: fields.type,
						})
						.from(fields)
						.where(inArray(fields.sourceId, customIds)),
			customIds.length === 0
				? []
				: db
						.select({
							fieldId: fieldOptions.fieldId,
							value: fieldOptions.value,
						})
						.from(fieldOptions)
						.innerJoin(fields, eq(fields.id, fieldOptions.fieldId))
						.where(inArray(fields.sourceId, customIds))
						.orderBy(asc(fieldOptions.sequence), asc(fieldOptions.value)),
			db
				.select({ id: components.id, name: components.name })
				.from(components)
				.where(eq(components.projectId, desk.projectId))
				.orderBy(asc(components.name)),
			db
				.select({ id: priorities.id, name: priorities.name })
				.from(priorities)
				.orderBy(asc(priorities.sequence), asc(priorities.name)),
		]);
	const fieldBySource = new Map(fieldRows.map((row) => [row.sourceId, row]));
	const fieldIds = new Map(fieldRows.map((row) => [row.sourceId, row.id]));

	const formFields = rows.map((row) => {
		const fieldRowId = fieldIds.get(row.fieldId);
		const fieldRow = fieldBySource.get(row.fieldId);
		const kind = fieldKind(row.fieldId, fieldRow?.type ?? null);
		const hidden = row.hiddenValue !== null && row.hiddenValue !== undefined;
		const arrayKind =
			kind === "array" && fieldRow ? arrayKindFor(fieldRow) : undefined;
		let options: FormOption[] = [];
		if (hidden) {
			options = [];
		} else if (kind === "option" && fieldRowId) {
			options = optionRows
				.filter((option) => option.fieldId === fieldRowId)
				.map((option) => ({ id: option.value, label: option.value }));
		} else if (kind === "components") {
			options = componentRows.map((component) => ({
				id: component.id,
				label: component.name,
			}));
		} else if (kind === "priority") {
			options = priorityRows.map((priority) => ({
				id: priority.id,
				label: priority.name,
			}));
		} else if (kind === "array" && arrayKind === "multiselect" && fieldRowId) {
			options = optionRows
				.filter((option) => option.fieldId === fieldRowId)
				.map((option) => ({ id: option.value, label: option.value }));
		}
		return {
			fieldId: row.fieldId,
			label: row.label,
			description: row.description,
			required: row.required,
			sequence: row.sequence,
			hidden,
			kind,
			arrayKind,
			options,
		};
	});

	// Only a visible multiuser field needs the staff picker, and it exposes ids,
	// not login names.
	const needsUsers = formFields.some(
		(field) => !field.hidden && field.arrayKind === "multiuser",
	);
	const userRows = needsUsers
		? await db
				.select({ id: users.id, displayName: users.displayName })
				.from(users)
				.where(eq(users.active, true))
				.orderBy(sql`lower(${users.displayName})`)
				.limit(100)
		: [];
	if (userRows.length > 0) {
		for (const field of formFields) {
			if (field.hidden || field.arrayKind !== "multiuser") continue;
			field.options = userRows.map((user) => ({
				id: user.id,
				label: user.displayName,
			}));
		}
	}

	return {
		requestType: {
			id: requestType.id,
			name: requestType.name,
			description: requestType.description,
			helpText: requestType.helpText,
			iconName: requestType.iconName,
			portalId: desk.id,
			projectKey: desk.projectKey,
		},
		fields: formFields,
	};
}

export interface CreateRequestInput {
	summary: string;
	description: string | null;
	fields: Record<string, string | string[] | null>;
	/** The portal page's staged files; omitted by the REST create endpoint. */
	attachmentCount?: number;
	/** The portal is the default; the Messenger worker marks chat requests. */
	channel?: "portal" | "chat";
}

export type CreateRequestResult =
	| { ok: true; id: string; key: string }
	| { ok: false; status: 400 | 404; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
	return UUID.test(value);
}

function text(value: string | string[] | null | undefined): string | null {
	if (Array.isArray(value)) return value.join(", ");
	const trimmed = value?.trim() ?? "";
	return trimmed === "" ? null : trimmed;
}

function list(value: string | string[] | null | undefined): string[] {
	if (Array.isArray(value))
		return value.map((item) => item.trim()).filter(Boolean);
	const single = text(value);
	return single === null ? [] : [single];
}

async function issueTypeFor(desk: Desk, requestTypeIssueTypeId: string | null) {
	if (requestTypeIssueTypeId) {
		const workflow = await workflowForIssueType(
			desk.projectId,
			requestTypeIssueTypeId,
		);
		if (workflow) return { typeId: requestTypeIssueTypeId, workflow };
	}
	const rows = await db
		.select({ id: issueTypes.id, name: issueTypes.name })
		.from(projectIssueTypes)
		.innerJoin(issueTypes, eq(issueTypes.id, projectIssueTypes.issueTypeId))
		.where(
			and(
				eq(projectIssueTypes.projectId, desk.projectId),
				eq(issueTypes.subtask, false),
			),
		)
		.orderBy(asc(issueTypes.name));
	for (const row of rows) {
		const workflow = await workflowForIssueType(desk.projectId, row.id);
		if (workflow) return { typeId: row.id, workflow };
	}
	return null;
}

export async function createRequest(
	desk: Desk,
	requestTypeId: string,
	user: CurrentUser,
	input: CreateRequestInput,
): Promise<CreateRequestResult> {
	const requestType = await loadRequestType(desk, requestTypeId);
	if (!requestType) {
		return { ok: false, status: 404, error: "Request type not found" };
	}

	const rows = await db
		.select()
		.from(requestTypeFields)
		.where(eq(requestTypeFields.requestTypeId, requestType.id))
		.orderBy(asc(requestTypeFields.sequence));
	const customIds = rows
		.map((row) => row.fieldId)
		.filter((id) => !builtinFieldIds.has(id));
	const fieldRows =
		customIds.length === 0
			? []
			: await db
					.select()
					.from(fields)
					.where(inArray(fields.sourceId, customIds));
	const fieldBySource = new Map(fieldRows.map((row) => [row.sourceId, row]));
	const typeBySource = new Map(
		fieldRows.map((row) => [row.sourceId, row.type]),
	);
	const arrayFields = new Map<string, LoadedField>();
	if (fieldRows.length > 0) {
		const optionRows = await loadOptionRows(fieldRows.map((row) => row.id));
		for (const row of fieldRows) {
			const adminType = adminTypeForField(row);
			if (!adminType) continue;
			arrayFields.set(
				row.sourceId,
				toLoadedField(row, adminType, optionRows.get(row.id) ?? []),
			);
		}
	}
	const needsUsers = [...arrayFields.values()].some(
		(field) => field.type === "multiuser" || field.type === "user",
	);
	const fieldUsers: CustomFieldUser[] = needsUsers
		? await db
				.select({
					id: users.id,
					username: users.username,
					displayName: users.displayName,
				})
				.from(users)
				.where(eq(users.active, true))
		: [];

	const known = new Set(rows.map((row) => row.fieldId));
	for (const fieldId of Object.keys(input.fields)) {
		if (!known.has(fieldId)) {
			return { ok: false, status: 400, error: `Unknown field ${fieldId}` };
		}
	}

	// Hidden fields carry their preset value; the customer cannot set them.
	const values: Record<string, string | string[] | null> = {
		...input.fields,
	};
	if (input.description !== null && values.description === undefined) {
		values.description = input.description;
	}
	for (const row of rows) {
		if (row.hiddenValue === null || row.hiddenValue === undefined) continue;
		const preset = row.hiddenValue;
		if (typeof preset === "string") values[row.fieldId] = preset;
		else if (Array.isArray(preset)) {
			values[row.fieldId] = preset.map((item) => customText(item));
		} else {
			values[row.fieldId] = customText(preset);
		}
	}

	let summary = text(values.summary) ?? input.summary.trim();
	let descriptionHtml: string | null = null;
	let dueDate: string | null = null;
	let priorityId: string | null = null;
	const componentIds: string[] = [];
	const custom: Record<string, unknown> = {};

	for (const row of rows) {
		const value = values[row.fieldId];
		const kind = fieldKind(row.fieldId, typeBySource.get(row.fieldId) ?? null);
		const required =
			row.required &&
			(row.hiddenValue === null || row.hiddenValue === undefined);

		if (kind === "attachment") {
			// The REST create endpoint has no files to count; the portal action does.
			if (
				required &&
				input.attachmentCount !== undefined &&
				input.attachmentCount === 0
			) {
				return { ok: false, status: 400, error: `${row.label} is required` };
			}
			continue;
		}
		if (kind === "priority") {
			const wanted = text(value);
			if (wanted === null) {
				if (required) {
					return {
						ok: false,
						status: 400,
						error: `${row.label} is required`,
					};
				}
				continue;
			}
			const [priority] = await db
				.select({ id: priorities.id })
				.from(priorities)
				.where(
					isUuid(wanted)
						? or(eq(priorities.id, wanted), eq(priorities.name, wanted))
						: eq(priorities.name, wanted),
				)
				.limit(1);
			if (!priority) {
				return { ok: false, status: 400, error: `Unknown ${row.label}` };
			}
			priorityId = priority.id;
			continue;
		}
		if (kind === "components") {
			const wanted = list(value);
			if (wanted.length === 0 && required) {
				return { ok: false, status: 400, error: `${row.label} is required` };
			}
			if (wanted.length > 0) {
				const ids = wanted.filter(isUuid);
				if (ids.length !== wanted.length) {
					return { ok: false, status: 400, error: `Unknown ${row.label}` };
				}
				const found = await db
					.select({ id: components.id, name: components.name })
					.from(components)
					.where(
						and(
							eq(components.projectId, desk.projectId),
							inArray(components.id, ids),
						),
					);
				if (found.length !== new Set(wanted).size) {
					return { ok: false, status: 400, error: `Unknown ${row.label}` };
				}
				componentIds.push(...found.map((component) => component.id));
			}
			continue;
		}

		if (row.fieldId === "summary") {
			summary = text(value) ?? summary;
			if (summary === "") {
				return { ok: false, status: 400, error: `${row.label} is required` };
			}
			continue;
		}
		if (row.fieldId === "description") {
			descriptionHtml = await sanitizeBodyHtml(text(value));
			if (descriptionHtml === null && required) {
				return { ok: false, status: 400, error: `${row.label} is required` };
			}
			continue;
		}
		if (row.fieldId === "duedate") {
			const wanted = text(value);
			if (wanted === null) {
				if (required) {
					return { ok: false, status: 400, error: `${row.label} is required` };
				}
				continue;
			}
			if (!/^\d{4}-\d{2}-\d{2}$/.test(wanted)) {
				return {
					ok: false,
					status: 400,
					error: `${row.label} must be a date`,
				};
			}
			dueDate = wanted;
			continue;
		}

		if (kind === "array") {
			const customFieldRow = fieldBySource.get(row.fieldId);
			const arrayKind = customFieldRow ? arrayKindFor(customFieldRow) : "text";
			const wanted =
				arrayKind === "labels"
					? list(value)
							.flatMap((item) => item.split(/[\s,]+/))
							.filter(Boolean)
					: list(value);
			if (wanted.length === 0 && required) {
				return { ok: false, status: 400, error: `${row.label} is required` };
			}
			if (wanted.length === 0) continue;
			const field = arrayFields.get(row.fieldId);
			if (!field) {
				custom[row.fieldId] = wanted;
				continue;
			}
			const validated = validateCustomValue(field, wanted, {
				users: fieldUsers,
			});
			if (!validated.ok) {
				return {
					ok: false,
					status: 400,
					error: `${row.label}: ${validated.error}`,
				};
			}
			if (validated.value !== null) custom[row.fieldId] = validated.value;
			continue;
		}
		if (kind === "datetime") {
			const wanted = text(value);
			if (wanted === null) {
				if (required) {
					return { ok: false, status: 400, error: `${row.label} is required` };
				}
				continue;
			}
			const date = new Date(wanted);
			if (Number.isNaN(date.getTime())) {
				return {
					ok: false,
					status: 400,
					error: `${row.label} must be a date and time`,
				};
			}
			custom[row.fieldId] = date.toISOString();
			continue;
		}

		const wanted = text(value);
		if (wanted === null) {
			if (required) {
				return { ok: false, status: 400, error: `${row.label} is required` };
			}
			continue;
		}
		if (kind === "option") {
			const options = await db
				.select({ value: fieldOptions.value })
				.from(fieldOptions)
				.innerJoin(fields, eq(fields.id, fieldOptions.fieldId))
				.where(eq(fields.sourceId, row.fieldId));
			if (
				options.length > 0 &&
				!options.some((option) => option.value === wanted)
			) {
				return { ok: false, status: 400, error: `Unknown ${row.label}` };
			}
			custom[row.fieldId] = { value: wanted };
			continue;
		}
		const field = arrayFields.get(row.fieldId);
		if (!field) {
			custom[row.fieldId] = wanted;
			continue;
		}
		const validated = validateCustomValue(field, wanted, {
			users: fieldUsers,
		});
		if (!validated.ok) {
			return {
				ok: false,
				status: 400,
				error: `${row.label}: ${validated.error}`,
			};
		}
		if (validated.value !== null) custom[row.fieldId] = validated.value;
	}

	if (summary === "") {
		return { ok: false, status: 400, error: "Summary is required" };
	}

	const type = await issueTypeFor(desk, requestType.issueTypeId);
	if (!type) {
		return {
			ok: false,
			status: 400,
			error: "This request type has no issue type in the project",
		};
	}
	const status = await initialStatusFor(type.workflow.id);
	if (!status) {
		return { ok: false, status: 400, error: "The workflow has no status" };
	}

	const created = await db.transaction(async (tx) => {
		const [locked] = await tx
			.select({ lastIssueNumber: projects.lastIssueNumber })
			.from(projects)
			.where(eq(projects.id, desk.projectId))
			.for("update");
		if (!locked) return null;

		const number = locked.lastIssueNumber + 1;
		await tx
			.update(projects)
			.set({ lastIssueNumber: number, updatedAt: new Date() })
			.where(eq(projects.id, desk.projectId));

		const now = new Date();
		const [issue] = await tx
			.insert(issues)
			.values({
				sourceId: `local:${randomUUID()}`,
				projectId: desk.projectId,
				number,
				key: `${desk.projectKey}-${number}`,
				typeId: type.typeId,
				statusId: status.id,
				priorityId,
				resolutionId: null,
				requestTypeId: requestType.id,
				requestChannel: input.channel ?? "portal",
				summary,
				descriptionHtml,
				descriptionSource: htmlToText(descriptionHtml) || null,
				reporterId: user.id,
				assigneeId: null,
				creatorId: user.id,
				parentId: null,
				epicId: null,
				storyPoints: null,
				originalEstimate: null,
				remainingEstimate: null,
				timeSpent: null,
				dueDate,
				created: now,
				updated: now,
				resolved: null,
				custom,
			})
			.returning({ id: issues.id, key: issues.key });

		if (componentIds.length > 0) {
			await tx.insert(issueComponents).values(
				[...new Set(componentIds)].map((componentId) => ({
					sourceId: null,
					issueId: issue.id,
					componentId,
				})),
			);
		}
		return issue;
	});

	if (!created) {
		return { ok: false, status: 404, error: "Project not found" };
	}

	await applyCreateAutomation(created.id);
	await recomputeIssueSla(created.id);
	return { ok: true, id: created.id, key: created.key };
}

type StatusCategory = "new" | "indeterminate" | "done";

export interface MyRequest {
	key: string;
	summary: string;
	status: { name: string; category: StatusCategory };
	reporter: { displayName: string } | null;
	requestType: string | null;
	portalId: string;
	created: string | null;
}

export interface MyRequestFilters {
	status: "open" | "closed" | "all";
	scope: "created" | "participating" | "all";
	query: string;
	/** Count only this portal's requests; omitted for the user's global list. */
	deskId?: string;
}

export async function myRequests(
	user: CurrentUser,
	filters: MyRequestFilters,
): Promise<MyRequest[]> {
	const participating = await participatingIssueIds(user.id);
	const scope =
		filters.scope === "created"
			? eq(issues.reporterId, user.id)
			: filters.scope === "participating"
				? participating.length === 0
					? sql`false`
					: inArray(issues.id, participating)
				: participating.length === 0
					? eq(issues.reporterId, user.id)
					: or(
							eq(issues.reporterId, user.id),
							inArray(issues.id, participating),
						);

	const conditions = [sql`${issues.requestTypeId} is not null`, scope];
	if (filters.deskId) conditions.push(eq(requestTypes.deskId, filters.deskId));
	if (filters.status !== "all") {
		conditions.push(
			filters.status === "open"
				? ne(statuses.category, "done")
				: eq(statuses.category, "done"),
		);
	}
	if (filters.query.trim() !== "") {
		const pattern = `%${filters.query.trim().replace(/[%_\\]/g, "\\$&")}%`;
		conditions.push(
			or(ilike(issues.summary, pattern), ilike(issues.key, pattern)),
		);
	}

	const rows = await db
		.select({
			key: issues.key,
			summary: issues.summary,
			created: issues.created,
			statusName: statuses.name,
			statusCategory: statuses.category,
			reporterName: users.displayName,
			requestTypeName: requestTypes.name,
			portalId: requestTypes.deskId,
		})
		.from(issues)
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.innerJoin(requestTypes, eq(requestTypes.id, issues.requestTypeId))
		.leftJoin(users, eq(users.id, issues.reporterId))
		.where(and(...conditions))
		.orderBy(sql`${issues.created} desc nulls last`, asc(issues.key));

	return rows.map((row) => ({
		key: row.key,
		summary: row.summary,
		status: {
			name: row.statusName,
			category: row.statusCategory as StatusCategory,
		},
		reporter: row.reporterName ? { displayName: row.reporterName } : null,
		requestType: row.requestTypeName,
		portalId: row.portalId,
		created: row.created?.toISOString() ?? null,
	}));
}

export interface CustomerRequestView {
	key: string;
	summary: string;
	descriptionHtml: string | null;
	status: { name: string; category: StatusCategory };
	requestType: { id: string; name: string } | null;
	created: string | null;
	reporter: { displayName: string } | null;
	attachments: { id: string; fileName: string; size: number }[];
	comments: {
		id: string;
		author: string | null;
		bodyHtml: string | null;
		created: string | null;
	}[];
}

export async function customerRequest(
	desk: Desk,
	key: string,
	user: CurrentUser,
): Promise<CustomerRequestView | null> {
	const [issue] = await db
		.select({
			id: issues.id,
			key: issues.key,
			projectId: issues.projectId,
			summary: issues.summary,
			descriptionHtml: issues.descriptionHtml,
			created: issues.created,
			reporterId: issues.reporterId,
			creatorId: issues.creatorId,
			statusName: statuses.name,
			statusCategory: statuses.category,
			requestTypeId: requestTypes.id,
			requestTypeName: requestTypes.name,
			reporterName: users.displayName,
		})
		.from(issues)
		.innerJoin(statuses, eq(statuses.id, issues.statusId))
		.innerJoin(requestTypes, eq(requestTypes.id, issues.requestTypeId))
		.leftJoin(users, eq(users.id, issues.reporterId))
		.where(
			and(eq(issues.key, key.toUpperCase()), eq(requestTypes.deskId, desk.id)),
		)
		.limit(1);
	if (!issue || issue.projectId !== desk.projectId) return null;
	if (!(await canViewRequest(user, desk, issue))) return null;

	const [attachmentRows, commentRows] = await Promise.all([
		db
			.select({
				id: attachments.id,
				fileName: attachments.fileName,
				size: attachments.size,
			})
			.from(attachments)
			.where(eq(attachments.issueId, issue.id))
			.orderBy(asc(attachments.created)),
		db
			.select({
				id: comments.id,
				author: users.displayName,
				bodyHtml: comments.bodyHtml,
				created: comments.created,
			})
			.from(comments)
			.leftJoin(users, eq(users.id, comments.authorId))
			.where(and(eq(comments.issueId, issue.id), eq(comments.internal, false)))
			.orderBy(asc(comments.created), asc(comments.id)),
	]);

	return {
		key: issue.key,
		summary: issue.summary,
		descriptionHtml: issue.descriptionHtml,
		status: {
			name: issue.statusName,
			category: issue.statusCategory as StatusCategory,
		},
		requestType:
			issue.requestTypeId && issue.requestTypeName
				? { id: issue.requestTypeId, name: issue.requestTypeName }
				: null,
		created: issue.created?.toISOString() ?? null,
		reporter: issue.reporterName ? { displayName: issue.reporterName } : null,
		attachments: attachmentRows,
		comments: commentRows.map((row) => ({
			id: row.id,
			author: row.author,
			bodyHtml: row.bodyHtml,
			created: row.created?.toISOString() ?? null,
		})),
	};
}

export type CustomerCommentResult =
	| { ok: true; id: string }
	| { ok: false; status: 400 | 404; error: string };

/** A comment from the portal is always public; internal notes stay internal. */
export async function addCustomerComment(
	desk: Desk,
	key: string,
	user: CurrentUser,
	body: string,
): Promise<CustomerCommentResult> {
	const [issue] = await db
		.select({
			id: issues.id,
			projectId: issues.projectId,
			reporterId: issues.reporterId,
			creatorId: issues.creatorId,
			requestTypeId: issues.requestTypeId,
		})
		.from(issues)
		.innerJoin(requestTypes, eq(requestTypes.id, issues.requestTypeId))
		.where(
			and(eq(issues.key, key.toUpperCase()), eq(requestTypes.deskId, desk.id)),
		)
		.limit(1);
	if (!issue || issue.projectId !== desk.projectId) {
		return { ok: false, status: 404, error: "Request not found" };
	}
	if (!(await canViewRequest(user, desk, issue))) {
		return { ok: false, status: 404, error: "Request not found" };
	}

	const bodyHtml = await sanitizeBodyHtml(body);
	if (!bodyHtml) {
		return { ok: false, status: 400, error: "Comment body is empty" };
	}

	const now = new Date();
	const created = await db.transaction(async (tx) => {
		const [row] = await tx
			.insert(comments)
			.values({
				sourceId: `local:${randomUUID()}`,
				issueId: issue.id,
				authorId: user.id,
				bodyHtml,
				bodySource: htmlToText(bodyHtml) || null,
				created: now,
				updated: now,
				internal: false,
			})
			.returning({ id: comments.id });
		await tx
			.update(issues)
			.set({ updated: now })
			.where(eq(issues.id, issue.id));
		return row;
	});

	await recomputeIssueSla(issue.id);
	return { ok: true, id: created.id };
}
