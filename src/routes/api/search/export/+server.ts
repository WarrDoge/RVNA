import { Readable } from "node:stream";
import { z } from "zod";
import { contentDisposition } from "#lib/server/attachments/service.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	columnList,
	exportCsv,
	prepareExport,
	safeFileName,
} from "#lib/server/navigator/service.ts";

const exportQuery = z.object({
	jql: z.string().min(1).max(100_000),
	columns: z.string().max(10_000).optional(),
	name: z.string().max(200).optional(),
});

export const GET = endpoint(
	{ query: exportQuery },
	async ({ actor, query }) => {
		const jql = query.jql;
		const columns = columnList(query.columns);
		await prepareExport(actor, { jql, columns });

		const stream = Readable.toWeb(
			Readable.from(exportCsv({ jql, columns }, actor)).map((chunk) =>
				Buffer.from(String(chunk)),
			),
		) as ReadableStream<Uint8Array>;

		return new Response(stream, {
			headers: {
				"Content-Type": "text/csv; charset=utf-8",
				"Content-Disposition": contentDisposition(
					"attachment",
					safeFileName(query.name),
				),
				"Cache-Control": "no-store",
			},
		});
	},
);
