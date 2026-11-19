import {
	auditListQuery,
	auditPageSchema,
	listAudit,
} from "#lib/server/admin/system.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{
		auth: "admin",
		query: auditListQuery,
		response: { 200: auditPageSchema, 400: errorSchema },
	},
	async ({ actor, query }) => listAudit(actor, query),
);
