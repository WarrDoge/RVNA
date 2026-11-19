import { endpoint } from "#lib/server/http.ts";
import { siteSettings, siteSettingsSchema } from "#lib/server/site.ts";

export const GET = endpoint(
	{ response: siteSettingsSchema },
	async ({ actor }) => siteSettings(actor),
);
