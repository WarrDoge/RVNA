import { type GetOnlyClient, GetOnlyRequestError } from "./client.ts";
import { type PrivateApiOptions, skipPrivateApi } from "./private-apis.ts";

export interface JiraGadgetPref {
	name: string;
	value: string;
}

export interface JiraDashboardGadget {
	id: string;
	title: string;
	column: number;
	color: string;
	userPrefs: { fields: JiraGadgetPref[] };
}

export interface JiraDashboard {
	id: string;
	title: string;
	layout: string;
	gadgets: JiraDashboardGadget[];
}

export interface JiraFilterOwner {
	name: string;
	key?: string;
	displayName?: string;
}

export interface JiraSharePermission {
	type: string;
	project?: { id?: string; key?: string };
	group?: { name?: string };
	role?: { id?: string; name?: string };
}

export interface JiraFilter {
	id: string;
	name: string;
	description?: string | null;
	jql: string;
	owner: JiraFilterOwner;
	sharePermissions?: JiraSharePermission[];
	favourite?: boolean;
}

export interface DashboardDataset {
	/** The Jira user the token belongs to; Jira does not say who owns a dashboard. */
	owner: string;
	dashboards: JiraDashboard[];
	filters: JiraFilter[];
	favouriteFilters: string[];
	favouriteDashboards: string[];
}

const FILTER_ID = /(?:entityId|filterId)"?\s*(?:value|href)?="?(\d+)/g;
const FILTER_LINK = /[?&]filter(?:Id)?=(\d+)/g;
const DASHBOARD_PAGE_SIZE = 100;
const MAX_DASHBOARD_PAGES = 1000;

interface DashboardSummary {
	id: string;
	name?: string;
}

async function listDashboards(
	client: GetOnlyClient,
	params: Record<string, string | number | boolean | undefined> = {},
) {
	const dashboards: DashboardSummary[] = [];
	let startAt = 0;
	for (let page = 0; page < MAX_DASHBOARD_PAGES; page++) {
		const response = await client.getJson<{
			dashboards?: DashboardSummary[];
			total?: number;
		}>("/rest/api/2/dashboard", {
			...params,
			startAt,
			maxResults: DASHBOARD_PAGE_SIZE,
		});
		const batch = response.dashboards ?? [];
		dashboards.push(...batch);
		if (batch.length === 0) break;
		if (response.total !== undefined) {
			if (dashboards.length >= response.total) break;
		} else if (batch.length < DASHBOARD_PAGE_SIZE) {
			break;
		}
		startAt += batch.length;
	}
	return dashboards;
}

export function prefs(gadget: JiraDashboardGadget) {
	const result: Record<string, string> = {};
	for (const field of gadget.userPrefs?.fields ?? []) {
		result[field.name] = field.value;
	}
	return result;
}

export function decode(value: string | null) {
	if (value === null) return null;
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

async function filterIds(client: GetOnlyClient) {
	const ids = new Set<string>();
	const pages = await Promise.all(
		["popular", "my", "favourites"].map(async (view) => {
			const response = await client.request(
				"GET",
				"/secure/ManageFilters.jspa",
				{ filterView: view },
				{ headers: { Accept: "text/html" } },
			);
			return response.text();
		}),
	);
	for (const html of pages) {
		for (const match of html.matchAll(FILTER_ID)) {
			if (match[1]) ids.add(match[1]);
		}
		for (const match of html.matchAll(FILTER_LINK)) {
			if (match[1]) ids.add(match[1]);
		}
	}
	return ids;
}

export async function fetchDashboardDataset(
	client: GetOnlyClient,
	options: PrivateApiOptions = {},
): Promise<DashboardDataset> {
	if (skipPrivateApi(options, "dashboards")) {
		return {
			owner: "",
			dashboards: [],
			filters: [],
			favouriteFilters: [],
			favouriteDashboards: [],
		};
	}
	const myself = await client.getJson<{ name?: string; displayName?: string }>(
		"/rest/api/2/myself",
	);
	const owner = myself.name ?? myself.displayName ?? "admin";

	const listed = await listDashboards(client);

	const dashboards = (
		await Promise.all(
			listed.map(async (summary) => {
				try {
					const dashboard = await client.getJson<{
						id: string;
						title: string;
						layout: string;
						gadgets?: JiraDashboardGadget[];
					}>(`/rest/dashboards/1.0/${summary.id}`);
					return {
						id: String(dashboard.id ?? summary.id),
						title: dashboard.title ?? summary.name ?? "",
						layout: dashboard.layout ?? "AA",
						gadgets: (dashboard.gadgets ?? []).map((gadget) => ({
							id: String(gadget.id),
							title: gadget.title ?? "",
							column: Number(gadget.column ?? 0),
							color: gadget.color ?? "color1",
							userPrefs: { fields: gadget.userPrefs?.fields ?? [] },
						})),
					} satisfies JiraDashboard;
				} catch (error) {
					if (
						error instanceof GetOnlyRequestError &&
						(error.status === 403 || error.status === 404)
					) {
						return null;
					}
					throw error;
				}
			}),
		)
	).filter((dashboard): dashboard is JiraDashboard => dashboard !== null);

	const favourites = await client.getJson<JiraFilter[]>(
		"/rest/api/2/filter/favourite",
	);
	const favouriteFilters = favourites.map((filter) => String(filter.id));

	const favouriteDashboards = (
		await listDashboards(client, { filter: "favourite" })
	).map((dashboard) => String(dashboard.id));

	const referenced = new Set<string>();
	for (const dashboard of dashboards) {
		for (const gadget of dashboard.gadgets) {
			const scope = prefs(gadget).projectOrFilterId ?? null;
			const match = scope?.match(/^filter-(\d+)$/);
			if (match?.[1]) referenced.add(match[1]);
		}
	}

	const ids = await filterIds(client);
	for (const id of referenced) ids.add(id);
	for (const id of favouriteFilters) ids.add(id);

	const filters = (
		await Promise.all(
			[...ids].sort().map(async (id) => {
				try {
					return await client.getJson<JiraFilter>(`/rest/api/2/filter/${id}`);
				} catch (error) {
					if (error instanceof GetOnlyRequestError && error.status === 404) {
						return null;
					}
					throw error;
				}
			}),
		)
	).filter((filter): filter is JiraFilter => filter !== null);

	return { owner, dashboards, filters, favouriteFilters, favouriteDashboards };
}
