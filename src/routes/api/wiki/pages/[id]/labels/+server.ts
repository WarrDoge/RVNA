import { z } from "zod";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	addLabelBody,
	labelSchema,
	pageParams,
} from "#lib/server/wiki/schemas.ts";
import { ensurePageLabel, listPageLabels } from "#lib/server/wiki/service.ts";
import { idParams, wikiValidationError } from "#lib/server/wiki-edit/common.ts";
import { labelsBody, setPageLabels } from "#lib/server/wiki-edit/pages.ts";

export const GET = endpoint(
	{ params: pageParams, response: z.array(labelSchema) },
	async ({ actor, params }) => listPageLabels(actor, params.id),
);

export const POST = endpoint(
	{
		params: pageParams,
		body: addLabelBody,
		response: { 201: labelSchema, 400: errorSchema },
	},
	async ({ actor, params, body }) => {
		const result = await ensurePageLabel(actor, params.id, body.label);
		return result.created ? { status: 201, body: result.label } : result.label;
	},
);

export const PUT = endpoint(
	{ validationError: wikiValidationError, params: idParams, body: labelsBody },
	async ({ actor, params, body }) => setPageLabels(actor, params.id, body),
);
