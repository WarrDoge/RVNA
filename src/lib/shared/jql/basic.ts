import type {
	JqlClause,
	JqlFieldRef,
	JqlNode,
	JqlOperand,
	JqlOrderBy,
	JqlQuery,
} from "./ast.ts";
import { builtinFieldId } from "./fields.ts";
import { JQL_RESERVED_WORDS } from "./functions.ts";

/**
 * Basic mode is a flat AND of equality clauses plus two date ranges and a text
 * search. Anything the parser can express beyond that is reported as
 * unrepresentable instead of being silently dropped.
 */
export interface BasicQuery {
	project: string[];
	type: string[];
	status: string[];
	assignee: string[];
	text: string;
	priority: string[];
	reporter: string[];
	labels: string[];
	resolution: string[];
	fixVersion: string[];
	component: string[];
	epic: string[];
	created: { from: string; to: string } | null;
	updated: { from: string; to: string } | null;
}

export type BasicField = Exclude<
	keyof BasicQuery,
	"text" | "created" | "updated"
>;

export type BasicCriterionId = BasicField | "text" | "created" | "updated";

export interface BasicCriterion {
	id: BasicCriterionId;
	name: string;
	kind: "list" | "text" | "range";
	/** Values offered by the picker, fetched from the JQL suggest endpoint. */
	suggestField?: string;
	multiple: boolean;
}

/** Sentinel for `field is EMPTY`, so "none" survives a round trip. */
export const BASIC_NONE = "__none__";

export const BASIC_CRITERIA: BasicCriterion[] = [
	{
		id: "priority",
		name: "Priority",
		kind: "list",
		suggestField: "priority",
		multiple: false,
	},
	{
		id: "reporter",
		name: "Reporter",
		kind: "list",
		suggestField: "reporter",
		multiple: false,
	},
	{
		id: "labels",
		name: "Labels",
		kind: "list",
		suggestField: "labels",
		multiple: false,
	},
	{
		id: "resolution",
		name: "Resolution",
		kind: "list",
		suggestField: "resolution",
		multiple: false,
	},
	{ id: "created", name: "Created", kind: "range", multiple: false },
	{ id: "updated", name: "Updated", kind: "range", multiple: false },
	{
		id: "fixVersion",
		name: "Fix version",
		kind: "list",
		suggestField: "fixVersion",
		multiple: false,
	},
	{
		id: "component",
		name: "Component",
		kind: "list",
		suggestField: "component",
		multiple: false,
	},
	{
		id: "epic",
		name: "Epic",
		kind: "list",
		suggestField: "epicLink",
		multiple: false,
	},
];

const BASIC_FIELD_JQL: Record<BasicField, string> = {
	project: "project",
	type: "issuetype",
	status: "status",
	assignee: "assignee",
	priority: "priority",
	reporter: "reporter",
	labels: "labels",
	resolution: "resolution",
	fixVersion: "fixVersion",
	component: "component",
	epic: "epicLink",
};

const JQL_TO_BASIC: Record<string, BasicCriterionId> = {
	project: "project",
	issuetype: "type",
	status: "status",
	assignee: "assignee",
	priority: "priority",
	reporter: "reporter",
	labels: "labels",
	resolution: "resolution",
	fixVersion: "fixVersion",
	component: "component",
	epicLink: "epic",
	created: "created",
	updated: "updated",
	text: "text",
};

export function emptyBasicQuery(): BasicQuery {
	return {
		project: [],
		type: [],
		status: [],
		assignee: [],
		text: "",
		priority: [],
		reporter: [],
		labels: [],
		resolution: [],
		fixVersion: [],
		component: [],
		epic: [],
		created: null,
		updated: null,
	};
}

const PLAIN_VALUE = /^[A-Za-z0-9_.\-+]+$/;
const PLAIN_FIELD = /^[A-Za-z][A-Za-z0-9_]*$/;
const CUSTOM_FIELD = /^cf\[\d+\]$/;

