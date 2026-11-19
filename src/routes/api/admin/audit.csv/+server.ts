import { auditFilterSchema, exportAuditCsv } from "#lib/server/admin/system.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", query: auditFilterSchema },
	async ({ actor, query }) => {
		const csv = await exportAuditCsv(actor, query);
		return new Response(csv, {
			headers: {
				"content-type": "text/csv; charset=utf-8",
				"content-disposition": 'attachment; filename="audit-log.csv"',
			},
		});
	},
);
