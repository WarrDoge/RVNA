import { fail, redirect } from "@sveltejs/kit";
import { boardCreateBody } from "#lib/server/agile/schemas.ts";
import { createBoard, listBoards } from "#lib/server/agile/service.ts";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import { listProjects } from "#lib/server/projects/service.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	event.depends("app:boards");
	const [boards, projects] = await Promise.all([
		listBoards(actor),
		listProjects(actor),
	]);
	const keys = projects.map((project) => ({
		key: project.key,
		name: project.name,
	}));
	const requested = event.url.searchParams.get("project")?.toUpperCase() ?? "";
	return {
		boards,
		projects: keys,
		defaultProject: keys.some((project) => project.key === requested)
			? requested
			: "",
	};
}) satisfies PageServerLoad;

export const actions = {
	default: pageAction(async ({ form }, actor) => {
		if (String(form.get("intent") ?? "") !== "create") {
			return fail(400, { error: "Unknown action" });
		}
		const parsed = boardCreateBody.safeParse({
			name: form.get("name"),
			type: form.get("type"),
			filterJql: form.get("filterJql"),
			project: form.get("project"),
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid board",
			});
		}
		const board = await createBoard(actor, parsed.data);
		redirect(303, `/secure/RapidBoard.jspa?rapidView=${board.rapidViewId}`);
	}),
} satisfies Actions;
