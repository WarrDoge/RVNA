import { endpoint } from "#lib/server/http.ts";
import {
	attachmentByNameSchema,
	attachmentNameParams,
} from "#lib/server/wiki/schemas.ts";
import { getPageAttachmentByName } from "#lib/server/wiki/service.ts";

export const GET = endpoint(
	{ params: attachmentNameParams, response: attachmentByNameSchema },
	async ({ actor, params }) =>
		getPageAttachmentByName(actor, params.id, params.name),
);
