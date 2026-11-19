import { pageLoad } from "#lib/server/http-svelte.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(() => ({})) satisfies PageServerLoad;
