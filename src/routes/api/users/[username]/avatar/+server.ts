import { z } from "zod";
import {
	type AvatarUpload,
	MAX_AVATAR_BYTES,
	uploadAvatar,
} from "#lib/server/avatars.ts";
import { endpoint } from "#lib/server/http.ts";

const params = z.object({ username: z.string().min(1) });

const response = z.object({ avatarUrl: z.string() });

// Room for the multipart framing around a file that is at most MAX_AVATAR_BYTES.
const FRAMING_BYTES = 64 * 1024;

/** Reads the body only up to the limit: a declared or actual excess is refused before it is buffered. */
async function readUpload(request: Request): Promise<AvatarUpload> {
	const limit = MAX_AVATAR_BYTES + FRAMING_BYTES;
	if (Number(request.headers.get("content-length")) > limit) {
		return { bytes: null, tooLarge: true };
	}
	const chunks: Uint8Array[] = [];
	let received = 0;
	if (request.body) {
		for await (const chunk of request.body) {
			received += chunk.length;
			if (received > limit) return { bytes: null, tooLarge: true };
			chunks.push(chunk);
		}
	}
	const form = await new Response(Buffer.concat(chunks), {
		headers: { "content-type": request.headers.get("content-type") ?? "" },
	}).formData();
	for (const value of form.values()) {
		if (!(value instanceof File)) continue;
		if (value.size > MAX_AVATAR_BYTES) {
			return { bytes: null, tooLarge: true };
		}
		return {
			bytes: Buffer.from(await value.arrayBuffer()),
			tooLarge: false,
		};
	}
	return { bytes: null, tooLarge: false };
}

export const POST = endpoint(
	{ params, response },
	async ({ actor, params, event }) =>
		uploadAvatar(actor, params.username, () => readUpload(event.request)),
);
