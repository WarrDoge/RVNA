export { projectKeyError } from "#lib/shared/project-keys.ts";

/** Jira's suggestion: initials of every word, the first letters of a single word. */
export function suggestProjectKey(name: string) {
	const words = name
		.toUpperCase()
		.replace(/[^A-Z0-9\s]/g, " ")
		.split(/\s+/)
		.filter(Boolean);
	if (words.length === 0) return "";
	if (words.length === 1) return (words[0] ?? "").slice(0, 4);
	return words
		.map((word) => word.slice(0, 1))
		.join("")
		.slice(0, 10);
}
