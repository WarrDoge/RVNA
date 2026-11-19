import { pageLoad } from "#lib/server/http-svelte.ts";
import { pagesByLabel } from "#lib/server/wiki/service.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	event.depends("app:wiki-label");
	return {
		name: event.params.name,
		pages: await pagesByLabel(actor, event.params.name),
	};
}) satisfies PageServerLoad;
