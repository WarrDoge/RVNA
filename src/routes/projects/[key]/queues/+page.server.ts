import { redirect } from "@sveltejs/kit";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { deskQueues } from "#lib/server/servicedesk/service.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	const { queues } = await deskQueues(actor, event.params.key);
	const first = queues.find((queue) => queue.parentId === null) ?? queues[0];
	if (!first) return { empty: true };
	redirect(307, `/projects/${event.params.key}/queues/custom/${first.id}`);
}) satisfies PageServerLoad;
