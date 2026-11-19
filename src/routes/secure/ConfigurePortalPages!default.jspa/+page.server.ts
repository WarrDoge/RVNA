import { fail } from "@sveltejs/kit";
import { createBody } from "#lib/server/dashboards/schemas.ts";
import {
	createDashboard,
	listDashboards,
	removeDashboard,
} from "#lib/server/dashboards/service.ts";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";
import { isDashboardTab } from "./tabs.ts";

export const load = pageLoad(async (event, actor) => {
	event.depends("app:dashboards");
	const tabParam = event.url.searchParams.get("tab");
	const tab = isDashboardTab(tabParam) ? tabParam : "favourite";
	const query =
		tab === "search"
			? (event.url.searchParams.get("query") ?? "").slice(0, 200)
			: "";
	return {
		tab,
		query,
		dashboards: await listDashboards(actor, { scope: tab, query }),
	};
}) satisfies PageServerLoad;

export const actions = {
	default: pageAction(async ({ form }, actor) => {
		const intent = String(form.get("intent") ?? "");

		if (intent === "create") {
			const parsed = createBody.safeParse({
				name: form.get("name"),
				shared: false,
			});
			if (!parsed.success) {
				return fail(400, {
					error: parsed.error.issues[0]?.message ?? "Invalid dashboard",
				});
			}
			const created = await createDashboard(actor, parsed.data);
			return { created: created.id };
		}

		if (intent === "delete") {
			const id = String(form.get("id") ?? "");
			if (id === "") return fail(400, { error: "Invalid dashboard" });
			await removeDashboard(actor, id);
			return { deleted: id };
		}

		return fail(400, { error: "Unknown action" });
	}),
} satisfies Actions;
