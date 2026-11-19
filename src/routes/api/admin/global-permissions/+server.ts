import { z } from "zod";
import {
	addGlobalPermission,
	addHolderBody,
	holderResponseSchema,
	holderSchema,
	listGlobalPermissions,
} from "#lib/server/admin/global-permissions.ts";
import { endpoint } from "#lib/server/http.ts";

export const GET = endpoint(
	{ auth: "admin", response: z.object({ holders: z.array(holderSchema) }) },
	async ({ actor }) => listGlobalPermissions(actor),
);

export const POST = endpoint(
	{ auth: "admin", body: addHolderBody, response: holderResponseSchema },
	async ({ actor, body }) => {
		const { holder, created } = await addGlobalPermission(actor, body);
		return created ? { status: 201, body: { holder } } : { holder };
	},
);
