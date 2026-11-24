import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
	type CustomFieldRole,
	customFieldRole,
} from "../shared/custom-field-roles.ts";
import { db } from "./db.ts";
import {
	fieldContexts,
	fieldOptions,
	fields,
	issues,
	users,
} from "./schema.ts";

/**
 * Custom fields.
 *
 * The configurable types are derived from `fields.custom_key` (the suffix after
 * `customfieldtypes:`), and every value lives in `issues.custom` keyed by
 * `fields.source_id` in the same JSON shapes the Jira importer stores.
 *
 * | admin type  | custom_key suffix | fields.type       | issues.custom[source_id]                     |
 * |-------------|-------------------|-------------------|----------------------------------------------|
 * | text        | textfield         | string            | string, max 255                              |
 * | paragraph   | textarea          | string            | string, max 32 000                           |
 * | number      | float             | number            | finite number                                |
 * | date        | datepicker        | date              | "YYYY-MM-DD"                                 |
 * | datetime    | datetime          | datetime          | ISO-8601 with offset (stored as UTC `Z`)     |
 * | select      | select            | option            | { value, id }                                |
 * | multiselect | multiselect       | array             | [ { value, id } ]                            |
 * | cascading   | cascadingselect   | option-with-child | { value, id, child?: { value, id } }         |
 * | user        | userpicker        | user              | { id, name, displayName }                    |
 * | multiuser   | multiuserpicker   | array             | [ { id, name, displayName } ]                |
 * | labels      | labels            | array             | [ "label" ]                                  |
 * | url         | url               | string            | string, http(s), max 2000                    |
 *
 * An empty value deletes the key; it is never stored as null or "".
 */

export const adminFieldTypes = [
	"text",
	"paragraph",
	"number",
	"date",
	"datetime",
	"select",
	"multiselect",
	"cascading",
	"user",
	"multiuser",
	"labels",
	"url",
] as const;

export type AdminFieldType = (typeof adminFieldTypes)[number];

export const adminFieldTypeSchema = z.enum(adminFieldTypes);

const suffixByAdminType: Record<AdminFieldType, string> = {
	text: "textfield",
	paragraph: "textarea",
	number: "float",
	date: "datepicker",
	datetime: "datetime",
	select: "select",
	multiselect: "multiselect",
	cascading: "cascadingselect",
	user: "userpicker",
	multiuser: "multiuserpicker",
	labels: "labels",
	url: "url",
};

const storedTypeByAdminType: Record<AdminFieldType, string> = {
	text: "string",
	paragraph: "string",
	number: "number",
	date: "date",
	datetime: "datetime",
	select: "option",
	multiselect: "array",
	cascading: "option-with-child",
	user: "user",
	multiuser: "array",
	labels: "array",
	url: "string",
};

const adminTypeBySuffix = new Map<string, AdminFieldType>(
	adminFieldTypes.map((type) => [suffixByAdminType[type], type]),
);

export const optionFieldTypes = new Set<AdminFieldType>([
	"select",
	"multiselect",
	"cascading",
]);

/**
 * Fields whose value is not in `issues.custom`: the columns the importer maps
 * (rank, epic link, story points), service desk internals and plugin fields.
 */
export const SYSTEM_FIELD_ROLES = new Set<CustomFieldRole>([
	"developmentSummary",
	"epicLink",
	"epicName",
	"epicStatus",
	"epicColour",
	"rank",
	"sprint",
	"storyPoints",
]);

export function customKeyForAdminType(type: AdminFieldType) {
	return `com.atlassian.jira.plugin.system.customfieldtypes:${suffixByAdminType[type]}`;
}

export function storedTypeForAdminType(type: AdminFieldType) {
	return storedTypeByAdminType[type];
}

export function adminTypeForField(field: {
	sourceId: string;
	name?: string | null;
	customKey: string | null;
	type: string | null;
}): AdminFieldType | null {
	const role = customFieldRole(field);
	if (role && SYSTEM_FIELD_ROLES.has(role)) return null;
	const suffix = field.customKey?.split(":").pop();
	if (!suffix) return null;
	const type = adminTypeBySuffix.get(suffix);
	if (!type) return null;
	return field.type === storedTypeByAdminType[type] ? type : null;
}

// --- response schemas ------------------------------------------------------

export const customFieldOptionChildSchema = z.object({
	id: z.uuid(),
	value: z.string(),
	disabled: z.boolean(),
});

