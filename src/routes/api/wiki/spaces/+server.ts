import { z } from "zod";
import { endpoint } from "#lib/server/http.ts";
import {
	spaceListQuery,
	spaceSummarySchema,
} from "#lib/server/wiki/schemas.ts";
import { listSpaces } from "#lib/server/wiki/service.ts";
import { wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { createSpace, createSpaceBody } from "#lib/server/wiki-edit/spaces.ts";

export const GET = endpoint(
	{ query: spaceListQuery, response: z.array(spaceSummarySchema) },
	async ({ actor, query }) => listSpaces(actor, query),
);

export const POST = endpoint(
	{ validationError: wikiValidationError, body: createSpaceBody },
	async ({ actor, body }) => ({
		status: 201,
		body: await createSpace(actor, body),
	}),
);
