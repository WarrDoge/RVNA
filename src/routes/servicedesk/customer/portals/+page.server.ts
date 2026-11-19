import { redirect } from "@sveltejs/kit";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { listPortals } from "#lib/server/servicedesk/service.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (_event, actor) => {
	const portals = await listPortals(actor);
	if (portals.length === 0) redirect(302, "/secure/Dashboard.jspa");
	redirect(302, `/servicedesk/customer/portal/${portals[0].id}`);
}) satisfies PageServerLoad;