export const customFieldOptionSchema = customFieldOptionChildSchema.extend({
	children: z.array(customFieldOptionChildSchema),
});

/** A field as an issue form sees it (also the public project route's item). */
export const customFieldDefinitionSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	type: adminFieldTypeSchema,
	required: z.boolean(),
	options: z.array(customFieldOptionSchema),
});

/** A field of the issue detail: definition plus the stored value (or null). */
export const editableCustomFieldSchema = customFieldDefinitionSchema.extend({
	value: z.unknown(),
});

export const customFieldProjectRefSchema = z.object({
	id: z.uuid(),
	key: z.string(),
	name: z.string(),
});

export const customFieldIssueTypeRefSchema = z.object({
	id: z.uuid(),
	name: z.string(),
});

export const customFieldContextSchema = z.object({
	id: z.uuid(),
	project: customFieldProjectRefSchema.nullable(),
	issueType: customFieldIssueTypeRefSchema.nullable(),
});

export const adminCustomFieldSummarySchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	type: adminFieldTypeSchema.nullable(),
	configurable: z.boolean(),
	required: z.boolean(),
	optionCount: z.number().int(),
	issueCount: z.number().int(),
	contexts: z.array(customFieldContextSchema),
});

export const adminCustomFieldDetailSchema =
	adminCustomFieldSummarySchema.extend({
		sourceId: z.string(),
		options: z.array(customFieldOptionSchema),
	});

// --- loading ---------------------------------------------------------------

export type LoadedOption = {
	id: string;
	value: string;
	parentOptionId: string | null;
	sequence: number;
	disabled: boolean;
};

export type LoadedField = {
	id: string;
	sourceId: string;
	name: string;
	description: string | null;
	type: AdminFieldType;
	required: boolean;
	options: LoadedOption[];
};

export type LoadedContext = {
	id: string;
	fieldId: string;
	projectId: string | null;
	issueTypeId: string | null;
};

type FieldRow = typeof fields.$inferSelect;

export function toLoadedField(
	row: FieldRow,
	type: AdminFieldType,
	options: LoadedOption[],
): LoadedField {
	return {
		id: row.id,
		sourceId: row.sourceId,
		name: row.name,
		description: row.description,
		type,
		required: row.required,
		options,
	};
}

export async function loadOptionRows(fieldIds: string[]) {
	const result = new Map<string, LoadedOption[]>();
	if (fieldIds.length === 0) return result;
	const rows = await db
		.select({
			id: fieldOptions.id,
			fieldId: fieldOptions.fieldId,
			value: fieldOptions.value,
			parentOptionId: fieldOptions.parentOptionId,
			sequence: fieldOptions.sequence,
			disabled: fieldOptions.disabled,
		})
		.from(fieldOptions)
		.where(inArray(fieldOptions.fieldId, fieldIds))
		.orderBy(asc(fieldOptions.sequence), asc(fieldOptions.value));
	for (const row of rows) {
		const list = result.get(row.fieldId) ?? [];
		list.push({
			id: row.id,
			value: row.value,
			parentOptionId: row.parentOptionId,
			sequence: row.sequence,
			disabled: row.disabled,
		});
		result.set(row.fieldId, list);
	}
	return result;
}

async function loadContextRows(fieldIds: string[]) {
	const result = new Map<string, LoadedContext[]>();
	if (fieldIds.length === 0) return result;
	const rows = await db
		.select({
			id: fieldContexts.id,
			fieldId: fieldContexts.fieldId,
			projectId: fieldContexts.projectId,
			issueTypeId: fieldContexts.issueTypeId,
		})
		.from(fieldContexts)
		.where(inArray(fieldContexts.fieldId, fieldIds));
	for (const row of rows) {
		const list = result.get(row.fieldId) ?? [];
		list.push(row);
		result.set(row.fieldId, list);
	}
	return result;
}

export function contextMatches(
	contexts: LoadedContext[],
	projectId: string,
	issueTypeId: string | null,
) {
	return contexts.some(
		(context) =>
			(context.projectId === null || context.projectId === projectId) &&
			(issueTypeId === null ||
				context.issueTypeId === null ||
				context.issueTypeId === issueTypeId),
	);
}

