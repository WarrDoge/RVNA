import { api } from "#lib/api.ts";

/** The one JQL suggestion request, shared by the input and the basic-mode pickers. */
export function suggestJqlValues(field: string, prefix = "", limit = 20) {
	return api<{ values: string[] }>(
		`/api/jql/suggest?field=${encodeURIComponent(field)}&prefix=${encodeURIComponent(prefix)}&limit=${limit}`,
	);
}
