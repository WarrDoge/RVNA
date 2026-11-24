import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import type { CurrentUser } from "#lib/server/auth.ts";
import {
	bodySchema,
	createFilter,
	filterParams,
	filterPatchSchema,
	getFilter,
	listFilters,
	updateFilter,
} from "#lib/server/filters/service.ts";
import { isHttpError } from "#lib/server/http.ts";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import { loadIssueView } from "#lib/server/issues/view.ts";
import { issueFilter } from "#lib/server/legacy/service.ts";
import { me } from "#lib/server/me/service.ts";
import {
	getNavigatorPreferences,
	issueFields,
	navigatorPage,
	recentIssues,
} from "#lib/server/navigator/service.ts";
import { offsetParam } from "#lib/server/paging.ts";
import { listProjects } from "#lib/server/projects/service.ts";
import type { Actions, PageServerLoad } from "./$types";
import {
	DEFAULT_JQL,
	normalizeNavigatorColumns,
	PAGE_SIZE,
	recentJql,
} from "./navigator.ts";

function columnsOf(value: string | null) {
	return (value ?? "").split(",").filter((column) => column !== "");
}

/** A filter the viewer cannot see is not an error on the navigator. */
async function visibleFilter(actor: CurrentUser, id: string) {
	try {
		return await getFilter(actor, id);
	} catch (cause) {
		if (isHttpError(cause) && cause.status === 404) return null;
		throw cause;
	}
}

export const load = pageLoad(async (event, actor) => {
	event.depends("app:navigator");

	const params = event.url.searchParams;
	const filterParam = params.get("filter");
	const filterId =
		filterParam && z.uuid().safeParse(filterParam).success ? filterParam : null;

	if (filterParam && !filterId) {
		// Jira bookmarks name a filter by its imported source id.
		const outcome = await issueFilter(actor, {
			filter: filterParam,
			search: event.url.search,
		});
		if (outcome.kind === "redirect") redirect(302, outcome.location);
	}

	const [filter, preferences, customFields, projects, favourites, meView] =
		await Promise.all([
			filterId ? visibleFilter(actor, filterId) : null,
			getNavigatorPreferences(actor),
			issueFields(actor),
			listProjects(actor),
			listFilters(actor, { scope: "favourite", query: "" }),
			me(actor),
		]);

	const recent =
		params.get("recent") === "1" &&
		!params.get("jql") &&
		!params.get("jqlQuery");
	const filterColumns =
		filter && filter.columns.length > 0
			? normalizeNavigatorColumns(filter.columns, customFields)
			: [];
	const columns =
		filterColumns.length > 0
			? filterColumns
			: normalizeNavigatorColumns(preferences.columns, customFields);
	const appliedJql = recent
		? recentJql(
				(await recentIssues(actor, 50)).issues.map((issue) => issue.key),
			)
		: params.get("jql") || params.get("jqlQuery") || filter?.jql || DEFAULT_JQL;
	const startAt = offsetParam(params.get("startAt"));
	let page: Awaited<ReturnType<typeof navigatorPage>>;
	let searchError: string | null = null;
	try {
		page = await navigatorPage(actor, {
			jql: appliedJql,
			startAt,
			maxResults: PAGE_SIZE,
			columns,
		});
	} catch (cause) {
		// A query the server rejects is shown under the JQL box; the page is
		// still the navigator, with no results.
		if (!isHttpError(cause) || cause.status !== 400) throw cause;
		searchError = cause.message;
		page = { startAt, maxResults: PAGE_SIZE, total: 0, issues: [] };
	}

	// `reroute` sends `/browse/<KEY>?jql=…` here but leaves `event.url` alone.
	const browseKey = /^\/browse\/([^/]+)$/.exec(event.url.pathname)?.[1];
	const pathKey = browseKey ? decodeURIComponent(browseKey) : null;
	const viewParam = params.get("view");
	const view =
		viewParam === "detail" || viewParam === "list"
			? viewParam
			: pathKey !== null
				? "detail"
				: preferences.view;
	const selectedKey =
		view === "detail"
			? (pathKey ?? params.get("selectedIssue") ?? page.issues[0]?.key ?? null)
			: null;
	// A stale or inaccessible selected issue leaves the list in place and shows an error in the pane.
	const issueView = selectedKey
		? await loadIssueView(actor, selectedKey).catch((cause) => {
				if (isHttpError(cause) && cause.status === 404) return null;
				throw cause;
			})
		: null;
	if (issueView) event.depends(`app:issue:${issueView.issue.key}`);

	return {
		me: meView,
		filter,
		preferences,
		customFields,
		projects,
		favourites,
		appliedJql,
		searchError,
		columns,
		page,
		view,
		startAt,
		selectedKey,
		issueView,
	};
}) satisfies PageServerLoad;

export const actions = {
	saveAs: pageAction(async ({ form }, actor) => {
		const description = String(form.get("description") ?? "").trim();
		const parsed = bodySchema.safeParse({
			name: String(form.get("name") ?? ""),
			description: description === "" ? null : description,
			jql: String(form.get("jql") ?? ""),
			columns: columnsOf(form.get("columns")?.toString() ?? null),
			shared: form.get("shared") === "on",
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid filter",
			});
		}
		const filter = await createFilter(actor, parsed.data);
		return { filter };
	}),
	save: pageAction(async ({ form }, actor) => {
		const params = filterParams.safeParse({ id: String(form.get("id") ?? "") });
		if (!params.success) return fail(404, { error: "Filter not found" });

		const parsed = filterPatchSchema.safeParse({
			jql: String(form.get("jql") ?? ""),
			columns: columnsOf(form.get("columns")?.toString() ?? null),
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid filter",
			});
		}
		const filter = await updateFilter(actor, params.data.id, parsed.data);
		return { filter };
	}),
} satisfies Actions;
