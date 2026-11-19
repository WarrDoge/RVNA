import { fail } from "@sveltejs/kit";
import { z } from "zod";
import {
	boardSprintSummary,
	completeSprint,
	getBoardData,
} from "#lib/server/agile/service.ts";
import { loadBoardSidebar } from "#lib/server/boards/sidebar.ts";
import { isHttpError } from "#lib/server/http.ts";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import { loadIssueView } from "#lib/server/issues/view.ts";
import type { Actions, PageServerLoad } from "./$types";

function rapidViewId(value: string) {
	const id = Number(value);
	return Number.isInteger(id) && id > 0 ? id : 0;
}

function boardFilters(url: URL) {
	const value = (name: string) =>
		url.searchParams.get(name)?.trim() || undefined;
	return {
		quickFilter: value("quickFilter"),
		text: value("text"),
		assignee: value("assignee"),
	};
}

const missing = {
	missing: true as const,
	data: null,
	sidebar: null,
	selectedIssue: null,
	sprintSummary: null,
};

export const load = pageLoad(async (event, actor) => {
	event.depends("app:board");

	const id = rapidViewId(event.params.rapidViewId);
	if (!id) return missing;

	const selectedKey =
		event.url.searchParams.get("selectedIssue")?.trim().toUpperCase() || null;
	if (selectedKey) event.depends(`app:issue:${selectedKey}`);
	const selectedIssue = selectedKey
		? loadIssueView(actor, selectedKey).catch((cause) => {
				if (isHttpError(cause) && cause.status === 404) return null;
				throw cause;
			})
		: Promise.resolve(null);

	let data: Awaited<ReturnType<typeof getBoardData>>;
	let sprintSummary: Awaited<ReturnType<typeof boardSprintSummary>>;
	try {
		[data, sprintSummary] = await Promise.all([
			getBoardData(actor, id, boardFilters(event.url)),
			boardSprintSummary(actor, id),
			selectedIssue,
		]);
	} catch (cause) {
		if (isHttpError(cause) && cause.status === 404) return missing;
		throw cause;
	}

	const [sidebar, issue] = await Promise.all([
		loadBoardSidebar(actor, data.board),
		selectedIssue,
	]);

	return {
		missing: false as const,
		data,
		sidebar,
		selectedIssue: issue,
		sprintSummary,
	};
}) satisfies PageServerLoad;

const completeSprintForm = z.object({
	sprintId: z.uuid(),
	moveToSprintId: z.uuid().nullable(),
});

export const actions = {
	completeSprint: pageAction(async ({ form }, actor) => {
		const target = String(form.get("moveToSprintId") ?? "backlog");
		const parsed = completeSprintForm.safeParse({
			sprintId: form.get("sprintId"),
			moveToSprintId: target === "backlog" ? null : target,
		});
		if (!parsed.success) {
			return fail(400, { error: "Invalid sprint" });
		}
		return completeSprint(actor, parsed.data.sprintId, {
			moveToSprintId: parsed.data.moveToSprintId,
		});
	}),
} satisfies Actions;
