import { redirect } from "@sveltejs/kit";
import { pageLoad } from "#lib/server/http-svelte.ts";
import type { PageServerLoad } from "./$types";

// The old create screen was the issue navigator with the create dialog open.
export const load = pageLoad(() => {
	redirect(302, "/issues/?create=1");
}) satisfies PageServerLoad;
