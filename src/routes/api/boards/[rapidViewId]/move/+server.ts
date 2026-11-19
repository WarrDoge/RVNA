import { trackBoardMove } from "#lib/server/agile/pending.ts";
import {
	boardParams,
	moveBody,
	moveResponse,
} from "#lib/server/agile/schemas.ts";
import { moveIssues } from "#lib/server/agile/service.ts";
import { endpoint } from "#lib/server/http.ts";

const move = endpoint(
	{
		params: boardParams,
		body: moveBody,
		response: moveResponse,
	},
	async ({ actor, params, body }) =>
		moveIssues(actor, params.rapidViewId, body),
);

export const POST = (event: Parameters<typeof move>[0]) =>
	trackBoardMove(
		Number(event.params.rapidViewId),
		Promise.resolve(move(event)),
	);