/** The configurable fields whose contexts match the project and issue type. */
export async function loadFieldsForContext(
	projectId: string,
	issueTypeId: string | null,
): Promise<LoadedField[]> {
	const rows = await db.select().from(fields);
	const candidates: { row: FieldRow; type: AdminFieldType }[] = [];
	for (const row of rows) {
		const type = adminTypeForField(row);
		if (type) candidates.push({ row, type });
	}
	if (candidates.length === 0) return [];
	const ids = candidates.map((candidate) => candidate.row.id);
	const [contexts, options] = await Promise.all([
		loadContextRows(ids),
		loadOptionRows(ids),
	]);
	return candidates
		.filter((candidate) =>
			contextMatches(
				contexts.get(candidate.row.id) ?? [],
				projectId,
				issueTypeId,
			),
		)
		.map((candidate) =>
			toLoadedField(
				candidate.row,
				candidate.type,
				options.get(candidate.row.id) ?? [],
			),
		)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export type OptionTreeItem = {
	id: string;
	value: string;
	disabled: boolean;
	children: { id: string; value: string; disabled: boolean }[];
};

/** One level of nesting, as Jira's cascading select has. */
export function optionTree(
	options: LoadedOption[],
	includeDisabled: boolean,
	selected: Set<string> = new Set(),
): OptionTreeItem[] {
	const visible = (option: LoadedOption) =>
		includeDisabled ||
		!option.disabled ||
		selected.has(option.id) ||
		selected.has(option.value.toLowerCase());
	return options
		.filter((option) => option.parentOptionId === null)
		.filter(visible)
		.map((option) => ({
			id: option.id,
			value: option.value,
			disabled: option.disabled,
			children: options
				.filter((child) => child.parentOptionId === option.id)
				.filter(visible)
				.map((child) => ({
					id: child.id,
					value: child.value,
					disabled: child.disabled,
				})),
		}));
}

// --- stored value helpers --------------------------------------------------

type StoredObject = Record<string, unknown>;

function asObject(value: unknown): StoredObject | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	return value as StoredObject;
}

function stringField(object: StoredObject, key: string) {
	const value = object[key];
	return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Plain text of any stored value, tolerating the shapes Jira imports. */
export function customValueText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value
			.map((item) => customValueText(item))
			.filter((item) => item !== "")
			.join(", ");
	}
	const object = asObject(value);
	if (!object) return "";
	const displayName = stringField(object, "displayName");
	if (displayName) return displayName;
	const name = stringField(object, "name");
	if (name) return name;
	const text = stringField(object, "value");
	if (!text) return "";
	const child = object.child ? customValueText(object.child) : "";
	return child === "" ? text : `${text} / ${child}`;
}

function labelsText(value: unknown) {
	return Array.isArray(value)
		? value.map(String).join(" ")
		: customValueText(value);
}

/** The value as it is written to `issue_history_items.from_value`/`to_value`. */
export function customValueRaw(
	field: LoadedField,
	value: unknown,
): string | null {
	const object = asObject(value);
	if (field.type === "select") {
		if (!object) return customValueText(value) || null;
		return stringField(object, "id") ?? stringField(object, "value");
	}
	if (field.type === "cascading") {
		if (!object) return customValueText(value) || null;
		const parent = stringField(object, "id") ?? stringField(object, "value");
		const child = asObject(object.child);
		const childId = child
			? (stringField(child, "id") ?? stringField(child, "value"))
			: null;
		if (!parent) return childId;
		return childId ? `${parent}/${childId}` : parent;
	}
	if (field.type === "user") {
		if (!object) return customValueText(value) || null;
		return stringField(object, "id") ?? stringField(object, "name");
	}
	if (field.type === "multiselect" || field.type === "multiuser") {
		if (!Array.isArray(value)) return null;
		const parts = value
			.map((item) => {
				const entry = asObject(item);
				if (!entry) return String(item);
				return (
					stringField(entry, "id") ??
					stringField(entry, "name") ??
					stringField(entry, "value")
				);
			})
			.filter((item): item is string => item !== null);
		return parts.length === 0 ? null : parts.join(",");
	}
	if (field.type === "labels") return null;
	const text = customValueText(value);
	return text === "" ? null : text;
}

/** The value as it is written to `issue_history_items.from_string`/`to_string`. */
export function customValueHistoryText(
	field: LoadedField,
	value: unknown,
): string | null {
	const text =
		field.type === "labels" ? labelsText(value) : customValueText(value);
	return text === "" ? null : text;
}

type OptionRef = { id: string | null; value: string | null };

function optionRefOf(raw: unknown): OptionRef | null {
	if (typeof raw === "string") {
		const value = raw.trim();
		return value === "" ? null : { id: null, value };
	}
	const object = asObject(raw);
	if (!object) return null;
	const id = stringField(object, "id");
	const value = stringField(object, "value");
	if (!id && !value) return null;
	return { id, value };
}

