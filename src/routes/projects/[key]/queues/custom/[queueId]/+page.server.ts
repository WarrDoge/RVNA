import { error } from "@sveltejs/kit";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { loadProjectSidebar } from "#lib/server/projects/sidebar.ts";
import { queueParams } from "#lib/server/servicedesk/schemas.ts";
import { deskQueue } from "#lib/server/servicedesk/service.ts";
import { clampStartAt, queuePageSize } from "../../queue.ts";
import type { PageServerLoad } from "./$types";

function startAtFrom(value: string | null) {
	const parsed = Number.parseInt(value ?? "0", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export const load = pageLoad(async (event, actor) => {
	event.depends("app:queues");
	if (!queueParams.safeParse(event.params).success) {
		error(404, "Queue not found");
	}
	let startAt = startAtFrom(event.url.searchParams.get("startAt"));
	const fetchPage = (offset: number) =>
		deskQueue(actor, event.params.key, event.params.queueId, {
			startAt: offset,
			maxResults: queuePageSize,
		});
	const [sidebar, page] = await Promise.all([
		loadProjectSidebar(actor, event.params.key),
		fetchPage(startAt).then(async (first) => {
			const clamped = clampStartAt(startAt, first.total);
			if (clamped === startAt) return first;
			startAt = clamped;
			return fetchPage(clamped);
		}),
	]);

	return { sidebar, page, startAt };
}) satisfies PageServerLoad;
