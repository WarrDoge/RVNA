import { endOfDay, startOfDay } from "#lib/dates.ts";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { listSpaces, searchPages } from "#lib/server/wiki/service.ts";
import type { PageServerLoad } from "./$types";

function isoDate(value: string, end: boolean) {
	if (value === "") return undefined;
	return (end ? endOfDay(value) : startOfDay(value)) || undefined;
}

export const load = pageLoad(async (event, actor) => {
	const queryString = event.url.searchParams.get("queryString") ?? "";
	const space = event.url.searchParams.get("space") ?? "";
	const contributor = event.url.searchParams.get("contributor") ?? "";
	const from = event.url.searchParams.get("from") ?? "";
	const to = event.url.searchParams.get("to") ?? "";
	const rawOffset = Number(event.url.searchParams.get("offset") ?? "0");
	const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
	const limit = 25;

	const [results, spaces] = await Promise.all([
		searchPages(actor, {
			query: queryString,
			space: space || undefined,
			contributor: contributor || undefined,
			from: isoDate(from, false),
			to: isoDate(to, true),
			offset,
			limit,
		}),
		listSpaces(actor, {}),
	]);

	return {
		results,
		spaces,
		limit,
		filters: { queryString, space, contributor, from, to, offset },
	};
}) satisfies PageServerLoad;
