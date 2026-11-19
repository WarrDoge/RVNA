import { getGroup, listGroups } from "#lib/server/admin/groups.ts";
import { adminLoad } from "#lib/server/http-svelte.ts";
import type { PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-group");
	const name = event.url.searchParams.get("name") ?? "";
	if (name === "") {
		return { name, missingName: true, group: null };
	}
	const [summary] = await listGroups(actor, { query: "", name });
	if (!summary) {
		return { name, missingName: false, group: null };
	}
	return { name, missingName: false, group: await getGroup(actor, summary.id) };
}) satisfies PageServerLoad;
