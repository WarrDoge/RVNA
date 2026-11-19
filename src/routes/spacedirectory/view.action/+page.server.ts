import { pageLoad } from "#lib/server/http-svelte.ts";
import { listSpaces } from "#lib/server/wiki/service.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	event.depends("app:wiki-spaces");
	return { spaces: await listSpaces(actor, {}) };
}) satisfies PageServerLoad;
