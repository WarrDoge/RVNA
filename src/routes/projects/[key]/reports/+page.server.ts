import { pageLoad } from "#lib/server/http-svelte.ts";
import { getProject } from "#lib/server/projects/service.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	await getProject(actor, event.params.key);
	return {};
}) satisfies PageServerLoad;
