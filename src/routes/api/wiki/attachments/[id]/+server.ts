import { endpoint } from "#lib/server/http.ts";
import {
	attachmentDownloadParams,
	attachmentInlineQuery,
	attachmentParams,
} from "#lib/server/wiki/schemas.ts";
import {
	attachmentDownload,
	deleteAttachment,
} from "#lib/server/wiki/service.ts";
import { fileResponse } from "../../download.ts";

export const GET = endpoint(
	{ params: attachmentDownloadParams, query: attachmentInlineQuery },
	async ({ actor, params, query }) =>
		fileResponse(await attachmentDownload(actor, params.id, query.inline), {
			size: true,
			caching: true,
		}),
);

export const DELETE = endpoint(
	{ params: attachmentParams },
	async ({ actor, params }) => {
		await deleteAttachment(actor, params.id);
		return { status: 204 };
	},
);
