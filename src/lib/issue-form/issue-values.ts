import type { CustomFieldSpec } from "#lib/api-types.ts";
import { fieldValueProblem, isEmptyFieldValue } from "./custom-field-values.ts";

/** The values of the fields that still exist, ready for the request body. */
export function customFieldBody(
	fields: CustomFieldSpec[],
	values: Record<string, unknown>,
) {
	const body: Record<string, unknown> = {};
	for (const field of fields) {
		const value = values[field.id];
		if (!isEmptyFieldValue(value)) body[field.id] = value;
	}
	return body;
}

/** Only the values that differ from what the issue already stores. */
export function changedCustomFieldBody(
	fields: { id: string; value?: unknown }[],
	values: Record<string, unknown>,
) {
	const body: Record<string, unknown> = {};
	const plain = (value: unknown) => (isEmptyFieldValue(value) ? null : value);
	for (const field of fields) {
		const next = plain(values[field.id]);
		if (JSON.stringify(plain(field.value)) !== JSON.stringify(next)) {
			body[field.id] = next;
		}
	}
	return body;
}

/** Brings the first field with a problem into view inside the dialog. */
export function revealCustomFieldProblem(problems: Record<string, string>) {
	const [first] = Object.keys(problems);
	if (!first) return;
	document
		.getElementById(`custom-field-${first}`)
		?.scrollIntoView({ block: "center" });
}

/** Inline problems per field id, empty when every value may be sent. */
export function customFieldProblems(
	fields: CustomFieldSpec[],
	values: Record<string, unknown>,
) {
	const problems: Record<string, string> = {};
	for (const field of fields) {
		const value = values[field.id];
		if (field.required && isEmptyFieldValue(value)) {
			problems[field.id] = "This field is required.";
			continue;
		}
		const problem = fieldValueProblem(field, value);
		if (problem) problems[field.id] = problem;
	}
	return problems;
}
