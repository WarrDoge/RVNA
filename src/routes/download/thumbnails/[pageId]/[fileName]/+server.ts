import { endpoint } from "#lib/server/http.ts";
import { downloadParams } from "#lib/server/wiki/schemas.ts";
import { thumbnailDownload } from "#lib/server/wiki/service.ts";
import { downloadActor, fileResponse } from "../../../../api/wiki/download.ts";

export const GET = endpoint(
	{ auth: "none", params: downloadParams },
	async ({ event, params }) => {
		const actor = downloadActor(event);
		if (actor instanceof Response) return actor;
		return fileResponse(
			await thumbnailDownload(actor, params.pageId, params.fileName),
			{ size: false, caching: true },
		);
	},
);
