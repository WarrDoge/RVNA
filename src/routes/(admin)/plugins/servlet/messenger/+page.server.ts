import { adminLoad } from "#lib/server/http-svelte.ts";
import {
	getMessengerOptions,
	getMessengerSettings,
} from "#lib/server/messenger/routes.ts";
import type { PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:messenger-settings");
	const [settings, options] = await Promise.all([
		getMessengerSettings(actor),
		getMessengerOptions(actor),
	]);
	return { settings, options };
}) satisfies PageServerLoad;
