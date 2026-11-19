import { endpoint } from "#lib/server/http.ts";
import {
	deskSettingsSchema,
	projectParams,
} from "#lib/server/servicedesk/schemas.ts";
import {
	deskSettings,
	updateDeskSettings,
} from "#lib/server/servicedesk/service.ts";

export const GET = endpoint(
	{ params: projectParams, response: deskSettingsSchema },
	async ({ actor, params }) => deskSettings(actor, params.key),
);

export const PATCH = endpoint(
	{
		params: projectParams,
		body: deskSettingsSchema,
		response: deskSettingsSchema,
	},
	async ({ actor, params, body }) =>
		updateDeskSettings(actor, params.key, body),
);