function storedRefs(value: unknown): OptionRef[] {
	if (Array.isArray(value)) return value.flatMap((item) => storedRefs(item));
	if (typeof value === "string") {
		const text = value.trim();
		return text === "" ? [] : [{ id: null, value: text }];
	}
	const object = asObject(value);
	if (!object) return [];
	const refs: OptionRef[] = [];
	const id = stringField(object, "id");
	const text = stringField(object, "value");
	if (id || text) refs.push({ id, value: text });
	if (object.child) refs.push(...storedRefs(object.child));
	return refs;
}

function findOption(
	options: LoadedOption[],
	ref: OptionRef,
	parentOptionId: string | null,
) {
	const siblings = options.filter(
		(option) => option.parentOptionId === parentOptionId,
	);
	if (ref.id) {
		const match = siblings.find((option) => option.id === ref.id);
		if (match) return match;
	}
	if (ref.value) {
		const wanted = ref.value.toLowerCase();
		const byValue = siblings.find(
			(option) => option.value.toLowerCase() === wanted,
		);
		if (byValue) return byValue;
		return siblings.find((option) => option.id === ref.value) ?? null;
	}
	return null;
}

function isSelected(current: unknown, option: LoadedOption) {
	return storedRefs(current).some(
		(ref) =>
			ref.id === option.id ||
			(ref.id === null &&
				ref.value !== null &&
				ref.value.toLowerCase() === option.value.toLowerCase()),
	);
}

function storedChild(
	current: unknown,
	parent: LoadedOption,
	field: LoadedField,
) {
	const object = asObject(current);
	if (!object) return null;
	const parentRef = optionRefOf(object);
	const currentParent = parentRef
		? findOption(field.options, parentRef, null)
		: null;
	if (!currentParent || currentParent.id !== parent.id) return null;
	const child = object.child ? optionRefOf(object.child) : null;
	if (!child) return null;
	return findOption(field.options, child, parent.id);
}

/** Canonical form used to decide whether a value really changed. */
export function customValueKey(field: LoadedField, value: unknown): string {
	const optionKey = (ref: OptionRef) =>
		(ref.id ?? ref.value?.toLowerCase() ?? "").toString();
	if (field.type === "select") {
		const ref = optionRefOf(value);
		return ref ? `option:${optionKey(ref)}` : "option:";
	}
	if (field.type === "multiselect") {
		const keys = Array.isArray(value)
			? value
					.map((item) => optionRefOf(item))
					.filter((ref): ref is OptionRef => ref !== null)
					.map(optionKey)
					.sort()
			: [];
		return `options:${keys.join("|")}`;
	}
	if (field.type === "cascading") {
		const object = asObject(value);
		const parent = object ? optionRefOf(object) : null;
		const child = object?.child ? optionRefOf(object.child) : null;
		if (!parent) return "cascading:";
		return `cascading:${optionKey(parent)}/${child ? optionKey(child) : ""}`;
	}
	if (field.type === "user") {
		const object = asObject(value);
		const id = object
			? (stringField(object, "id") ?? stringField(object, "name"))
			: null;
		return `user:${id ?? ""}`;
	}
	if (field.type === "multiuser") {
		const keys = Array.isArray(value)
			? value
					.map((item) => {
						const object = asObject(item);
						return object
							? (stringField(object, "id") ?? stringField(object, "name"))
							: null;
					})
					.filter((item): item is string => item !== null)
					.sort()
			: [];
		return `users:${keys.join("|")}`;
	}
	if (field.type === "labels") {
		const keys = Array.isArray(value) ? value.map(String).sort() : [];
		return `labels:${keys.join("|")}`;
	}
	return `value:${customValueText(value)}`;
}

export function sameCustomValue(
	field: LoadedField,
	left: unknown,
	right: unknown,
) {
	return customValueKey(field, left) === customValueKey(field, right);
}

// --- validation ------------------------------------------------------------

export type CustomFieldUser = {
	id: string;
	username: string;
	displayName: string;
};

export type CustomFieldValidationContext = {
	/** The value stored on the issue, so a now-disabled option can be kept. */
	current?: unknown;
	/** The users that may be referenced (active users only). */
	users?: CustomFieldUser[];
};

export type CustomFieldValidation =
	| { ok: true; value: unknown }
	| { ok: false; error: string };

