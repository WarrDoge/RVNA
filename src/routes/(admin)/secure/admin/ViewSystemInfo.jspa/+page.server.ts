import { getSystemInfo } from "#lib/server/admin/system.ts";
import { adminLoad } from "#lib/server/http-svelte.ts";
import type { PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-system");
	return { info: await getSystemInfo(actor) };
}) satisfies PageServerLoad;
