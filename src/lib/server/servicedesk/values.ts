import { formatCustomValue } from "../custom-fields.ts";

/** Renders a stored Jira custom field value the way Jira shows it in a list. */
export const customText = formatCustomValue;

const datetimeShape =
	/^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?([Zz]|[+-]\d{2}:?\d{2})$/;

/** An ISO instant for a datetime custom field, or null when it holds none. */
export function customDate(value: unknown): string | null {
	const text = customText(value);
	if (!datetimeShape.test(text)) return null;
	const date = new Date(text.replace(" ", "T"));
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
