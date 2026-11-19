import { endpoint } from "#lib/server/http.ts";
import { fieldsSchema, issueFields } from "#lib/server/navigator/service.ts";

export const GET = endpoint({ response: fieldsSchema }, async ({ actor }) =>
	issueFields(actor),
);
