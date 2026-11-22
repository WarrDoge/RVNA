import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { RequestEvent } from "@sveltejs/kit";
import { type CurrentUser, loginPath } from "#lib/server/auth.ts";
import {
	contentDisposition,
	type DownloadFile,
} from "#lib/server/wiki/service.ts";

export function downloadActor(event: RequestEvent): CurrentUser | Response {
	if (event.locals.user) return event.locals.user;
	// Only a page load goes to the sign-in form; a HEAD probe gets the plain 401.
	if (event.request.method !== "GET")
		return new Response(null, { status: 401 });
	return new Response(null, {
		status: 302,
		headers: {
			location: loginPath(`${event.url.pathname}${event.url.search}`),
		},
	});
}

export function fileResponse(
	file: DownloadFile,
	options: { size: boolean; caching: boolean },
) {
	const headers: Record<string, string> = {
		"Content-Type": file.mimeType ?? "application/octet-stream",
		"Content-Disposition": contentDisposition(
			file.inline ? "inline" : "attachment",
			file.fileName,
		),
		"X-Content-Type-Options": "nosniff",
		"Content-Security-Policy": "sandbox",
	};
	if (options.size && file.size !== undefined) {
		headers["Content-Length"] = String(file.size);
	}
	if (options.caching) {
		headers["Cache-Control"] = "private, max-age=0, must-revalidate";
	}
	const stream = Readable.toWeb(createReadStream(file.filePath));
	return new Response(stream as unknown as ReadableStream, { headers });
}
