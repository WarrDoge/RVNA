import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import type { GadgetData } from "#lib/dashboards/types.ts";
import { createBody, patchBody } from "#lib/server/dashboards/schemas.ts";
import {
	createDashboard,
	defaultDashboard,
	getDashboard,
	getGadgetData,
	listDashboards,
	removeDashboard,
	updateDashboard,
} from "#lib/server/dashboards/service.ts";
import { isHttpError } from "#lib/server/http.ts";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export type GadgetDataEntry = { data: GadgetData } | { error: string };

async function gadgetData(
	actor: Parameters<typeof getGadgetData>[0],
	dashboard: Awaited<ReturnType<typeof getDashboard>>,
) {
	const entries = await Promise.all(
		dashboard.gadgets.map(async (gadget) => {
			try {
				return [
					gadget.id,
					{
						data: (await getGadgetData(
							actor,
							gadget.id,
							0,
						)) as unknown as GadgetData,
					},
				] as const;
			} catch (cause) {
				if (!isHttpError(cause)) throw cause;
				return [gadget.id, { error: cause.message }] as const;
			}
		}),
	);
	return Object.fromEntries(entries) as Record<string, GadgetDataEntry>;
}

export const load = pageLoad(async (event, actor) => {
	event.depends("app:dashboard");

	const requested = event.url.searchParams.get("selectPageId") ?? undefined;
	const selectPageId = requested === "" ? undefined : requested;

	// The old page answered a Jira dashboard id with a redirect to its canonical id.
	if (selectPageId && !z.uuid().safeParse(selectPageId).success) {
		try {
			const bySourceId = await getDashboard(actor, selectPageId);
			redirect(302, `/secure/Dashboard.jspa?selectPageId=${bySourceId.id}`);
		} catch (cause) {
			if (!isHttpError(cause) || cause.status !== 404) throw cause;
		}
	}

	const favourites = await listDashboards(actor, {
		scope: "favourite",
		query: "",
	});

	if (selectPageId) {
		let dashboard: Awaited<ReturnType<typeof getDashboard>> | null = null;
		try {
			dashboard = await getDashboard(actor, selectPageId);
		} catch (cause) {
			if (!isHttpError(cause) || cause.status !== 404) throw cause;
		}
		if (!dashboard) {
			return {
				dashboard: null,
				favourites,
				gadgetData: {} as Record<string, GadgetDataEntry>,
				empty: false,
				missing: true,
			};
		}
		return {
			dashboard,
			favourites,
			gadgetData: await gadgetData(actor, dashboard),
			empty: false,
			missing: false,
		};
	}

	const visible = await listDashboards(actor, {
		scope: "visible",
		query: "",
	});
	if (visible.length === 0) {
		return {
			dashboard: null,
			favourites,
			gadgetData: {} as Record<string, GadgetDataEntry>,
			empty: true,
			missing: false,
		};
	}

	let dashboard: Awaited<ReturnType<typeof defaultDashboard>> | null = null;
	try {
		dashboard = await defaultDashboard(actor);
	} catch (cause) {
		if (!isHttpError(cause) || cause.status !== 404) throw cause;
	}
	if (!dashboard) {
		return {
			dashboard: null,
			favourites,
			gadgetData: {} as Record<string, GadgetDataEntry>,
			empty: true,
			missing: false,
		};
	}

	return {
		dashboard,
		favourites,
		gadgetData: await gadgetData(actor, dashboard),
		empty: false,
		missing: false,
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
			redirect(
				303,
				`/secure/Dashboard.jspa?selectPageId=${encodeURIComponent(created.id)}`,
			);
		}

		if (intent === "update") {
			const id = String(form.get("id") ?? "");
			const description = String(form.get("description") ?? "");
			const parsed = patchBody.safeParse({
				name: form.get("name"),
				description: description.trim() === "" ? null : description,
				layout: form.get("layout"),
				shared: form.has("shared"),
			});
			if (!parsed.success) {
				return fail(400, {
					error: parsed.error.issues[0]?.message ?? "Invalid dashboard",
				});
			}
			await updateDashboard(actor, id, parsed.data);
			return { saved: true };
		}

		if (intent === "copy") {
			const parsed = createBody.safeParse({
				name: form.get("name"),
				copyOf: form.get("copyOf"),
			});
			if (!parsed.success) {
				return fail(400, {
					error: parsed.error.issues[0]?.message ?? "Invalid dashboard",
				});
			}
			const created = await createDashboard(actor, parsed.data);
			redirect(
				303,
				`/secure/Dashboard.jspa?selectPageId=${encodeURIComponent(created.id)}`,
			);
		}

		if (intent === "delete") {
			const id = String(form.get("id") ?? "");
			if (id === "") return fail(400, { error: "Invalid dashboard" });
			await removeDashboard(actor, id);
			redirect(303, "/secure/Dashboard.jspa");
		}

		return fail(400, { error: "Unknown action" });
	}),
} satisfies Actions;
