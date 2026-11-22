import { redirect } from "@sveltejs/kit";
import { loginPath } from "#lib/server/auth.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(302, loginPath(`${url.pathname}${url.search}`));
	}
	return { username: locals.user.username };
};
