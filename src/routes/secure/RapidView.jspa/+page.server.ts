import { fail } from "@sveltejs/kit";
import { z } from "zod";
import { boardPatchBody, swimlanesBody } from "#lib/server/agile/schemas.ts";
import {
	canManageBoard,
	getBoard,
	updateBoard,
	updateBoardSwimlanes,
} from "#lib/server/agile/service.ts";
import { isHttpError } from "#lib/server/http.ts";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

const tabs = [
	"general",
	"columns",
	"swimlanes",
	"quick-filters",
	"card-colours",
	"estimation",
] as const;

type TabId = (typeof tabs)[number];

function asTab(value: string | null): TabId {
	return tabs.includes(value as TabId) ? (value as TabId) : "general";
}

const rapidViewSchema = z.coerce.number().int().positive();
const swimlaneStrategySchema = z.enum(["none", "assignee", "epic", "queries"]);

export const load = pageLoad(async (event, actor) => {
	const tab = asTab(event.url.searchParams.get("tab"));
	const rapidViewParam = event.url.searchParams.get("rapidView");
	const parsed = rapidViewSchema.safeParse(rapidViewParam);
	event.depends("app:board");

	if (!parsed.success) {
		return { board: null, tab, canEdit: false };
	}

	try {
		const board = await getBoard(actor, parsed.data);
		return {
			board,
			tab,
			canEdit: await canManageBoard(
				{
					ownerId: board.owner?.id ?? null,
					projectId: board.project?.id ?? null,
				},
				actor,
				"ADMINISTER_PROJECTS",
			),
		};
	} catch (cause) {
		if (isHttpError(cause) && (cause.status === 403 || cause.status === 404)) {
			return { board: null, tab, canEdit: false };
		}
		throw cause;
	}
}) satisfies PageServerLoad;

function validationError(error: z.ZodError) {
	return fail(400, {
		error: error.issues[0]?.message ?? "Invalid board configuration",
	});
}

export const actions = {
	default: pageAction(async ({ form }, actor) => {
		const intent = String(form.get("intent") ?? "");
		const rapidView = rapidViewSchema.safeParse(form.get("rapidView"));
		if (!rapidView.success) {
			return fail(400, { error: "Board not found" });
		}

		if (intent === "general") {
			const subFilterJql = String(form.get("subFilterJql") ?? "").trim();
			const backlogStatus = String(form.get("kanbanBacklogStatusId") ?? "");
			const parsed = boardPatchBody.safeParse({
				name: String(form.get("name") ?? ""),
				filterJql: String(form.get("filterJql") ?? ""),
				subFilterJql: subFilterJql === "" ? null : subFilterJql,
				kanbanBacklogStatusId: backlogStatus === "" ? null : backlogStatus,
			});
			if (!parsed.success) return validationError(parsed.error);

			await updateBoard(actor, rapidView.data, parsed.data);
			return { saved: true };
		}

		if (intent === "cardColours") {
			const parsed = boardPatchBody.safeParse({
				cardColourStrategy: form.get("cardColourStrategy"),
			});
			if (!parsed.success) return validationError(parsed.error);

			await updateBoard(actor, rapidView.data, parsed.data);
			return { saved: true };
		}

		if (intent === "swimlanes") {
			const strategy = swimlaneStrategySchema.safeParse(
				form.get("swimlaneStrategy"),
			);
			const names = form.getAll("laneName").map(String);
			const jqls = form.getAll("laneJql").map(String);
			if (!strategy.success || names.length !== jqls.length) {
				return fail(400, { error: "Invalid swimlanes" });
			}
			const parsed = swimlanesBody.safeParse({
				swimlanes: names.map((name, index) => ({
					name: name.trim(),
					jql: jqls[index].trim(),
				})),
			});
			if (!parsed.success) return validationError(parsed.error);
			await updateBoardSwimlanes(actor, rapidView.data, {
				swimlaneStrategy: strategy.data,
				swimlanes: parsed.data.swimlanes,
			});
			return { saved: true };
		}

		if (intent === "estimation") {
			const parsed = boardPatchBody.safeParse({
				estimationField: form.get("estimationField"),
			});
			if (!parsed.success) return validationError(parsed.error);

			await updateBoard(actor, rapidView.data, parsed.data);
			return { saved: true };
		}

		return fail(400, { error: "Unknown action" });
	}),
} satisfies Actions;