function isBlank(raw: unknown) {
	return (
		raw === null ||
		raw === undefined ||
		(typeof raw === "string" && raw.trim() === "") ||
		(Array.isArray(raw) && raw.length === 0)
	);
}

function validateText(raw: unknown, max: number): CustomFieldValidation {
	if (typeof raw !== "string") return { ok: false, error: "must be text" };
	const text = raw.trim();
	if (text === "") return { ok: true, value: null };
	if (text.length > max) {
		return { ok: false, error: `must be at most ${max} characters` };
	}
	return { ok: true, value: text };
}

function parseDateText(text: string) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return null;
	}
	return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseDateTimeText(text: string) {
	const shape =
		/^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?([Zz]|[+-]\d{2}:?\d{2})$/;
	if (!shape.test(text)) return null;
	const date = new Date(text.replace(" ", "T"));
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString();
}

function userRefOf(
	raw: unknown,
): { id: string | null; name: string | null } | null {
	if (typeof raw === "string") {
		const text = raw.trim();
		return text === "" ? null : { id: null, name: text };
	}
	const object = asObject(raw);
	if (!object) return null;
	const id = stringField(object, "id");
	const name =
		stringField(object, "name") ??
		stringField(object, "username") ??
		stringField(object, "displayName");
	return id || name ? { id, name } : null;
}

function findUser(
	available: CustomFieldUser[],
	ref: { id: string | null; name: string | null },
) {
	if (ref.id) {
		const byId = available.find((user) => user.id === ref.id);
		if (byId) return byId;
	}
	if (ref.name) {
		const wanted = ref.name.toLowerCase();
		const byName = available.find(
			(user) =>
				user.username.toLowerCase() === wanted ||
				user.displayName.toLowerCase() === wanted,
		);
		if (byName) return byName;
		return available.find((user) => user.id === ref.name) ?? null;
	}
	return null;
}

type StoredUser = { id: string; name: string; displayName: string };

function storedUser(value: unknown): StoredUser | null {
	const object = asObject(value);
	if (!object) return null;
	const id = stringField(object, "id");
	if (!id) return null;
	return {
		id,
		name: stringField(object, "name") ?? "",
		displayName: stringField(object, "displayName") ?? "",
	};
}

function refMatchesStoredUser(
	ref: { id: string | null; name: string | null },
	user: StoredUser,
) {
	if (ref.id) return ref.id === user.id;
	if (!ref.name) return false;
	const wanted = ref.name.toLowerCase();
	return (
		user.name.toLowerCase() === wanted ||
		user.displayName.toLowerCase() === wanted
	);
}

function validateUser(
	raw: unknown,
	ctx: CustomFieldValidationContext,
): CustomFieldValidation {
	const ref = userRefOf(raw);
	if (!ref) return { ok: false, error: "must be a user" };
	const user = findUser(ctx.users ?? [], ref);
	if (user) {
		return {
			ok: true,
			value: {
				id: user.id,
				name: user.username,
				displayName: user.displayName,
			},
		};
	}
	const kept = storedUser(ctx.current);
	if (kept && refMatchesStoredUser(ref, kept)) {
		return { ok: true, value: kept };
	}
	return { ok: false, error: "must be an active user" };
}

function validateMultiuser(
	raw: unknown,
	ctx: CustomFieldValidationContext,
): CustomFieldValidation {
	if (!Array.isArray(raw))
		return { ok: false, error: "must be a list of users" };
	const chosen = new Map<string, StoredUser>();
	const current = Array.isArray(ctx.current) ? ctx.current : [];
	for (const item of raw) {
		const ref = userRefOf(item);
		if (!ref) return { ok: false, error: "must be a list of users" };
		const user = findUser(ctx.users ?? [], ref);
		if (user) {
			chosen.set(user.id, {
				id: user.id,
				name: user.username,
				displayName: user.displayName,
			});
			continue;
		}
		const kept = current
			.map((entry) => storedUser(entry))
			.find(
				(entry): entry is StoredUser =>
					entry !== null && refMatchesStoredUser(ref, entry),
			);
		if (!kept) return { ok: false, error: "must be an active user" };
		chosen.set(kept.id, kept);
	}
	if (chosen.size === 0) return { ok: true, value: null };
	return { ok: true, value: [...chosen.values()] };
}

const ECHO_LIMIT = 100;

