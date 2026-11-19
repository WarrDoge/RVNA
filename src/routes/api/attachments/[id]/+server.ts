import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import {
	attachmentDownload,
	attachmentParams,
	contentDisposition,
	deleteAttachment,
} from "#lib/server/attachments/service.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ params: attachmentParams },
	async ({ actor, params }) => {
		const download = await attachmentDownload(actor, params.id);
		const body = Readable.toWeb(
			createReadStream(download.filePath),
		) as ReadableStream<Uint8Array>;
		return new Response(body, {
			status: 200,
			headers: {
				"Content-Type": download.mimeType,
				"Content-Length": String(download.size),
				"Content-Disposition": contentDisposition(
					download.inline ? "inline" : "attachment",
					download.fileName,
				),
				"X-Content-Type-Options": "nosniff",
				"Content-Security-Policy": "sandbox",
				"Cache-Control": "private, max-age=0, must-revalidate",
			},
		});
	},
);

export const DELETE = endpoint(
	{ params: attachmentParams },
	async ({ actor, params }) => {
		await deleteAttachment(actor, params.id);
		return { status: 204 };
	},
);
