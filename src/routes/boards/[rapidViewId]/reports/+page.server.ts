import type { EstimationField } from "#lib/api-types.ts";
import {
	defaultSprintId,
	isEstimationField,
	isReportChart,
	type ReportChart,
} from "#lib/boards/reports.ts";
import { getBoard } from "#lib/server/agile/service.ts";
import { boardRef, loadBoardSidebar } from "#lib/server/boards/sidebar.ts";
import { isHttpError } from "#lib/server/http.ts";
import { pageLoad } from "#lib/server/http-svelte.ts";
import {
	burndownReport,
	cumulativeFlowReport,
	listBoardSprintReports,
	sprintReport,
	velocityReport,
} from "#lib/server/reports/service.ts";
import type { PageServerLoad } from "./$types";

function notFound(error: unknown) {
	return isHttpError(error) && error.status === 404;
}

export const load = pageLoad(async (event, actor) => {
	const rapidViewId = Number(event.params.rapidViewId);
	if (!Number.isInteger(rapidViewId) || rapidViewId <= 0) {
		return {
			missing: true as const,
			board: null,
			sidebar: null,
			sprints: [],
			chart: "burndownChart" as ReportChart,
			estimation: "story_points" as EstimationField,
			selectedSprintId: null,
			burndown: null,
			sprintReport: null,
			velocity: null,
			flow: null,
			reportError: null,
		};
	}

	let board: Awaited<ReturnType<typeof getBoard>>;
	try {
		board = await getBoard(actor, rapidViewId);
	} catch (error) {
		if (notFound(error)) {
			return {
				missing: true as const,
				board: null,
				sidebar: null,
				sprints: [],
				chart: "burndownChart" as ReportChart,
				estimation: "story_points" as EstimationField,
				selectedSprintId: null,
				burndown: null,
				sprintReport: null,
				velocity: null,
				flow: null,
				reportError: null,
			};
		}
		throw error;
	}

	event.depends("app:reports");

	const search = event.url.searchParams;
	const requestedChart = search.get("chart") ?? undefined;
	const requestedEstimation = search.get("estimation") ?? undefined;
	const fallbackChart: ReportChart =
		board.type === "kanban" ? "cumulativeFlowDiagram" : "burndownChart";
	const initialChart = isReportChart(requestedChart)
		? requestedChart
		: fallbackChart;
	const chart: ReportChart =
		board.type === "kanban" && initialChart !== "cumulativeFlowDiagram"
			? "cumulativeFlowDiagram"
			: initialChart;
	const estimation: EstimationField = isEstimationField(requestedEstimation)
		? requestedEstimation
		: (board.estimationField ?? "story_points");

	const ref = boardRef(board);
	const [sprintsPayload, sidebar] = await Promise.all([
		listBoardSprintReports(actor, rapidViewId),
		loadBoardSidebar(actor, ref),
	]);
	const sprints = sprintsPayload.sprints;
	const requestedSprint = search.get("sprint");
	const validSprint =
		requestedSprint && sprints.some((sprint) => sprint.id === requestedSprint)
			? requestedSprint
			: undefined;
	let selectedSprintId = validSprint ?? defaultSprintId(sprints, chart) ?? null;

	let burndown: Awaited<ReturnType<typeof burndownReport>> | null = null;
	let sprint: Awaited<ReturnType<typeof sprintReport>> | null = null;
	let velocity: Awaited<ReturnType<typeof velocityReport>> | null = null;
	let flow: Awaited<ReturnType<typeof cumulativeFlowReport>> | null = null;
	let reportError: string | null = null;

	try {
		if (chart === "cumulativeFlowDiagram") {
			flow = await cumulativeFlowReport(actor, rapidViewId, {
				from: search.get("from") ?? undefined,
				to: search.get("to") ?? undefined,
				assignee: search.get("assignee") ?? undefined,
			});
		} else if (chart === "velocityChart") {
			velocity = await velocityReport(actor, rapidViewId, { estimation });
		} else if (sprints.length > 0) {
			const query = { sprintId: validSprint, estimation };
			if (chart === "burndownChart") {
				burndown = await burndownReport(actor, rapidViewId, query);
				selectedSprintId = burndown.sprint.id;
			} else {
				sprint = await sprintReport(actor, rapidViewId, query);
				selectedSprintId = sprint.sprint.id;
			}
		}
	} catch (error) {
		if (isHttpError(error)) reportError = error.message;
		else throw error;
	}

	return {
		missing: false as const,
		board: ref,
		sidebar,
		sprints,
		chart,
		estimation,
		selectedSprintId,
		burndown,
		sprintReport: sprint,
		velocity,
		flow,
		reportError,
	};
}) satisfies PageServerLoad;
