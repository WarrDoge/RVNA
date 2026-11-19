import { endpoint } from "#lib/server/http.ts";
import { linkTypesResponse } from "#lib/server/issues/schemas.ts";
import { listLinkTypes } from "#lib/server/issues/service.ts";

export const GET = endpoint({ response: linkTypesResponse }, async () =>
	listLinkTypes(),
);
