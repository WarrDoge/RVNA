import { fail } from "@sveltejs/kit";
import { z } from "zod";
import type { BacklogData } from "#lib/api-types.ts";
import {
	backlogDataSchema,
	searchQuery,
	sprintCreateBody,
	sprintPatchBody,
	sprintStartBody,
} from "#lib/server/agile/schemas.ts";
import {
	canManageBoard,
	createSprint,
	deleteSprint,
	getBacklog,
	getBacklogAssignees,
	startSprint,
	updateSprint,
} from "#lib/server/agile/service.ts";
import { loadBoardSidebar } from "#lib/server/boards/sidebar.ts";
import { HttpError, isHttpError } from "#lib/server/http.ts";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import { loadIssueView } from "#lib/server/issues/view.ts";
import type { Actions, PageServerLoad } from "./$types";
import type { BacklogPageData } from "./types.ts";

function rapidViewIdOf(value: string) {
	const rapidViewId = Number(value);
	if (!Number.isInteger(rapidViewId) || rapidViewId <= 0) {
		throw new HttpError(404, "Board not found");
	}
	return rapidViewId;
}

const missing = {
	missing: true as const,
	backlog: null,
	sidebar: null,
	issue: null,
	selectedIssue: null,
};

function pageBoard(board: BacklogData["board"]): BacklogPageData["board"] {
	const quickFilters = board.quickFilters.map(({ id, name, sequence }) => ({
		id,
		name,
		sequence,
	}));
	return {
		id: board.id,
		rapidViewId: board.rapidViewId,
		name: board.name,
		type: board.type,
		project: board.project,
		owner: board.owner,
		configImported: board.configImported,
		estimationField: board.estimationField,
		swimlaneStrategy: board.swimlaneStrategy,
		cardColourStrategy: board.cardColourStrategy,
		kanbanBacklogStatus: board.kanbanBacklogStatus,
		columns: board.columns,
		availableStatuses: board.availableStatuses,
		quickFilters,
	};
}

function pageBacklog(
	backlog: BacklogData,
): Omit<BacklogPageData, "sprintPermissions"> {
	const quickFilters = backlog.quickFilters.map(({ id, name, sequence }) => ({
		id,
		name,
		sequence,
	}));
	return {
		...backlog,
		board: pageBoard(backlog.board),
		quickFilters,
	};
}

type DateResult =
	| { value: string | null | undefined; error?: undefined }
	| { value?: undefined; error: string };

function optionalDate(form: FormData, name: string): DateResult {
	if (!form.has(name)) return { value: undefined };
	const raw = String(form.get(name) ?? "").trim();
	if (raw === "") return { value: null };
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) {
		return { error: "Enter a valid date" };
	}
	return { value: date.toISOString() };
}

