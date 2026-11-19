import { error } from "@sveltejs/kit";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { portalParams } from "#lib/server/servicedesk/schemas.ts";
import { portalDetail } from "#lib/server/servicedesk/service.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	event.depends("app:portal");
	if (!portalParams.safeParse(event.params).success) {
		error(404, "Portal not found");
	}
	const portal = await portalDetail(actor, event.params.id);
	return {
		portal: {
			id: portal.id,
			name: portal.name,
			description: portal.description,
			announcement: portal.announcement,
			groups: portal.groups,
		},
	};
}) satisfies PageServerLoad;
