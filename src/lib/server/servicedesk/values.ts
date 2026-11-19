/** Renders a stored Jira custom field value the way Jira shows it in a list. */
export function customText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value.trim();
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value
			.map((item) => customText(item))
			.filter((item) => item !== "")
			.join(", ");
	}
	if (typeof value === "object") {
		const object = value as Record<string, unknown>;
		if (typeof object.displayName === "string") return object.displayName;
		if (typeof object.name === "string") return object.name;
		if (typeof object.value === "string") {
			const child = object.child ? customText(object.child) : "";
			return child === "" ? object.value : `${object.value} / ${child}`;
		}
	}
	return "";
}

/** An ISO instant for a datetime custom field, or null when it holds none. */
export function customDate(value: unknown): string | null {
	const text = customText(value);
	if (text === "") return null;
	const date = new Date(text);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
