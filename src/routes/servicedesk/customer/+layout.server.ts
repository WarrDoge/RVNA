import { pageLoad } from "#lib/server/http-svelte.ts";
import { listMyRequests } from "#lib/server/servicedesk/service.ts";
import type { LayoutServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	event.depends("app:portal");
	const { total } = await listMyRequests(actor, {
		status: "open",
		scope: "all",
		query: "",
	});
	return { openRequests: total };
}) satisfies LayoutServerLoad;
