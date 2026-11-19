import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import { boardParams } from "#lib/server/reports/schemas.ts";
import { listBoardSprintReports } from "#lib/server/reports/service.ts";

export const GET = endpoint(
	{ params: boardParams, response: z.any() },
	async ({ actor, params }) =>
		listBoardSprintReports(actor, params.rapidViewId),
);
