import { redirect } from "@sveltejs/kit";
import { pageLoad } from "#lib/server/http-svelte.ts";
import type { PageServerLoad } from "./$types";

/** The home address has no screen: a signed-in user goes to the dashboard, like any page's guard says. */
export const load = pageLoad(() => {
	redirect(302, "/secure/Dashboard.jspa");
}) satisfies PageServerLoad;