export function quoteJqlValue(value: string) {
	const plain =
		PLAIN_VALUE.test(value) &&
		!JQL_RESERVED_WORDS.has(value.toLowerCase()) &&
		!/^\d+(?:\.\d+)?$/.test(value);
	if (plain) return value;
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function jqlFieldName(name: string) {
	return PLAIN_FIELD.test(name) || CUSTOM_FIELD.test(name)
		? name
		: `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function literal(value: string) {
	return value === "currentUser()" ? value : quoteJqlValue(value);
}

function clause(field: string, values: string[]) {
	if (values.length === 0) return null;
	if (values.includes(BASIC_NONE)) return `${field} is EMPTY`;
	if (values.length === 1) return `${field} = ${literal(values[0] as string)}`;
	return `${field} in (${values.map(literal).join(", ")})`;
}

function range(field: string, value: { from: string; to: string }) {
	const parts: string[] = [];
	if (value.from.trim() !== "") {
		parts.push(`${field} >= ${quoteJqlValue(value.from.trim())}`);
	}
	if (value.to.trim() !== "") {
		parts.push(`${field} <= ${quoteJqlValue(value.to.trim())}`);
	}
	return parts;
}

export function basicToJql(query: BasicQuery, orderBy: JqlOrderBy[] = []) {
	const parts: string[] = [];
	for (const field of Object.keys(BASIC_FIELD_JQL) as BasicField[]) {
		const part = clause(BASIC_FIELD_JQL[field], query[field]);
		if (part) parts.push(part);
	}
	if (query.text.trim() !== "") {
		parts.push(`text ~ ${quoteJqlValue(query.text.trim())}`);
	}
	if (query.created) parts.push(...range("created", query.created));
	if (query.updated) parts.push(...range("updated", query.updated));

	const order = orderByJql(orderBy);
	const where = parts.join(" AND ");
	if (where === "") return order === "" ? "ORDER BY updated DESC" : order;
	return order === "" ? `${where} ORDER BY updated DESC` : `${where} ${order}`;
}

export function orderByJql(orderBy: JqlOrderBy[]) {
	if (orderBy.length === 0) return "";
	return `ORDER BY ${orderBy
		.map(
			(item) =>
				`${jqlFieldName(item.field.name)} ${item.direction.toUpperCase()}`,
		)
		.join(", ")}`;
}

function operandValues(operand: JqlOperand): string[] | null {
	if (operand.kind === "list") {
		const values: string[] = [];
		for (const item of operand.values) {
			const nested = operandValues(item);
			if (nested === null) return null;
			values.push(...nested);
		}
		return values;
	}
	if (operand.kind === "string") return [operand.value];
	if (operand.kind === "number") return [operand.text];
	if (operand.kind === "function") {
		if (operand.name !== "currentuser" || operand.args.length > 0) return null;
		return ["currentUser()"];
	}
	return null;
}

interface Conversion {
	query: BasicQuery;
	orderBy: JqlOrderBy[];
}

function isListField(id: BasicCriterionId) {
	return id !== "text" && id !== "created" && id !== "updated";
}

function applyClause(query: BasicQuery, clause: JqlClause): string | null {
	if (clause.field.customId !== null) {
		return `The field '${clause.field.name}' is a custom field.`;
	}
	const builtin = builtinFieldId(clause.field.name);
	const id = builtin ? JQL_TO_BASIC[builtin] : undefined;
	if (!id) {
		return `The field '${clause.field.name}' is not available in basic mode.`;
	}

	if (id === "created" || id === "updated") {
		const values = operandValues(clause.operand);
		if (values === null || values.length !== 1) {
			return `The ${id} filter is not a date.`;
		}
		const value = values[0] as string;
		const current = query[id] ?? { from: "", to: "" };
		if (clause.operator === ">=") {
			query[id] = { ...current, from: value };
			return null;
		}
		if (clause.operator === "<=") {
			query[id] = { ...current, to: value };
			return null;
		}
		return `The ${id} filter uses the operator '${clause.operator}', which basic mode cannot show.`;
	}

	if (id === "text") {
		if (clause.operator !== "~") {
			return "Basic mode only searches text with 'contains'.";
		}
		const values = operandValues(clause.operand);
		if (values === null || values.length !== 1) {
			return "The text filter is not a single value.";
		}
		query.text = values[0] as string;
		return null;
	}

	if (!isListField(id))
		return `The field '${clause.field.name}' is unsupported.`;

	if (clause.operator === "is") {
		if (clause.operand.kind !== "empty") {
			return `The field '${clause.field.name}' uses the operator 'is', which basic mode cannot show.`;
		}
		query[id] = [BASIC_NONE];
		return null;
	}
	if (clause.operator !== "=" && clause.operator !== "in") {
		return `The field '${clause.field.name}' uses the operator '${clause.operator}', which basic mode cannot show.`;
	}
	const values = operandValues(clause.operand);
	if (values === null) {
		return `The value of '${clause.field.name}' is not a plain list.`;
	}
	query[id] = values;
	return null;
}

function walk(query: BasicQuery, node: JqlNode): string | null {
	if (node.kind === "and") {
		return walk(query, node.left) ?? walk(query, node.right);
	}
	if (node.kind === "or") {
		return "The query uses OR, which basic mode cannot show.";
	}
	if (node.kind === "not") {
		return "The query uses NOT, which basic mode cannot show.";
	}
	if (node.kind === "history") {
		return "The query uses issue history (WAS, CHANGED), which basic mode cannot show.";
	}
	return applyClause(query, node);
}

export function jqlToBasic(
	parsed: JqlQuery,
): ({ ok: true } & Conversion) | { ok: false; error: string } {
	const query = emptyBasicQuery();
	if (parsed.where) {
		const error = walk(query, parsed.where);
		if (error) return { ok: false, error };
	}
	return { ok: true, query, orderBy: parsed.orderBy };
}

export function hasCriteria(query: BasicQuery) {
	return (
		query.text.trim() !== "" ||
		query.created !== null ||
		query.updated !== null ||
		(Object.keys(BASIC_FIELD_JQL) as BasicField[]).some(
			(field) => query[field].length > 0,
		)
	);
}

export function fieldLabel(field: JqlFieldRef) {
	return field.name;
}