export const load = pageLoad(async (event, actor) => {
	const rapidViewId = Number(event.params.rapidViewId);
	if (!Number.isInteger(rapidViewId) || rapidViewId <= 0) return missing;
	const query = searchQuery.safeParse({
		quickFilter: event.url.searchParams.get("quickFilter") ?? undefined,
		text: event.url.searchParams.get("text") ?? undefined,
		epic: event.url.searchParams.get("epic") ?? undefined,
		version: event.url.searchParams.get("version") ?? undefined,
		assignee: event.url.searchParams.get("assignee") ?? undefined,
	});
	if (!query.success) {
		throw new HttpError(400, "Invalid search");
	}
	const selectedIssue =
		event.url.searchParams.get("selectedIssue")?.trim().toUpperCase() || null;

	event.depends("app:board-backlog");
	if (selectedIssue) event.depends(`app:issue:${selectedIssue}`);

	const issue = selectedIssue
		? loadIssueView(actor, selectedIssue).catch((cause) => {
				if (isHttpError(cause) && cause.status === 404) return null;
				throw cause;
			})
		: Promise.resolve(null);

	let rawBacklog: BacklogData;
	try {
		rawBacklog = backlogDataSchema.parse(
			await getBacklog(actor, rapidViewId, query.data),
		);
	} catch (cause) {
		if (isHttpError(cause) && cause.status === 404) return missing;
		throw cause;
	}
	const backlog = pageBacklog(rawBacklog);
	const permissionBoard = {
		ownerId: backlog.board.owner?.id ?? null,
		projectId: backlog.board.project?.id ?? null,
	};
	const [managesSprints, editsSprintText, startsStopsSprints] =
		await Promise.all([
			canManageBoard(permissionBoard, actor, "MANAGE_SPRINTS_PERMISSION"),
			canManageBoard(
				permissionBoard,
				actor,
				"EDIT_SPRINT_NAME_AND_GOAL_PERMISSION",
			),
			canManageBoard(permissionBoard, actor, "START_STOP_SPRINTS_PERMISSION"),
		]);
	const [assignees, sidebar] = await Promise.all([
		getBacklogAssignees(actor, rapidViewId),
		loadBoardSidebar(actor, backlog.board),
	]);

	return {
		missing: false as const,
		backlog,
		assignees,
		sidebar,
		sprintPermissions: {
			manage: managesSprints,
			editText: managesSprints || editsSprintText,
			startStop: managesSprints || startsStopsSprints,
		},
		issue: await issue,
		selectedIssue,
	};
}) satisfies PageServerLoad;

export const actions = {
	createSprint: pageAction(async ({ event, form }, actor) => {
		const rapidViewId = rapidViewIdOf(event.params.rapidViewId);
		const goal = String(form.get("goal") ?? "").trim();
		const parsed = sprintCreateBody.safeParse({
			name: form.get("name"),
			goal: goal === "" ? null : goal,
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid sprint",
			});
		}
		await createSprint(actor, rapidViewId, parsed.data);
		return { created: true };
	}),

	editSprint: pageAction(async ({ form }, actor) => {
		const id = z.uuid().safeParse(form.get("sprintId"));
		if (!id.success) return fail(400, { error: "Invalid sprint" });
		const start = optionalDate(form, "startDate");
		const end = optionalDate(form, "endDate");
		if (start.error || end.error) {
			return fail(400, { error: start.error ?? end.error });
		}
		const goal = String(form.get("goal") ?? "").trim();
		const parsed = sprintPatchBody.safeParse({
			name: form.get("name"),
			goal: goal === "" ? null : goal,
			...(start.value !== undefined ? { startDate: start.value } : {}),
			...(end.value !== undefined ? { endDate: end.value } : {}),
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid sprint",
			});
		}
		await updateSprint(actor, id.data, parsed.data);
		return { saved: true };
	}),

	startSprint: pageAction(async ({ form }, actor) => {
		const id = z.uuid().safeParse(form.get("sprintId"));
		if (!id.success) return fail(400, { error: "Invalid sprint" });
		const start = optionalDate(form, "startDate");
		const end = optionalDate(form, "endDate");
		if (start.error || end.error) {
			return fail(400, { error: start.error ?? end.error });
		}
		if (!start.value || !end.value) {
			return fail(400, { error: "Enter a start and end date" });
		}
		const goal = String(form.get("goal") ?? "").trim();
		const name = String(form.get("name") ?? "").trim();
		const parsed = sprintStartBody.safeParse({
			name: name === "" ? undefined : name,
			startDate: start.value,
			endDate: end.value,
			goal: goal === "" ? null : goal,
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid sprint",
			});
		}
		await startSprint(actor, id.data, parsed.data);
		return { started: true };
	}),

	deleteSprint: pageAction(async ({ form }, actor) => {
		const id = z.uuid().safeParse(form.get("sprintId"));
		if (!id.success) return fail(400, { error: "Invalid sprint" });
		await deleteSprint(actor, id.data);
		return { deleted: true };
	}),
} satisfies Actions;
