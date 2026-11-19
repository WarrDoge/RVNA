import { z } from "zod";
import { avatarResponse } from "#lib/server/avatar-http.ts";
import { userAvatar } from "#lib/server/avatars.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ params: z.object({ id: z.uuid() }) },
	async ({ actor, params }) =>
		avatarResponse(await userAvatar(actor, params.id)),
);