/** A request value as it appears in an error message: cut so a long value is not sent back whole. */
function shortened(value: string) {
	return value.length > ECHO_LIMIT ? `${value.slice(0, ECHO_LIMIT)}...` : value;
}

function validateOption(
	field: LoadedField,
	raw: unknown,
	ctx: CustomFieldValidationContext,
): CustomFieldValidation {
	const ref = optionRefOf(raw);
	if (!ref) return { ok: false, error: "must be one of the field options" };
	const option = findOption(field.options, ref, null);
	if (!option) {
		return {
			ok: false,
			error: `has no option "${shortened(ref.value ?? ref.id ?? "")}"`,
		};
	}
	if (option.disabled && !isSelected(ctx.current, option)) {
		return { ok: false, error: `option "${option.value}" is disabled` };
	}
	return { ok: true, value: { value: option.value, id: option.id } };
}

function validateOptionList(
	field: LoadedField,
	raw: unknown,
	ctx: CustomFieldValidationContext,
): CustomFieldValidation {
	if (!Array.isArray(raw)) {
		return { ok: false, error: "must be a list of field options" };
	}
	const chosen = new Map<string, LoadedOption>();
	for (const item of raw) {
		const ref = optionRefOf(item);
		if (!ref) return { ok: false, error: "must be a list of field options" };
		const option = findOption(field.options, ref, null);
		if (!option) {
			return {
				ok: false,
				error: `has no option "${shortened(ref.value ?? ref.id ?? "")}"`,
			};
		}
		if (option.disabled && !isSelected(ctx.current, option)) {
			return { ok: false, error: `option "${option.value}" is disabled` };
		}
		chosen.set(option.id, option);
	}
	if (chosen.size === 0) return { ok: true, value: null };
	return {
		ok: true,
		value: [...chosen.values()].map((option) => ({
			value: option.value,
			id: option.id,
		})),
	};
}

function validateCascading(
	field: LoadedField,
	raw: unknown,
	ctx: CustomFieldValidationContext,
): CustomFieldValidation {
	const ref = optionRefOf(raw);
	if (!ref) return { ok: false, error: "must be one of the field options" };
	const parent = findOption(field.options, ref, null);
	if (!parent) {
		return {
			ok: false,
			error: `has no option "${shortened(ref.value ?? ref.id ?? "")}"`,
		};
	}
	if (parent.disabled && !isSelected(ctx.current, parent)) {
		return { ok: false, error: `option "${parent.value}" is disabled` };
	}
	const object = asObject(raw);
	const childRef = object?.child ? optionRefOf(object.child) : null;
	if (childRef) {
		const child = findOption(field.options, childRef, parent.id);
		if (!child) {
			return {
				ok: false,
				error: `option "${parent.value}" has no child "${shortened(childRef.value ?? childRef.id ?? "")}"`,
			};
		}
		if (child.disabled && !isSelected(ctx.current, child)) {
			return { ok: false, error: `child option "${child.value}" is disabled` };
		}
		return {
			ok: true,
			value: {
				value: parent.value,
				id: parent.id,
				child: { value: child.value, id: child.id },
			},
		};
	}
	const children = field.options.filter(
		(option) => option.parentOptionId === parent.id,
	);
	if (children.length > 0) {
		const kept = storedChild(ctx.current, parent, field);
		if (kept) {
			return {
				ok: true,
				value: {
					value: parent.value,
					id: parent.id,
					child: { value: kept.value, id: kept.id },
				},
			};
		}
		return {
			ok: false,
			error: `option "${parent.value}" requires a child option`,
		};
	}
	return { ok: true, value: { value: parent.value, id: parent.id } };
}

/**
 * The single validation path for a custom field value. `value` is `null` when
 * the field is cleared (the caller deletes the key from `issues.custom`).
 */
