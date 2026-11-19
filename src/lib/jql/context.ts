import type { CustomFieldColumn } from "#lib/api-types.ts";
import { SYSTEM_FIELDS } from "#lib/shared/fields.ts";
import {
	BUILTIN_FIELD_ALIASES,
	JQL_FUNCTIONS,
	JqlError,
	parseJql,
} from "#lib/shared/jql/index.ts";

export const OPERATORS = [
	"=",
	"!=",
	"~",
	"!~",
	">",
	">=",
	"<",
	"<=",
	"in",
	"not in",
	"is",
	"is not",
];

const OPERATOR_WORDS = new Set([
	"=",
	"!=",
	"~",
	"!~",
	">",
	">=",
	"<",
	"<=",
	"in",
	"not",
	"is",
	"was",
	"changed",
]);

const FIELD_WORDS = new Set(
	Object.keys(BUILTIN_FIELD_ALIASES)
		.filter((name) => !name.includes(" "))
		.concat(SYSTEM_FIELDS.map((field) => field.jql.toLowerCase())),
);

export interface Suggestion {
	label: string;
	insert: string;
	kind: "field" | "operator" | "function" | "value";
}

export interface Context {
	mode: Suggestion["kind"] | "order";
	field: string | null;
	partial: string;
}

function orderByEnd(value: string) {
	let quoted = false;
	for (let index = 0; index < value.length; index++) {
		const character = value[index];
		if (quoted) {
			if (character === "\\") index++;
			else if (character === '"') quoted = false;
			continue;
		}
		if (character === '"') {
			quoted = true;
			continue;
		}
		const match = /^order\s+by\b/i.exec(value.slice(index));
		if (match) return index + match[0].length;
	}
	return -1;
}

function knownField(name: string, customFields: CustomFieldColumn[]) {
	const clean = name.replace(/^"|"$/g, "").toLowerCase();
	if (FIELD_WORDS.has(clean)) return clean;
	if (/^cf\[\d+\]$/.test(clean)) return clean;
	const custom = customFields.find(
		(field) => field.name.toLowerCase() === clean,
	);
	return custom ? custom.name : null;
}

export function jqlContext(
	value: string,
	caret: number,
	customFields: CustomFieldColumn[] = [],
): Context {
	const before = value.slice(0, caret);
	const partial = /([A-Za-z0-9_.\-"[\]]*)$/.exec(before)?.[1] ?? "";
	const head = before
		.slice(0, before.length - partial.length)
		.replace(/[\s(,]+$/, "")
		.trim();

	if (head === "") return { mode: "field", field: null, partial };

	const words = head.split(/\s+/);
	const last = (words[words.length - 1] ?? "").toLowerCase();
	const previous = (words[words.length - 2] ?? "").toLowerCase();

	if (last === "and" || last === "or" || last === "not") {
		return { mode: "field", field: null, partial };
	}
	if (previous === "order" && last === "by") {
		return { mode: "field", field: null, partial };
	}
	const orderEnd = orderByEnd(head);
	if (orderEnd !== -1 && head.slice(orderEnd).trim() !== "") {
		return { mode: "order", field: null, partial };
	}

	let field: string | null = null;
	for (let index = words.length - 1; index >= 0; index--) {
		const found = knownField(words[index] as string, customFields);
		if (found) {
			field = found;
			break;
		}
	}

	if (OPERATOR_WORDS.has(last) || /(?:[=!~<>]|>=|<=)$/.test(last)) {
		return { mode: "value", field, partial };
	}
	if (field && words[words.length - 1] === field) {
		return { mode: "operator", field, partial };
	}
	if (previous === "by" || previous === "order") {
		return { mode: "field", field: null, partial };
	}
	if (knownField(last, customFields)) {
		return { mode: "operator", field: knownField(last, customFields), partial };
	}
	return { mode: "field", field: null, partial };
}

export function fieldSuggestions(
	partial: string,
	customFields: CustomFieldColumn[],
): Suggestion[] {
	const names = [
		...new Set([
			...FIELD_WORDS,
			...customFields.map((field) => field.name),
			...customFields.map((field) => field.jql),
		]),
	]
		.filter((name) => name.toLowerCase().startsWith(partial.toLowerCase()))
		.sort((left, right) => left.localeCompare(right));
	return names.slice(0, 8).map((name) => ({
		label: name,
		insert: name.includes(" ") ? `"${name}"` : name,
		kind: "field",
	}));
}

export function operatorSuggestions(partial: string): Suggestion[] {
	return OPERATORS.filter((operator) =>
		operator.startsWith(partial.toLowerCase()),
	)
		.slice(0, 8)
		.map((operator) => ({
			label: operator,
			insert: operator,
			kind: "operator",
		}));
}

export function functionSuggestions(partial: string): Suggestion[] {
	return Object.keys(JQL_FUNCTIONS)
		.filter((name) => name.startsWith(partial.toLowerCase()))
		.map((name) => ({
			label: `${name}()`,
			insert: `${name}()`,
			kind: "function" as const,
		}));
}

export function jqlErrorText(value: string) {
	try {
		parseJql(value);
		return null;
	} catch (error) {
		return error instanceof JqlError ? error.jiraMessage : "Invalid query";
	}
}
