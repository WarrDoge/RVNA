import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { AvatarSource } from "./avatars.ts";

/** The one place that turns an avatar source into the exact response headers. */
export function avatarResponse(source: AvatarSource): Response {
	const headers = new Headers({
		"X-Content-Type-Options": "nosniff",
		"Cache-Control": "private, max-age=300",
	});
	if (source.kind === "svg") {
		headers.set("Content-Type", "image/svg+xml; charset=utf-8");
		headers.set("Content-Security-Policy", "sandbox");
		return new Response(source.svg, { status: 200, headers });
	}

	headers.set("Content-Type", source.contentType);
	if (source.svg) headers.set("Content-Security-Policy", "sandbox");
	const stream = Readable.toWeb(
		createReadStream(source.path),
	) as ReadableStream;
	return new Response(stream, { status: 200, headers });
}