export function validateCustomValue(
	field: LoadedField,
	rawValue: unknown,
	ctx: CustomFieldValidationContext = {},
): CustomFieldValidation {
	if (isBlank(rawValue)) return { ok: true, value: null };

	switch (field.type) {
		case "text":
			return validateText(rawValue, 255);
		case "paragraph":
			return validateText(rawValue, 32_000);
		case "number": {
			const number =
				typeof rawValue === "number"
					? rawValue
					: typeof rawValue === "string" && rawValue.trim() !== ""
						? Number(rawValue.trim())
						: Number.NaN;
			if (!Number.isFinite(number)) {
				return { ok: false, error: "must be a number" };
			}
			return { ok: true, value: number };
		}
		case "date": {
			if (typeof rawValue !== "string") {
				return { ok: false, error: "must be a date (YYYY-MM-DD)" };
			}
			const text = rawValue.trim();
			if (text === "") return { ok: true, value: null };
			const date = parseDateText(text);
			if (!date)
				return { ok: false, error: "is not a valid date (YYYY-MM-DD)" };
			return { ok: true, value: date };
		}
		case "datetime": {
			if (typeof rawValue !== "string") {
				return {
					ok: false,
					error: "must be an ISO-8601 date and time with a timezone",
				};
			}
			const text = rawValue.trim();
			if (text === "") return { ok: true, value: null };
			const stamp = parseDateTimeText(text);
			if (!stamp) {
				return {
					ok: false,
					error: "must be an ISO-8601 date and time with a timezone",
				};
			}
			return { ok: true, value: stamp };
		}
		case "url": {
			if (typeof rawValue !== "string") {
				return { ok: false, error: "must be an http or https URL" };
			}
			const text = rawValue.trim();
			if (text === "") return { ok: true, value: null };
			if (text.length > 2000) {
				return { ok: false, error: "must be at most 2000 characters" };
			}
			let url: URL;
			try {
				url = new URL(text);
			} catch {
				return { ok: false, error: "must be an http or https URL" };
			}
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				return { ok: false, error: "must be an http or https URL" };
			}
			return { ok: true, value: text };
		}
		case "select":
			return validateOption(field, rawValue, ctx);
		case "multiselect":
			return validateOptionList(field, rawValue, ctx);
		case "cascading":
			return validateCascading(field, rawValue, ctx);
		case "user":
			return validateUser(rawValue, ctx);
		case "multiuser":
			return validateMultiuser(rawValue, ctx);
		case "labels": {
			if (!Array.isArray(rawValue)) {
				return { ok: false, error: "must be a list of labels" };
			}
			const labels: string[] = [];
			for (const item of rawValue) {
				if (typeof item !== "string") {
					return { ok: false, error: "must be a list of labels" };
				}
				const label = item.trim();
				if (label === "") continue;
				if (label.length > 255) {
					return {
						ok: false,
						error: "labels must be at most 255 characters",
					};
				}
				if (/\s/.test(label)) {
					return { ok: false, error: `label "${label}" contains a space` };
				}
				if (!labels.includes(label)) labels.push(label);
			}
			if (labels.length > 50) {
				return { ok: false, error: "must have at most 50 labels" };
			}
			return { ok: true, value: labels.length === 0 ? null : labels };
		}
	}
}

// --- issue integration -----------------------------------------------------

export type CustomFieldChange = {
	field: string;
	fieldType: "custom";
	fromValue: string | null;
	fromText: string | null;
	toValue: string | null;
	toText: string | null;
};

export type PreparedCustomFields =
	| { ok: true; values: Record<string, unknown>; history: CustomFieldChange[] }
	| { ok: false; error: string };

async function validationContext(
	field: LoadedField,
	current: unknown,
): Promise<CustomFieldValidationContext> {
	if (field.type !== "user" && field.type !== "multiuser") return { current };
	const rows = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
		})
		.from(users)
		.where(eq(users.active, true));
	return { current, users: rows };
}

async function unknownFieldError(fieldId: string) {
	if (!z.uuid().safeParse(fieldId).success) {
		return `${shortened(fieldId)}: unknown custom field`;
	}
	const [row] = await db
		.select()
		.from(fields)
		.where(eq(fields.id, fieldId))
		.limit(1);
	if (!row) return `${shortened(fieldId)}: unknown custom field`;
	if (!adminTypeForField(row)) {
		return `${row.name}: is a system field and cannot be edited`;
	}
	return `${row.name}: does not apply to this project and issue type`;
}

/**
 * Validates a `customFields` payload against the issue's project and type and
 * returns the complete next `issues.custom` object plus the history rows.
 */
