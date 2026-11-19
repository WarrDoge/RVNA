import { fail } from "@sveltejs/kit";
import { z } from "zod";
import {
	listFiltersForPage,
	updateFilter,
} from "#lib/server/filters/service.ts";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";
import { isFilterTab } from "./tabs.ts";

function text(form: FormData, name: string) {
	return String(form.get(name) ?? "");
}

export const load = pageLoad(async (event, actor) => {
	event.depends("app:filters");
	const tabParam = event.url.searchParams.get("tab");
	const tab = isFilterTab(tabParam) ? tabParam : "favourite";
	const query =
		tab === "search"
			? (event.url.searchParams.get("query") ?? "").slice(0, 200)
			: "";
	const filters = await listFiltersForPage(actor, { scope: tab, query });
	return { tab, query, filters };
}) satisfies PageServerLoad;

export const actions = {
	default: pageAction(async ({ form }, actor) => {
		const id = z.uuid().safeParse(text(form, "filterId"));
		if (!id.success) return fail(400, { error: "Filter not found" });
		const name = text(form, "name").trim();
		if (name === "") return fail(400, { error: "Enter a filter name" });
		const description = text(form, "description").trim();
		await updateFilter(actor, id.data, {
			name,
			description: description === "" ? null : description,
			shared: form.get("shared") !== null,
			sharedProjectIds:
				form.get("sharedProjectIdsChanged") === null
					? undefined
					: form.getAll("sharedProjectIds").map((value) => String(value)),
			sharedGroupIds:
				form.get("sharedGroupIdsChanged") === null
					? undefined
					: form.getAll("sharedGroupIds").map((value) => String(value)),
		});
		return { saved: true };
	}),
} satisfies Actions;
