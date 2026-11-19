import { endpoint } from "#lib/server/http.ts";
import { formParams, formSchema } from "#lib/server/servicedesk/schemas.ts";
import { portalRequestTypeForm } from "#lib/server/servicedesk/service.ts";

export const GET = endpoint(
	{ params: formParams, response: formSchema },
	async ({ actor, params }) =>
		portalRequestTypeForm(actor, params.id, params.requestTypeId),
);