export async function prepareCustomFields(options: {
	projectId: string;
	issueTypeId: string;
	mode: "create" | "update";
	current?: Record<string, unknown> | null;
	changes: Record<string, unknown>;
}): Promise<PreparedCustomFields> {
	const current = options.current ?? {};
	const available = await loadFieldsForContext(
		options.projectId,
		options.issueTypeId,
	);
	const byId = new Map(available.map((field) => [field.id, field]));

	if (options.mode === "create") {
		for (const field of available) {
			if (field.required && !(field.id in options.changes)) {
				return { ok: false, error: `${field.name}: is required` };
			}
		}
	}

	const values: Record<string, unknown> = { ...current };
	const history: CustomFieldChange[] = [];

	for (const [fieldId, raw] of Object.entries(options.changes)) {
		const field = byId.get(fieldId);
		if (!field) {
			return {
				ok: false,
				error: await unknownFieldError(fieldId),
			};
		}
		const previous = current[field.sourceId];
		const result = validateCustomValue(
			field,
			raw,
			await validationContext(field, previous),
		);
		if (!result.ok)
			return { ok: false, error: `${field.name}: ${result.error}` };
		if (field.required && result.value === null) {
			return { ok: false, error: `${field.name}: is required` };
		}
		if (result.value === null) delete values[field.sourceId];
		else values[field.sourceId] = result.value;
		if (!sameCustomValue(field, previous, result.value)) {
			history.push({
				field: field.name,
				fieldType: "custom",
				fromValue: customValueRaw(field, previous),
				fromText: customValueHistoryText(field, previous),
				toValue: customValueRaw(field, result.value),
				toText: customValueHistoryText(field, result.value),
			});
		}
	}

	return { ok: true, values, history };
}

function selectedKeys(value: unknown) {
	const keys = new Set<string>();
	for (const ref of storedRefs(value)) {
		if (ref.id) keys.add(ref.id);
		if (ref.value) keys.add(ref.value.toLowerCase());
	}
	return keys;
}

/** The configurable fields of an issue with their stored value. */
export async function loadEditableCustomFields(
	projectId: string,
	issueTypeId: string,
	custom: Record<string, unknown>,
) {
	const available = await loadFieldsForContext(projectId, issueTypeId);
	return available.map((field) => {
		const value = custom[field.sourceId] ?? null;
		return {
			id: field.id,
			name: field.name,
			description: field.description,
			type: field.type,
			required: field.required,
			options: optionTree(field.options, false, selectedKeys(value)),
			value,
		};
	});
}

// --- storage rewrites shared with the admin routes -------------------------

export type StoredIssueValue = {
	id: string;
	custom: Record<string, unknown>;
};

/** Issues that hold a value for the field, locked for a rewrite. */
export async function lockStoredValues(
	tx: Pick<typeof db, "select">,
	field: LoadedField,
): Promise<StoredIssueValue[]> {
	const rows = await tx
		.select({ id: issues.id, custom: issues.custom })
		.from(issues)
		.where(sql`${issues.custom} ? ${field.sourceId}`)
		.for("update");
	return rows
		.filter((row) => {
			const custom = row.custom as Record<string, unknown>;
			return (
				custom[field.sourceId] !== null && custom[field.sourceId] !== undefined
			);
		})
		.map((row) => ({
			id: row.id,
			custom: row.custom as Record<string, unknown>,
		}));
}

export function optionUsage(
	value: unknown,
	optionIds: Set<string>,
	optionValues: Set<string>,
) {
	return storedRefs(value).some(
		(ref) =>
			(ref.id !== null && optionIds.has(ref.id)) ||
			(ref.id === null &&
				ref.value !== null &&
				optionValues.has(ref.value.toLowerCase())),
	);
}

// Value formatting shared by the issue API and the navigator.
/** Fields the importer stores but the issue screen never shows. */
export const INTERNAL_CUSTOM_FIELD_ROLES = new Set<CustomFieldRole>([
	"rank",
	"sprint",
	"developmentSummary",
	"epicLink",
	"epicName",
	"epicStatus",
	"epicColour",
]);

/** A Jira custom field value as one line of text. */
export function formatCustomValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value
			.map((item) => formatCustomValue(item))
			.filter((item) => item !== "")
			.join(", ");
	}
	if (typeof value === "object") {
		const object = value as Record<string, unknown>;
		if (typeof object.displayName === "string") return object.displayName;
		if (typeof object.name === "string") return object.name;
		if (typeof object.value === "string") {
			const child = object.child ? formatCustomValue(object.child) : "";
			return child === "" ? object.value : `${object.value} / ${child}`;
		}
	}
	return "";
}

export function isVisibleCustomField(field: {
	sourceId: string;
	name?: string | null;
	customKey: string | null;
	type: string | null;
}) {
	const role = customFieldRole(field);
	return (
		!(role && INTERNAL_CUSTOM_FIELD_ROLES.has(role)) &&
		!field.customKey?.startsWith("com.atlassian.servicedesk") &&
		!field.type?.startsWith("sd-")
	);
}
