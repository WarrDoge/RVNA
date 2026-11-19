import {
	auditFilterOptionsSchema,
	getAuditFilterOptions,
} from "#lib/server/admin/system.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", response: auditFilterOptionsSchema },
	async ({ actor }) => getAuditFilterOptions(actor),
);
