import { endpoint } from "#lib/server/http.ts";
import { resolutionsResponse } from "#lib/server/issues/schemas.ts";
import { listResolutions } from "#lib/server/issues/service.ts";

export const GET = endpoint({ response: resolutionsResponse }, async () =>
	listResolutions(),
);
