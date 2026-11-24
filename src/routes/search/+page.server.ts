import { globalSearch } from "#lib/server/global-search.ts";
import { HttpError } from "#lib/server/http.ts";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { offsetParam } from "#lib/server/paging.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	const q = (event.url.searchParams.get("q") ?? "").trim().slice(0, 200);
	const startAt = offsetParam(event.url.searchParams.get("startAt"));
	const tab: "issues" | "pages" =
		event.url.searchParams.get("tab") === "pages" ? "pages" : "issues";

	let results = null;
	let error: string | null = null;
	if (q !== "") {
		try {
			results = await globalSearch(actor, { q, startAt, maxResults: 25 });
		} catch (cause) {
			if (!(cause instanceof HttpError)) throw cause;
			error = cause.message;
		}
	}

	return { q, startAt, tab, results, error };
}) satisfies PageServerLoad;
