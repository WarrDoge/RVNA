import { pageLoad } from "#lib/server/http-svelte.ts";
import { wikiHome } from "#lib/server/wiki/service.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	event.depends("app:wiki-home");
	return { home: await wikiHome(actor) };
}) satisfies PageServerLoad;
