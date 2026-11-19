import { pageLoad } from "#lib/server/http-svelte.ts";
import { listMyRequests } from "#lib/server/servicedesk/service.ts";
import type { PageServerLoad } from "./$types";

type StatusFilter = "open" | "closed" | "all";
type ScopeFilter = "all" | "created" | "participating";

function statusFilter(value: string | null): StatusFilter {
	return value === "closed" || value === "all" ? value : "open";
}

function scopeFilter(value: string | null): ScopeFilter {
	return value === "created" || value === "participating" ? value : "all";
}

export const load = pageLoad(async (event, actor) => {
	event.depends("app:portal");
	const status = statusFilter(event.url.searchParams.get("status"));
	const scope = scopeFilter(event.url.searchParams.get("scope"));
	const query = event.url.searchParams.get("q") ?? "";
	const { requests, total } = await listMyRequests(actor, {
		status,
		scope,
		query: query.trim(),
	});
	return { requests, total, filters: { status, scope, query } };
}) satisfies PageServerLoad;
