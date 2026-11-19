import { endpoint } from "#lib/server/http.ts";
import { downloadParams, downloadQuery } from "#lib/server/wiki/schemas.ts";
import { attachmentDownloadByName } from "#lib/server/wiki/service.ts";
import { downloadActor, fileResponse } from "../../../../api/wiki/download.ts";

export const GET = endpoint(
	{ auth: "none", params: downloadParams, query: downloadQuery },
	async ({ event, params, query }) => {
		const actor = downloadActor(event);
		if (actor instanceof Response) return actor;
		return fileResponse(
			await attachmentDownloadByName(
				actor,
				params.pageId,
				params.fileName,
				query,
			),
			{ size: true, caching: true },
		);
	},
);
