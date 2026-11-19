import {
	getSettings,
	settingsBody,
	updateSettings,
} from "#lib/server/admin/system.ts";
import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import { siteSettingsSchema } from "#lib/server/site.ts";

export const GET = endpoint(
	{ auth: "admin", response: siteSettingsSchema },
	async ({ actor }) => getSettings(actor),
);

export const PUT = endpoint(
	{
		auth: "admin",
		body: settingsBody,
		response: { 200: siteSettingsSchema, 400: errorSchema },
	},
	async ({ actor, body }) => updateSettings(actor, body),
);
